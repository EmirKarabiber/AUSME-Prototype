"""
kw_for_opp.py — Given an opportunity ID, extract keywords across 3 scopes.

Usage:
  python kw_for_opp.py --opp-id 12345
  python kw_for_opp.py --opp-id 12345 --top-k 10 --device cuda
  python kw_for_opp.py --opp-id 12345 --verbose

Output (stdout, one line per scope):
  Title: keyword1; keyword2; keyword3
  Intro: keyword1; keyword2; keyword3
  Full:  keyword1; keyword2; keyword3
"""

import argparse
import json
import os
import sys

import numpy as np
import torch

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OPPS_PATH = os.path.join(SCRIPT_DIR, "opportunities.json")
VOCAB_EMBEDDINGS_PATH = os.path.join(SCRIPT_DIR, "vocab_embeddings.npz")
VOCAB_CONCEPTS_PATH = os.path.join(SCRIPT_DIR, "vocab_concepts.json")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def resolve_device(requested: str = "auto") -> str:
    """Pick the best available device: cuda > mps > cpu."""
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        print("[device] CUDA detected — using cuda", file=sys.stderr)
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        print("[device] MPS detected — using mps", file=sys.stderr)
        return "mps"
    print("[device] No GPU — using cpu", file=sys.stderr)
    return "cpu"


def load_vocab():
    data = np.load(VOCAB_EMBEDDINGS_PATH, allow_pickle=True)
    embeddings = data["embeddings"]  # (N, D) float32, already L2-normalised
    names = data["names"].tolist()
    with open(VOCAB_CONCEPTS_PATH, "r", encoding="utf-8") as f:
        concepts = json.load(f)
    return embeddings, names, concepts


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if a.ndim == 1:
        a = a.reshape(1, -1)
    return a @ b.T


def mmr_select(text_emb: np.ndarray, vocab_embs: np.ndarray,
               top_k: int, threshold: float, diversity: float = 0.85):
    """Maximal Marginal Relevance keyword selection."""
    scores = cosine_similarity(text_emb, vocab_embs).flatten()
    candidate_indices = np.argsort(scores)[::-1]

    penalty = diversity
    selected = []
    while len(selected) < top_k and penalty >= 0.0:
        selected = []
        sel_embs = []
        for idx in candidate_indices:
            if len(selected) >= top_k:
                break
            score = float(scores[idx])
            if score < threshold:
                break
            pen = 0.0
            if sel_embs:
                sims = cosine_similarity(vocab_embs[idx:idx+1], np.vstack(sel_embs)).flatten()
                pen = penalty * float(np.max(sims))
            if (score - pen) > (threshold * 0.5):
                selected.append((idx, score))
                sel_embs.append(vocab_embs[idx])
        if len(selected) < top_k:
            penalty -= 0.05

    # Fallback: just take top-k by raw score
    if not selected:
        selected = [(int(i), float(scores[i])) for i in candidate_indices[:top_k]]

    return selected


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Extract keywords for a single opportunity across 3 scopes (Title, Intro, Full)."
    )
    parser.add_argument("--opp-id", type=str, required=True,
                        help="The opp_id to look up in opportunities.json")
    parser.add_argument("--json", type=str, default=DEFAULT_OPPS_PATH,
                        dest="opps_path",
                        help=f"Path to opportunities.json (default: {DEFAULT_OPPS_PATH})")
    parser.add_argument("--top-k", type=int, default=5,
                        help="Number of keywords per scope (default: 5)")
    parser.add_argument("--threshold", type=float, default=0.15,
                        help="Minimum cosine similarity threshold (default: 0.15)")
    parser.add_argument("--device", type=str, default="auto",
                        help="Device: auto, cpu, cuda, mps (default: auto)")
    parser.add_argument("--model", type=str, default="Qwen/Qwen3-Embedding-0.6B",
                        help="HuggingFace sentence-transformer model name")
    parser.add_argument("--verbose", action="store_true",
                        help="Print per-keyword scores to stderr")
    args = parser.parse_args()

    # --- Load opportunity ---
    print(f"[*] Loading opportunities from {args.opps_path} ...", file=sys.stderr)
    with open(args.opps_path, "r", encoding="utf-8") as f:
        opps = json.load(f)

    opp = next(
        (o for o in opps if str(o.get("opp_id")) == str(args.opp_id)),
        None
    )
    if opp is None:
        print(f"[ERROR] opp_id '{args.opp_id}' not found in {args.opps_path}", file=sys.stderr)
        sys.exit(1)

    title = opp.get("title", "") or ""
    description = opp.get("description", "") or ""
    if not description:
        print(f"[ERROR] Opportunity '{args.opp_id}' has no description.", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Found: {title[:80]}", file=sys.stderr)
    print(f"[*] Description length: {len(description)} chars", file=sys.stderr)

    # --- Build 3 scopes (mirrors server-side extract_opportunity_keywords) ---
    fifteen_pct_idx = int(len(description) * 0.15)
    while fifteen_pct_idx < len(description) and description[fifteen_pct_idx] not in (' ', '\n', '\t'):
        fifteen_pct_idx += 1
    intro_text = description[:fifteen_pct_idx]

    scopes = []
    if title:
        scopes.append(("Title", title))
    scopes.append(("Intro", intro_text))
    scopes.append(("Full",  description))

    # --- Load vocab & model ---
    print("[*] Loading vocab ...", file=sys.stderr)
    vocab_embs, vocab_names, vocab_concepts = load_vocab()
    print(f"    {len(vocab_names)} concepts loaded.", file=sys.stderr)

    from sentence_transformers import SentenceTransformer
    device = resolve_device(args.device)
    print(f"[*] Loading model '{args.model}' on {device} ...", file=sys.stderr)
    model = SentenceTransformer(args.model, device=device)

    # --- Batch embed all 3 scopes at once ---
    print(f"[*] Batch embedding {len(scopes)} scopes ...", file=sys.stderr)
    scope_embs = model.encode(
        [s[1] for s in scopes],
        normalize_embeddings=True,
        show_progress_bar=False
    )

    # --- MMR select per scope, collect lines ---
    print(f"[*] Running MMR selection (top_k={args.top_k}) per scope ...\n", file=sys.stderr)
    output_lines = []
    for (scope_name, _), text_emb in zip(scopes, scope_embs):
        selected = mmr_select(text_emb, vocab_embs, args.top_k, args.threshold)
        keywords = [vocab_names[idx] for idx, _ in selected]

        if args.verbose:
            print(f"  [{scope_name}]", file=sys.stderr)
            for kw, (idx, score) in zip(keywords, selected):
                print(f"    {kw}  (score={score:.4f})", file=sys.stderr)
            print(file=sys.stderr)

        line = f"{scope_name}: {'; '.join(keywords)}"
        output_lines.append(line)
        print(line)

    # --- Save to keywords/{opp_id}.txt ---
    keywords_dir = os.path.join(SCRIPT_DIR, "keywords")
    os.makedirs(keywords_dir, exist_ok=True)
    out_path = os.path.join(keywords_dir, f"{args.opp_id}.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(output_lines) + "\n")
    print(f"\n[*] Saved to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()

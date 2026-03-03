"""
extract_keywords.py — Extract keywords from a paper using embedding similarity.

Pipeline:
  1. Load pre-embedded vocab (from embed_vocab.py)
  2. Load Qwen3-Embedding-0.6B
  3. Embed the paper at two levels:
     a. Full document (or title+abstract if provided)
     b. Individual paragraphs
  4. Cosine similarity of doc embedding vs vocab -> top-K keyword candidates
  5. For each keyword, find the best-matching paragraph as evidence

Usage:
  python extract_keywords.py --file paper.txt
  python extract_keywords.py --file paper.txt --title "My Paper" --abstract "We propose..."
  python extract_keywords.py --file paper.txt --top-k 5 --threshold 0.25 --device cuda
"""

import argparse
import concurrent.futures
import json
import os
import queue
import re
import threading
import textwrap

import numpy as np
import torch


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VOCAB_EMBEDDINGS_PATH = os.path.join(SCRIPT_DIR, "vocab_embeddings.npz")
VOCAB_CONCEPTS_PATH = os.path.join(SCRIPT_DIR, "vocab_concepts.json")

# Global flag to permanently downgrade to CPU if the user's GPU runs out of VRAM
_FORCE_CPU_MODE = False




def resolve_device(requested: str = "auto") -> str:
    """Pick the best available device: cuda > mps > cpu."""
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        print("GPU detected (CUDA) — using cuda")
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        print("GPU detected (MPS) — using mps")
        return "mps"
    print("No GPU detected — using cpu")
    return "cpu"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def load_vocab():
    """Load the pre-computed vocab embeddings and concept metadata."""
    if not os.path.exists(VOCAB_EMBEDDINGS_PATH):
        raise FileNotFoundError(
            f"Vocab embeddings not found at {VOCAB_EMBEDDINGS_PATH}. "
            "Run embed_vocab.py first."
        )

    data = np.load(VOCAB_EMBEDDINGS_PATH, allow_pickle=True)
    embeddings = data["embeddings"]  # (N, D) float32
    names = data["names"].tolist()  # list of str

    with open(VOCAB_CONCEPTS_PATH, "r", encoding="utf-8") as f:
        concepts = json.load(f)

    return embeddings, names, concepts


def create_window_chunks(text: str) -> list[dict]:
    """
    Create sliding windows of 1%, 5%, and 10% of the text length.
    Returns a list of dicts: {"start": int, "end": int, "text": str}
    """
    L = len(text)
    if L < 100:
        return [{"start": 0, "end": L, "text": text}]
        
    windows = [
        max(50, int(L * 0.01)),
        max(50, int(L * 0.05)),
        max(50, int(L * 0.10))
    ]
    
    chunks = []
    seen = set()
    
    for w in windows:
        step = max(1, w // 2)  # 50% overlap
        for start in range(0, L, step):
            end = min(L, start + w)
            
            s = start
            while s > 0 and text[s-1] not in (' ', '\n', '\t'):
                s -= 1
                
            e = end
            while e < L and text[e-1] not in (' ', '\n', '\t') and text[e] not in (' ', '\n', '\t'):
                e += 1
                
            chunk_text = text[s:e].strip()
            actual_s = text.find(chunk_text, s)
            
            if actual_s != -1:
                actual_e = actual_s + len(chunk_text)
                interval = (actual_s, actual_e)
                if len(chunk_text) > 10 and interval not in seen:
                    seen.add(interval)
                    chunks.append({
                        "start": actual_s,
                        "end": actual_e,
                        "text": chunk_text
                    })
            if end == L:
                break
    return chunks


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """
    Cosine similarity between vector(s) `a` and matrix `b`.
    Assumes both are already L2-normalized.
    """
    if a.ndim == 1:
        a = a.reshape(1, -1)
    return a @ b.T


def select_keywords_batch(text_embeddings, vocab_embeddings, top_k, threshold, diversity_penalty):
    """
    Given a batch of text embeddings (N, D), returns a list of lists of (idx, score).
    Uses MMR to ensure diversity.
    """
    results = []
    # combined_scores_batch: (N, VocabSize)
    combined_scores_batch = cosine_similarity(text_embeddings, vocab_embeddings)

    for i in range(len(text_embeddings)):
        combined_scores = combined_scores_batch[i].flatten()
        candidate_indices = np.argsort(combined_scores)[::-1]
        
        current_penalty = diversity_penalty
        selected = []
        while len(selected) < top_k and current_penalty >= 0.0:
            selected = []
            selected_embs = []
            for idx in candidate_indices:
                if len(selected) >= top_k:
                    break
                score = float(combined_scores[idx])
                if score < threshold:
                    break
                
                # Compute diversity penalty
                penalty = 0.0
                if selected_embs:
                    candidate_emb = vocab_embeddings[idx:idx+1]
                    sims = cosine_similarity(candidate_emb, np.vstack(selected_embs)).flatten()
                    max_sim_to_selected = float(np.max(sims))
                    penalty = current_penalty * max_sim_to_selected
                    
                if (score - penalty) > (threshold * 0.5):
                    selected.append((idx, score))
                    selected_embs.append(vocab_embeddings[idx])
                    
            if len(selected) < top_k:
                current_penalty -= 0.05

        if not selected:
            for idx in candidate_indices[:top_k]:
                selected.append((idx, float(combined_scores[idx])))
        results.append(selected)
    return results


def encode_with_fallback(texts, model):
    """Encodes texts using the model, with a permanent fallback to CPU on CUDA OOM."""
    global _FORCE_CPU_MODE
    if _FORCE_CPU_MODE:
        return model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    try:
        return model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    except RuntimeError as e:
        if "CUDA out of memory" in str(e) or "out of memory" in str(e).lower():
            print(f"\n[WARNING] CUDA OOM! Falling back to CPU.")
            _FORCE_CPU_MODE = True
            model.cpu()
            if torch.cuda.is_available(): torch.cuda.empty_cache()
            return model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        raise e

class RefinementCache:
    def __init__(self):
        self.macro_chunks = None
        self.macro_embs = None
        self.lock = threading.Lock()


# ---------------------------------------------------------------------------
# Core extraction
# ---------------------------------------------------------------------------


def _init_phase1_state(scope_label, search_text, selected, vocab_names, vocab_concepts):
    """Initializes the Phase 1 state and yields initial coarse results."""
    base_chunks_map = {}
    events = []
    
    for idx, score in selected:
        keyword_name = vocab_names[idx]
        concept = vocab_concepts[idx]
        
        # Phase 1 Heuristic: Just find the keyword in text
        match_idx = search_text.lower().find(keyword_name.lower())
        if match_idx == -1: 
            match_idx = len(search_text) // 2
            
        # Make Phase 1 DELIBERATELY COARSE (500 chars) to ensure the pulse is visible
        # We start with a very wide, dim guess.
        coarse_s = max(0, match_idx - 150)
        coarse_e = min(len(search_text), match_idx + 150)
        coarse_text = search_text[coarse_s:coarse_e]
        
        base_chunks_map[idx] = {
            "chunk": {"text": coarse_text, "start": coarse_s, "end": coarse_e},
            "score": 0.1 # Minimal baseline
        }
        
        events.append({
            "scope": scope_label,
            "phase": 1,
            "keyword": keyword_name,
            "score": round(float(score), 4),
            "level": concept.get("level", -1),
            "best_chunk_text": coarse_text[:100] + "...",
            "chunk_start": coarse_s,
            "chunk_end": coarse_e,
            "chunk_score": 0.0,
            "gradient_spans": []
        })
    return base_chunks_map, events

def _refine_macro_tier(scope_label, search_text, selected, vocab_names, vocab_embeddings, base_chunks_map, model, cache):
    """Runs the Macro (10%) refinement tier."""
    L = len(search_text)
    macro_chunks = []
    macro_embs = None
    
    if cache:
        with cache.lock:
            if cache.macro_embs is not None:
                macro_chunks = cache.macro_chunks
                macro_embs = cache.macro_embs
    
    if not macro_chunks and L > 100:
        step = L // 10
        for i in range(10):
            s = i * step
            e = min(L, s + step) if i < 9 else L
            macro_chunks.append({"start": s, "end": e, "text": search_text[s:e]})
            
    if not macro_chunks: return []

    if macro_embs is None:
        macro_embs = encode_with_fallback([c["text"] for c in macro_chunks], model)
        if cache:
            with cache.lock:
                cache.macro_chunks = macro_chunks
                cache.macro_embs = macro_embs
                
    events = []
    for idx, score in selected:
        keyword_emb = vocab_embeddings[idx : idx + 1]
        m_scores = cosine_similarity(keyword_emb, macro_embs).flatten()
        best_m = int(np.argmax(m_scores))
        macro_chunk = macro_chunks[best_m]
        
        base_chunks_map[idx] = {"chunk": macro_chunk, "score": float(m_scores[best_m])}
        events.append({
            "scope": scope_label,
            "phase": 2,
            "tier": "macro",
            "keyword": vocab_names[idx],
            "best_chunk_text": macro_chunk["text"][:150] + "...",
            "chunk_start": macro_chunk["start"],
            "chunk_end": macro_chunk["end"],
            "chunk_score": round(float(m_scores[best_m]), 4)
        })
    return events

def _refine_meso_tier(scope_label, search_text, selected, vocab_names, vocab_embeddings, base_chunks_map, model):
    """Runs the Meso (5%) refinement tier."""
    meso_texts = []
    meso_meta = []
    L = len(search_text)
    
    for idx, score in selected:
        macro_c = base_chunks_map[idx]["chunk"]
        m_s, m_e = macro_c["start"], macro_c["end"]
        m_len = m_e - m_s
        sub_step = m_len // 4
        for i in range(4):
            s = max(0, m_s + (i * sub_step) - (sub_step // 2))
            e = min(L, s + (m_len // 2))
            txt = search_text[s:e]
            if len(txt) > 20:
                meso_texts.append(txt)
                meso_meta.append((idx, s, e))
                
    if not meso_texts: return []
    meso_embs = encode_with_fallback(meso_texts, model)
    
    events = []
    curr_idx = 0
    for idx, score in selected:
        keyword_emb = vocab_embeddings[idx : idx + 1]
        num_meso = sum(1 for m in meso_meta[curr_idx:] if m[0] == idx)
        if num_meso > 0:
            kw_meso_embs = meso_embs[curr_idx : curr_idx + num_meso]
            meso_scores = cosine_similarity(keyword_emb, kw_meso_embs).flatten()
            best_ms = int(np.argmax(meso_scores))
            meta = meso_meta[curr_idx + best_ms]
            ms_score = float(meso_scores[best_ms])
            
            if ms_score > base_chunks_map[idx]["score"]:
                base_chunks_map[idx] = {
                    "chunk": {"start": meta[1], "end": meta[2], "text": search_text[meta[1]:meta[2]]},
                    "score": ms_score
                }
                events.append({
                    "scope": scope_label,
                    "phase": 2,
                    "tier": "meso",
                    "keyword": vocab_names[idx],
                    "best_chunk_text": base_chunks_map[idx]["chunk"]["text"][:150] + "...",
                    "chunk_start": meta[1],
                    "chunk_end": meta[2],
                    "chunk_score": round(ms_score, 4)
                })
            curr_idx += num_meso
    return events

def _refine_micro_tier(scope_label, search_text, selected, vocab_names, vocab_embeddings, base_chunks_map, model):
    """Runs the Micro (1%) refinement tier."""
    micro_texts = []
    micro_meta = []
    L = len(search_text)
    
    for idx, score in selected:
        meso_c = base_chunks_map[idx]["chunk"]
        m_s, m_e = meso_c["start"], meso_c["end"]
        neighborhood_text = search_text[m_s:m_e]
        n_len = len(neighborhood_text)
        win_size = max(50, L // 100)
        step = win_size // 2
        for s_rel in range(0, n_len - (win_size // 2), step):
            e_rel = min(n_len, s_rel + win_size)
            txt = neighborhood_text[s_rel:e_rel].strip()
            if len(txt) > 20:
                micro_texts.append(txt)
                micro_meta.append((idx, m_s + s_rel, m_s + e_rel))
                
    if not micro_texts: return []
    micro_embs = encode_with_fallback(micro_texts, model)
    
    events = []
    curr_idx = 0
    for idx, score in selected:
        keyword_emb = vocab_embeddings[idx : idx + 1]
        num_micro = sum(1 for m in micro_meta[curr_idx:] if m[0] == idx)
        if num_micro > 0:
            kw_micro_embs = micro_embs[curr_idx : curr_idx + num_micro]
            u_scores = cosine_similarity(keyword_emb, kw_micro_embs).flatten()
            best_u = int(np.argmax(u_scores))
            meta = micro_meta[curr_idx + best_u]
            u_score = float(u_scores[best_u])
            
            if u_score > base_chunks_map[idx]["score"]:
                base_chunks_map[idx] = {
                    "chunk": {"start": meta[1], "end": meta[2], "text": search_text[meta[1]:meta[2]]},
                    "score": u_score
                }
                events.append({
                    "scope": scope_label,
                    "phase": 2,
                    "tier": "micro",
                    "keyword": vocab_names[idx],
                    "best_chunk_text": base_chunks_map[idx]["chunk"]["text"],
                    "chunk_start": meta[1],
                    "chunk_end": meta[2],
                    "chunk_score": round(u_score, 4)
                })
            curr_idx += num_micro
    return events

def _generate_rings(scope_label, search_text, selected, vocab_names, vocab_embeddings, base_chunks_map, model):
    """Generates the Phase 3 gradient expansion rings."""
    all_rings_text = []
    ring_metadata = []
    
    for idx, score in selected:
        best_c = base_chunks_map[idx]["chunk"]
        current_start, current_end = best_c["start"], best_c["end"]
        for _ in range(15):
            next_start = max(0, current_start - 150)
            while next_start > 0 and search_text[next_start - 1] not in (' ', '\n', '\t'): next_start -= 1
            next_end = min(len(search_text), current_end + 150)
            while next_end < len(search_text) and search_text[next_end] not in (' ', '\n', '\t'): next_end += 1
            if next_start == current_start and next_end == current_end: break
            current_start, current_end = next_start, next_end
            txt = search_text[current_start:current_end].strip()
            if not txt: break
            all_rings_text.append(txt)
            ring_metadata.append((idx, current_start, current_end))

    if not all_rings_text: return []
    ring_embeddings = encode_with_fallback(all_rings_text, model)
    
    events = []
    curr_idx = 0
    for idx, score in selected:
        keyword_emb = vocab_embeddings[idx : idx + 1]
        base_score = base_chunks_map[idx]["score"]
        stop_threshold = base_score * 0.55
        num_rings = sum(1 for m in ring_metadata[curr_idx:] if m[0] == idx)
        if num_rings > 0:
            kw_embs = ring_embeddings[curr_idx : curr_idx + num_rings]
            r_scores = cosine_similarity(keyword_emb, kw_embs).flatten()
            for r_i in range(num_rings):
                meta = ring_metadata[curr_idx + r_i]
                if float(r_scores[r_i]) < stop_threshold: break
                events.append({
                    "scope": scope_label,
                    "phase": 3,
                    "keyword": vocab_names[idx],
                    "gradient": {"start": meta[1], "end": meta[2], "score": round(float(r_scores[r_i]), 4)}
                })
            curr_idx += num_rings
    return events

def extract_keywords_for_text(text_to_embed, search_text, model, vocab_embeddings, vocab_names, vocab_concepts, top_k=5, threshold=0.1, diversity_penalty=0.85, scope_name="Document", preselected=None, skip_phase1=False, cache=None):
    """
    Deprecated: Use tiered helpers directly. 
    This is kept for CLI/Legacy compatibility.
    """
    base_map, _ = _init_phase1_state(scope_name, search_text, preselected, vocab_names, vocab_concepts)
    yield from _refine_macro_tier(scope_name, search_text, preselected, vocab_names, vocab_embeddings, base_map, model, cache)
    yield from _refine_meso_tier(scope_name, search_text, preselected, vocab_names, vocab_embeddings, base_map, model)
    yield from _refine_micro_tier(scope_name, search_text, preselected, vocab_names, vocab_embeddings, base_map, model)
    yield from _generate_rings(scope_name, search_text, preselected, vocab_names, vocab_embeddings, base_map, model)

def extract_opportunity_keywords(
    description: str,
    title: str,
    model,
    vocab_embeddings: np.ndarray,
    vocab_names: list[str],
    vocab_concepts: list[dict],
):
    """
    Extracts keywords for an opportunity across 3 different scopes:
    1. Title only
    2. First 15% of the description (Intro block)
    3. Full description
    
    Yields progressive SSE objects down the pipeline, interleaved via threading.
    """
    # 1. BATCH MMR (ALL 15 KEYWORDS)
    scopes = []
    if title: scopes.append(("Title", "title_keywords", title))
    if description:
        # Intro
        fifteen_pct_idx = int(len(description) * 0.15)
        while fifteen_pct_idx < len(description) and description[fifteen_pct_idx] not in (' ', '\n', '\t'):
            fifteen_pct_idx += 1
        intro_text = description[:fifteen_pct_idx]
        scopes.append(("Intro", "intro_keywords", intro_text))
        # Full
        scopes.append(("Full", "full_keywords", description))

    print(f"Batch embedding {len(scopes)} scopes for Phase 1 selection...", flush=True)
    scope_embeddings = encode_with_fallback([s[2] for s in scopes], model)
    selection_results = select_keywords_batch(
        scope_embeddings, vocab_embeddings, 
        top_k=5, threshold=0.1, diversity_penalty=0.85
    )

    # --- ORCHESTRATION ---
    cache = RefinementCache()
    scope_states = []
    
    # 1. PHASE 1: INITIAL HEURISTIC (Synchronized)
    print("Phase 1: Initial Heuristic...", flush=True)
    for i, (name, label, text) in enumerate(scopes):
        keywords = selection_results[i]
        base_map, events = _init_phase1_state(label, description, keywords, vocab_names, vocab_concepts)
        scope_states.append({
            "label": label,
            "keywords": keywords,
            "base_map": base_map
        })
        for ev in events: yield ev

    # 2. PHASE 2: TIER 1 (MACRO) - Gated
    print("Phase 2 Tier 1: Macro Refinement Pulse...", flush=True)
    for state in scope_states:
        events = _refine_macro_tier(state["label"], description, state["keywords"], vocab_names, vocab_embeddings, state["base_map"], model, cache)
        for ev in events: yield ev

    # 3. PHASE 2: TIER 2 (MESO) - Gated
    print("Phase 2 Tier 2: Meso Refinement Pulse...", flush=True)
    for state in scope_states:
        events = _refine_meso_tier(state["label"], description, state["keywords"], vocab_names, vocab_embeddings, state["base_map"], model)
        for ev in events: yield ev

    # 4. PHASE 2: TIER 3 (MICRO) - Gated
    print("Phase 2 Tier 3: Micro Refinement Pulse...", flush=True)
    for state in scope_states:
        events = _refine_micro_tier(state["label"], description, state["keywords"], vocab_names, vocab_embeddings, state["base_map"], model)
        for ev in events: yield ev

    # 5. PHASE 3: GRADIENT RINGS - Gated
    print("Phase 3: Gradient Expansion Pulse...", flush=True)
    for state in scope_states:
        events = _generate_rings(state["label"], description, state["keywords"], vocab_names, vocab_embeddings, state["base_map"], model)
        for ev in events: yield ev

def extract_keywords(
    text: str,
    model: any,
    vocab_embeddings: np.ndarray,
    vocab_names: list[str],
    vocab_concepts: list[dict],
    title: str = None,
    abstract: str = None,
    top_k: int = 5,
    threshold: float = 0.2,
    doc_weight: float = 0.6,
    abstract_weight: float = 0.4,
) -> list[dict]:
    """Blocking version of keyword extraction for CLI usage."""
    # For CLI, we just combine title+abstract+text into one blob
    full_text = ""
    if title: full_text += title + " "
    if abstract: full_text += abstract + " "
    full_text += text
    
    # We take the final state of each keyword from Phase 2
    final_results = {}
    gen_p1, gen_p2, gen_p3 = extract_keywords_for_text(
        text_to_embed=full_text,
        search_text=text,
        model=model,
        vocab_embeddings=vocab_embeddings,
        vocab_names=vocab_names,
        vocab_concepts=vocab_concepts,
        top_k=top_k,
        threshold=threshold
    )
    
    # Run all generators to completion
    for res in gen_p1: final_results[res["keyword"]] = res
    for res in gen_p2: final_results[res["keyword"]].update(res)
    # We skip Phase 3 for blocking results usually, but could merge if needed.
    
    return list(final_results.values())


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------


def print_results(results: list[dict]):
    print("\n" + "=" * 70)
    print("  EXTRACTED KEYWORDS")
    print("=" * 70)

    for i, r in enumerate(results, 1):
        print(f"\n  #{i}  {r['keyword']}  (score: {r['score']:.4f}, level: {r['level']})")
        print(f"       Chunk match score: {r['chunk_score']:.4f}")
        # Show a truncated snippet of the best chunk
        snippet = textwrap.shorten(r["best_chunk_text"], width=120, placeholder="...")
        print(f"       \"{snippet}\"")

    print("\n" + "=" * 70)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Extract keywords from a paper using embedding similarity."
    )
    parser.add_argument(
        "--file", type=str, required=True, help="Path to the paper text file"
    )
    parser.add_argument("--title", type=str, default=None, help="Paper title (optional)")
    parser.add_argument(
        "--abstract", type=str, default=None, help="Paper abstract (optional)"
    )
    parser.add_argument(
        "--top-k", type=int, default=5, help="Number of keywords to extract (default: 5)"
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.2,
        help="Minimum cosine similarity threshold (default: 0.2)",
    )
    parser.add_argument(
        "--doc-weight",
        type=float,
        default=0.6,
        help="Weight for full-document score (default: 0.6)",
    )
    parser.add_argument(
        "--abstract-weight",
        type=float,
        default=0.4,
        help="Weight for title+abstract score (default: 0.4)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="Qwen/Qwen3-Embedding-0.6B",
        help="HuggingFace model name",
    )
    parser.add_argument(
        "--device", type=str, default="auto", help="Device (auto, cpu, cuda, mps). Default: auto-detect GPU."
    )
    parser.add_argument(
        "--output-json",
        type=str,
        default=None,
        help="Optional path to save results as JSON",
    )
    args = parser.parse_args()

    device = resolve_device(args.device)

    # Load vocab
    print("Loading pre-embedded vocab...")
    vocab_embeddings, vocab_names, vocab_concepts = load_vocab()
    print(f"  {len(vocab_names)} concepts loaded.")

    # Load model
    from sentence_transformers import SentenceTransformer

    print(f"Loading model '{args.model}'...")
    model = SentenceTransformer(args.model, device=device)

    # Read paper text
    with open(args.file, "r", encoding="utf-8") as f:
        text = f.read()
    print(f"  Paper length: {len(text)} chars, ~{len(text.split())} words")

    # Extract
    results = extract_keywords(
        text=text,
        model=model,
        vocab_embeddings=vocab_embeddings,
        vocab_names=vocab_names,
        vocab_concepts=vocab_concepts,
        title=args.title,
        abstract=args.abstract,
        top_k=args.top_k,
        threshold=args.threshold,
        doc_weight=args.doc_weight,
        abstract_weight=args.abstract_weight,
    )

    # Display
    print_results(results)

    # Optionally save JSON
    if args.output_json:
        with open(args.output_json, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"\nResults saved to {args.output_json}")


if __name__ == "__main__":
    main()

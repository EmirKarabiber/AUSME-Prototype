"""
embed_vocab.py — Download OpenAlex concepts and pre-embed them with Qwen3-Embedding-0.6B.

Run this ONCE (or whenever you want to refresh the vocab).
Produces:
  - vocab_concepts.json   (raw concept data from OpenAlex)
  - vocab_embeddings.npz  (pre-computed embeddings + concept names)

Usage:
  python embed_vocab.py
  python embed_vocab.py --max-level 2      # only Level 0-2 (broader terms)
  python embed_vocab.py --max-level 4      # up to Level 4 (more specific)
  python embed_vocab.py --device cuda       # force GPU
  python embed_vocab.py --device cpu        # force CPU
"""

import argparse
import json
import os
import time

import torch

import numpy as np
import requests
from tqdm import tqdm

# ---------------------------------------------------------------------------
# 1. Download concepts from OpenAlex
# ---------------------------------------------------------------------------

OPENALEX_CONCEPTS_URL = "https://api.openalex.org/concepts"
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))


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


def fetch_openalex_concepts(max_level: int = 3, per_page: int = 200) -> list[dict]:
    """
    Paginate through the OpenAlex concepts API and return concepts
    at levels 0 through `max_level`.
    """
    all_concepts = []

    for level in range(0, max_level + 1):
        cursor = "*"
        level_count = 0
        print(f"\n--- Fetching Level {level} concepts ---")

        while cursor is not None:
            params = {
                "filter": f"level:{level}",
                "per_page": per_page,
                "cursor": cursor,
                "select": "id,display_name,level,works_count",
            }
            resp = requests.get(OPENALEX_CONCEPTS_URL, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            results = data.get("results", [])
            if not results:
                break

            for concept in results:
                all_concepts.append(
                    {
                        "id": concept["id"],
                        "name": concept["display_name"],
                        "level": concept["level"],
                        "works_count": concept.get("works_count", 0),
                    }
                )
            level_count += len(results)

            # Cursor-based pagination
            meta = data.get("meta", {})
            cursor = meta.get("next_cursor")

            # Be polite to the API
            time.sleep(0.1)

        print(f"  Level {level}: {level_count} concepts")

    print(f"\nTotal concepts fetched: {len(all_concepts)}")
    return all_concepts


# ---------------------------------------------------------------------------
# 2. Embed the concept names
# ---------------------------------------------------------------------------


def embed_concepts(
    concepts: list[dict], model_name: str, device: str, batch_size: int
) -> np.ndarray:
    """
    Embed all concept display_names using Qwen3-Embedding-0.6B.
    Returns an (N, D) numpy array of embeddings.
    """
    from sentence_transformers import SentenceTransformer

    print(f"\nLoading model '{model_name}' (will download on first run)...")
    model = SentenceTransformer(model_name, device=device)

    names = [c["name"] for c in concepts]
    print(f"Embedding {len(names)} concept names (batch_size={batch_size})...")

    embeddings = model.encode(
        names,
        batch_size=batch_size,
        show_progress_bar=True,
        normalize_embeddings=True,  # pre-normalize for cosine similarity
    )

    return np.array(embeddings)


# ---------------------------------------------------------------------------
# 3. Save to disk
# ---------------------------------------------------------------------------


def save_outputs(concepts: list[dict], embeddings: np.ndarray):
    concepts_path = os.path.join(OUTPUT_DIR, "vocab_concepts.json")
    embeddings_path = os.path.join(OUTPUT_DIR, "vocab_embeddings.npz")

    # Save concept metadata
    with open(concepts_path, "w", encoding="utf-8") as f:
        json.dump(concepts, f, indent=2, ensure_ascii=False)
    print(f"Saved concept metadata -> {concepts_path}")

    # Save embeddings + names together in an npz
    names = [c["name"] for c in concepts]
    np.savez_compressed(
        embeddings_path,
        embeddings=embeddings,
        names=np.array(names, dtype=object),
    )
    print(f"Saved embeddings ({embeddings.shape}) -> {embeddings_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Download OpenAlex concepts and embed them."
    )
    parser.add_argument(
        "--max-level",
        type=int,
        default=3,
        help="Maximum concept level to include (0=broadest, default=3)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="Qwen/Qwen3-Embedding-0.6B",
        help="HuggingFace model name for embeddings",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="auto",
        help="Device to run model on (auto, cpu, cuda, mps). Default: auto-detect GPU.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=64,
        help="Batch size for embedding (lower if running out of memory)",
    )
    args = parser.parse_args()

    device = resolve_device(args.device)

    # Step 1: Fetch concepts
    concepts_path = os.path.join(OUTPUT_DIR, "vocab_concepts.json")
    if os.path.exists(concepts_path):
        print(f"Found existing {concepts_path}, loading from cache...")
        with open(concepts_path, "r", encoding="utf-8") as f:
            concepts = json.load(f)
        print(f"Loaded {len(concepts)} concepts from cache.")
    else:
        concepts = fetch_openalex_concepts(max_level=args.max_level)
        # Save concepts early so we don't have to re-fetch if embedding fails
        with open(concepts_path, "w", encoding="utf-8") as f:
            json.dump(concepts, f, indent=2, ensure_ascii=False)
        print(f"Cached concepts to {concepts_path}")

    # Step 2: Embed
    embeddings = embed_concepts(concepts, args.model, device, args.batch_size)

    # Step 3: Save
    save_outputs(concepts, embeddings)
    print("\nDone! You can now run extract_keywords.py.")


if __name__ == "__main__":
    main()

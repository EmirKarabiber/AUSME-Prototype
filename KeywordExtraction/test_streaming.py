
import os
import json
import sys
import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from extract_keywords import load_vocab, extract_opportunity_keywords, resolve_device

def test_streaming():
    print("--- STARTING TEST ---", flush=True)
    device = resolve_device("cpu")
    print(f"Resolved device: {device}", flush=True)

    print("Loading vocab...", flush=True)
    vocab_embeddings, vocab_names, vocab_concepts = load_vocab()
    print(f"Vocab loaded: {len(vocab_names)} items.", flush=True)

    print("Loading model...", flush=True)
    model = SentenceTransformer("Qwen/Qwen3-Embedding-0.6B", device=device)
    print("Model loaded successfully.", flush=True)

    # Simple test data
    title = "Research on dendrohydrological reconstructions in the Jemez Mountains"
    description = "The U.S. Geological Survey is offering a cooperative-agreement opportunity to conduct research on dendrohydrological reconstructions. Dendrochronological collections from previously-collected tree-ring sites will be used to extend the hydrology back in time."

    print("\nStarting extraction generator...", flush=True)
    generator = extract_opportunity_keywords(
        description=description,
        title=title,
        model=model,
        vocab_embeddings=vocab_embeddings,
        vocab_names=vocab_names,
        vocab_concepts=vocab_concepts
    )

    count = 0
    try:
        for event in generator:
            count += 1
            print(f"Received Event #{count}: {event['scope']} | Phase {event.get('phase')} | Keyword: {event.get('keyword')}", flush=True)
            if count > 30: 
                print("Interleaving looks healthy. Stopping early.", flush=True)
                break
    except Exception as e:
        print(f"ERROR during extraction loop: {e}", flush=True)

    if count == 0:
        print("FAILURE: Generator yielded zero items.", flush=True)
    else:
        print(f"\nSUCCESS: Received {count} events.", flush=True)

if __name__ == "__main__":
    test_streaming()

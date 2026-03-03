import time
import os
import sys
import torch
import numpy as np

# Mocking essentials to use extract_keywords
from extract_keywords import (
    load_vocab,
    extract_keywords_for_text
)
from sentence_transformers import SentenceTransformer

def benchmark():
    print("--- Starting CPU Timing Benchmark ---", flush=True)
    start_init = time.time()
    vocab_embeddings, vocab_names, vocab_concepts = load_vocab()
    model = SentenceTransformer("Qwen/Qwen3-Embedding-0.6B", device="cpu")
    print(f"Model/Vocab loaded in {time.time() - start_init:.2f}s")

    test_text = "This is a long test paper about Ecohydrology and Mesocosms. " * 50 # ~500 words
    
    times = {
        "Phase 1 (Instant)": None,
        "Tier 1 (Macro)": None,
        "Tier 2 (Meso)": None,
        "Tier 3 (Micro)": None
    }
    
    start_bench = time.time()
    generator = extract_keywords_for_text(
        text_to_embed=test_text[:200],
        search_text=test_text,
        model=model,
        vocab_embeddings=vocab_embeddings,
        vocab_names=vocab_names,
        vocab_concepts=vocab_concepts,
        scope_name="Benchmark"
    )

    for event in generator:
        phase = event.get("phase")
        tier = event.get("tier")
        elapsed = time.time() - start_bench
        
        if phase == 1 and times["Phase 1 (Instant)"] is None:
            times["Phase 1 (Instant)"] = elapsed
            print(f"[EVENT] Phase 1: {elapsed:.2f}s")
            
        elif phase == 2:
            if tier == "macro" and times["Tier 1 (Macro)"] is None:
                times["Tier 1 (Macro)"] = elapsed
                print(f"[EVENT] Tier 1 (Macro): {elapsed:.2f}s")
            elif tier == "meso" and times["Tier 2 (Meso)"] is None:
                times["Tier 2 (Meso)"] = elapsed
                print(f"[EVENT] Tier 2 (Meso): {elapsed:.2f}s")
            elif tier == "micro" and times["Tier 3 (Micro)"] is None:
                times["Tier 3 (Micro)"] = elapsed
                print(f"[EVENT] Tier 3 (Micro): {elapsed:.2f}s")
                # Stop here for speed of bench
                break

    print("\n--- Final CPU Latency Results ---")
    for k, v in times.items():
        if v:
            print(f"{k}: {v:.2f}s")
        else:
            print(f"{k}: FAILED")

if __name__ == "__main__":
    benchmark()

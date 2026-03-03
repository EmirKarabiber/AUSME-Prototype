import sys
import os
import torch
import numpy as np

# Add the directory to sys.path
sys.path.append(os.getcwd())

from extract_keywords import (
    load_vocab,
    extract_opportunity_keywords
)
from sentence_transformers import SentenceTransformer

def debug_run():
    vocab_embeddings, vocab_names, vocab_concepts = load_vocab()
    model = SentenceTransformer("Qwen/Qwen3-Embedding-0.6B", device="cpu")
    
    text = "This is a test document."
    title = "Test Title"
    
    try:
        gen = extract_opportunity_keywords(
            description=text,
            title=title,
            model=model,
            vocab_embeddings=vocab_embeddings,
            vocab_names=vocab_names,
            vocab_concepts=vocab_concepts
        )
        for event in gen:
            print(event.get("phase"), event.get("keyword"))
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    debug_run()

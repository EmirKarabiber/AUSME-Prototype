import os
import json
import argparse
from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS

from extract_keywords import load_vocab, extract_opportunity_keywords, resolve_device
from sentence_transformers import SentenceTransformer

app = Flask(__name__, static_folder=".")
CORS(app)

parser = argparse.ArgumentParser(description="Keyword Extraction Server")
parser.add_argument("--cpu", action="store_true", help="Force CPU extraction")
args, unknown = parser.parse_known_args()

print("Loading vocab embeddings...")
vocab_embeddings, vocab_names, vocab_concepts = load_vocab()

print("Loading model...")
device = resolve_device("cpu" if args.cpu else "auto")
model = SentenceTransformer("Qwen/Qwen3-Embedding-0.6B", device=device)

print("Loading opportunities...")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OPP_FILE = os.path.join(SCRIPT_DIR, "opportunities.json")
try:
    with open(OPP_FILE, "r", encoding="utf-8") as f:
        opportunities = json.load(f)
    print(f"Loaded {len(opportunities)} opportunities.")
except FileNotFoundError:
    opportunities = []
    print("Warning: opportunities.json not found.")

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/api/search")
def search():
    query = request.args.get("q", "").lower()
    matches = []
    # limit to 50
    for i, opp in enumerate(opportunities):
        title = opp.get("title") or ""
        number = opp.get("number") or ""
        opp_id = str(opp.get("opp_id"))
        
        # In a real app we'd use a real ID, but here we'll use the list index as a unique ID 
        # to handle instances where there are multiple opportunities with the same opp_id.
        unique_id = f"{opp_id}_{i}"
        
        if query in title.lower() or query in number.lower() or query == opp_id:
            matches.append({
                "unique_id": unique_id,
                "opp_id": opp_id,
                "title": title,
                "number": number
            })
            if len(matches) >= 50:
                break
    return jsonify(matches)

@app.route("/api/opportunities/<unique_id>")
def get_opportunity(unique_id):
    # Parse our synthetic unique ID (opp_id_index)
    try:
        parts = unique_id.split("_")
        idx = int(parts[-1])
        opp = opportunities[idx]
    except (ValueError, IndexError):
        return jsonify({"error": "Not found"}), 404
        
    description = opp.get("description", "")
    
    return jsonify({
        "unique_id": unique_id,
        "opp_id": opp.get("opp_id", ""),
        "title": opp.get("title", ""),
        "number": opp.get("number", ""),
        "url": opp.get("url", ""),
        "text": description
    })

@app.route("/api/extract/<unique_id>", methods=["POST"])
def extract(unique_id):
    try:
        parts = unique_id.split("_")
        idx = int(parts[-1])
        opp = opportunities[idx]
    except (ValueError, IndexError):
        return jsonify({"error": "Not found"}), 404
        
    description = opp.get("description", "")
    title = opp.get("title", "")
    
    def generate():
        for update_event in extract_opportunity_keywords(
            description=description,
            title=title,
            model=model,
            vocab_embeddings=vocab_embeddings,
            vocab_names=vocab_names,
            vocab_concepts=vocab_concepts
        ):
            yield f"data: {json.dumps(update_event)}\n\n"
            
    return Response(generate(), mimetype="text/event-stream")

@app.route("/api/extract_manual", methods=["POST"])
def extract_manual():
    data = request.json
    description = data.get("description", "")
    title = data.get("title", "")
    
    def generate():
        for update_event in extract_opportunity_keywords(
            description=description,
            title=title,
            model=model,
            vocab_embeddings=vocab_embeddings,
            vocab_names=vocab_names,
            vocab_concepts=vocab_concepts
        ):
            yield f"data: {json.dumps(update_event)}\n\n"
            
    return Response(generate(), mimetype="text/event-stream")

if __name__ == "__main__":
    app.run(port=5000, debug=False)

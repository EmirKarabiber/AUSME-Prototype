import json

with open("opportunities.json", "r", encoding="utf-8") as f:
    data = json.load(f)

print(f"Total opportunities in file: {len(data)}")

# Search for ID 338870
all_338870s = [opp for opp in data if str(opp.get("opp_id")) == "338870"]

print("--- Matches for 338870 ---")
for x in all_338870s:
    print(f"opp_id: {x.get('opp_id')} | num: {x.get('number')} | title: {x.get('title')}")

# Search for the "2022 Ambassador's Special Self-Help Program" to see what its ID actually is
ambassadors = [opp for opp in data if "2022 Ambassador" in opp.get("title", "") and len(opp.get("description", "")) > 40000]

print("\n--- Massive Ambassador Programs ---")
for a in ambassadors:
    print(f"opp_id: {a.get('opp_id')} | num: {a.get('number')} | title: {a.get('title')}")

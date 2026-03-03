import json

with open("opportunities.json", "r", encoding="utf-8") as f:
    data = json.load(f)

data.sort(key=lambda x: len(x.get("description", "")), reverse=True)

with open("ids.txt", "w", encoding="utf-8") as out:
    for i in range(5):
        t = data[i].get("title", "")
        oid = data[i].get("opp_id", "")
        num = data[i].get("number", "")
        out.write(f"Title: {t}\nID: {oid}\nNum: {num}\n\n")

import json

with open('opportunities.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Find a median-sized one (~1800 chars) for a good test
test_opp = next(x for x in data if 1700 < len(x.get('description', '')) < 1900)

with open('test_opportunity.txt', 'w', encoding='utf-8') as f:
    f.write(test_opp.get('title', '') + '\n\n')
    f.write(test_opp.get('description', ''))

print(f'Created test_opportunity.txt from opportunity: {test_opp.get("title", "")}')

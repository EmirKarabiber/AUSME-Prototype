import json
import statistics

with open('opportunities.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    
lengths = [len(x.get('description', '')) for x in data]
print(f'Total Opportunities: {len(data)}')
print(f'Average Description Length: {statistics.mean(lengths):.0f} characters')
print(f'Median Description Length: {statistics.median(lengths):.0f} characters')
print(f'Max Description Length: {max(lengths)} characters')
print(f'Min Description Length: {min(lengths)} characters')

print('\n--- Longest Example ---')
longest = max(data, key=lambda x: len(x.get('description', '')))
print(f'Title: {longest.get("title", "")}')
print(f'Description (first 500 chars): {longest.get("description", "")[:500]}...')
print(f'Length: {len(longest.get("description", ""))} chars')

print('\n--- Shortest Example ---')
shortest = min(data, key=lambda x: len(x.get('description', '')))
print(f'Title: {shortest.get("title", "")}')
print(f'Description: {shortest.get("description", "")}')
print(f'Length: {len(shortest.get("description", ""))} chars')

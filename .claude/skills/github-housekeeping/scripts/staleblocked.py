"""Stale backlog scan per Trin 4 Kategori E (done >14d) + F (todo >30d).

Usage:
    PYTHONUTF8=1 python staleblocked.py

Reads $TEMP/audit-open-all.json.

Output: Kategori E + F + top 10 oldest todo (for awareness).
"""
import json, os
from datetime import datetime, timezone, timedelta

TMP = os.environ.get('TEMP', '/tmp')
now = datetime.now(timezone.utc)
cutoff_done = now - timedelta(days=14)
cutoff_todo = now - timedelta(days=30)

with open(os.path.join(TMP, 'audit-open-all.json'), encoding='utf-8') as f:
    issues = json.load(f)

stale_done = []
stale_todo = []
for i in issues:
    labels = [l['name'] for l in i.get('labels',[])]
    upd = datetime.fromisoformat(i['updatedAt'].replace('Z','+00:00'))
    days_old = (now - upd).days
    if 'claude:done' in labels and upd < cutoff_done:
        stale_done.append((i['number'], days_old, i['title'][:70]))
    if 'claude:todo' in labels and upd < cutoff_todo:
        stale_todo.append((i['number'], days_old, i['title'][:70]))

print("=== Kategori E: claude:done >14d ===")
for x in sorted(stale_done, key=lambda y: -y[1]):
    print(f"  #{x[0]} ({x[1]}d): {x[2]}")
print(f"\n=== Kategori F: claude:todo >30d ===")
for x in sorted(stale_todo, key=lambda y: -y[1])[:20]:
    print(f"  #{x[0]} ({x[1]}d): {x[2]}")

top_todo = []
for i in issues:
    labels = [l['name'] for l in i.get('labels',[])]
    if 'claude:todo' in labels:
        upd = datetime.fromisoformat(i['updatedAt'].replace('Z','+00:00'))
        days_old = (now - upd).days
        top_todo.append((i['number'], days_old, i['title'][:70]))
top_todo.sort(key=lambda y: -y[1])
print(f"\n=== Top 10 oldest claude:todo (info) ===")
for x in top_todo[:10]:
    print(f"  #{x[0]} ({x[1]}d): {x[2]}")

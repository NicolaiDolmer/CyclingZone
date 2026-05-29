"""Stale backlog scan per Trin 4 Kategori E (done >14d) + F (todo >30d).

Usage:
    PYTHONUTF8=1 python staleblocked.py            # menneskelæsbar (default)
    PYTHONUTF8=1 python staleblocked.py --json       # maskinlæsbar JSON til digest Tier-3-sektioner

Reads $TEMP/audit-open-all.json.

Output: Kategori E + F + top 10 oldest todo (for awareness).
Stale/dødt todo eskaleres til triage — det lukkes ALDRIG automatisk (ikke "leveret").
"""
import json, os, sys
from datetime import datetime, timezone, timedelta

TMP = os.environ.get('TEMP', '/tmp')
AS_JSON = '--json' in sys.argv
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

top_todo = []
for i in issues:
    labels = [l['name'] for l in i.get('labels',[])]
    if 'claude:todo' in labels:
        upd = datetime.fromisoformat(i['updatedAt'].replace('Z','+00:00'))
        days_old = (now - upd).days
        top_todo.append((i['number'], days_old, i['title'][:70]))
top_todo.sort(key=lambda y: -y[1])

if AS_JSON:
    print(json.dumps({
        'stale_done_14d': [{'number': n, 'days': d, 'title': t} for n, d, t in sorted(stale_done, key=lambda y: -y[1])],
        'stale_todo_30d': [{'number': n, 'days': d, 'title': t} for n, d, t in sorted(stale_todo, key=lambda y: -y[1])],
        'top_oldest_todo': [{'number': n, 'days': d, 'title': t} for n, d, t in top_todo[:10]],
    }, ensure_ascii=False, indent=2))
else:
    print("=== Kategori E: claude:done >14d ===")
    for x in sorted(stale_done, key=lambda y: -y[1]):
        print(f"  #{x[0]} ({x[1]}d): {x[2]}")
    print(f"\n=== Kategori F: claude:todo >30d ===")
    for x in sorted(stale_todo, key=lambda y: -y[1])[:20]:
        print(f"  #{x[0]} ({x[1]}d): {x[2]}")
    print(f"\n=== Top 10 oldest claude:todo (info) ===")
    for x in top_todo[:10]:
        print(f"  #{x[0]} ({x[1]}d): {x[2]}")

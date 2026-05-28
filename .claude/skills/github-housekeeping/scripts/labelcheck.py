"""Label conflict check per Trin 4 Kategori D.

Usage:
    PYTHONUTF8=1 python labelcheck.py

Reads $TEMP/audit-open-all.json.

Output: 4-state-machine conflicts (todo+done, todo+blocked, in_progress+done, in_progress+blocked),
plus in_progress list (with idle-hours since updatedAt; >48h flagged STALE) and no_claude_state list.
"""
import json, os
from datetime import datetime, timezone

TMP = os.environ.get('TEMP', '/tmp')
STALE_INPROGRESS_HOURS = 48

with open(os.path.join(TMP, 'audit-open-all.json'), encoding='utf-8') as f:
    issues = json.load(f)

now = datetime.now(timezone.utc)


def hours_since(iso):
    if not iso: return None
    t = datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return (now - t).total_seconds() / 3600

conflicts = {
    'todo_done': [],
    'todo_blocked': [],
    'in_progress_done': [],
    'in_progress_blocked': [],
    'no_claude_state': [],
    'in_progress': [],
}
for i in issues:
    labels = [l['name'] for l in i.get('labels',[])]
    has_todo = 'claude:todo' in labels
    has_done = 'claude:done' in labels
    has_blocked = 'claude:blocked' in labels
    has_inprog = 'claude:in-progress' in labels
    has_any = has_todo or has_done or has_blocked or has_inprog
    if has_todo and has_done: conflicts['todo_done'].append(i['number'])
    if has_todo and has_blocked: conflicts['todo_blocked'].append(i['number'])
    if has_inprog and has_done: conflicts['in_progress_done'].append(i['number'])
    if has_inprog and has_blocked: conflicts['in_progress_blocked'].append(i['number'])
    if has_inprog: conflicts['in_progress'].append((i['number'], i.get('updatedAt'), i['title'][:70]))
    if not has_any: conflicts['no_claude_state'].append((i['number'], i['title'][:70]))

print("=== Label-konflikter ===")
for k, v in conflicts.items():
    if k == 'in_progress':
        print(f"  in_progress: {len(v)}")
        for num, upd, title in v[:10]:
            h = hours_since(upd)
            hs = f"{h:.1f}h" if h is not None else "—"
            stale = "  ⚠️ STALE (resume/re-triage?)" if (h is not None and h > STALE_INPROGRESS_HOURS) else ""
            print(f"    (#{num}, idle {hs}, '{title}'){stale}")
    elif k == 'no_claude_state':
        print(f"  no_claude_state: {len(v)}")
        for x in v[:10]:
            print(f"    {x}")
    else:
        print(f"  {k}: {v}")

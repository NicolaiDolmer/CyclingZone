"""Cross-reference merged PRs against open issues per Trin 2.

Usage:
    PYTHONUTF8=1 python crossref.py

Reads:
  - $TEMP/audit-pr-merged.json (`gh pr list --state merged --limit 200 --json number,title,mergedAt,body`)
  - $TEMP/audit-open-all.json (`gh issue list --state open --limit 300 --json number,title,labels,updatedAt`)

Output:
  - Kategori A: CLOSE-intent vs open issue without claude:done
  - Kategori J: orphan PRs without any #N ref (filtered for dependabot/chore-deps)
  - Brugerverifikation stats (fully / partial / all_unchecked / section_no_boxes / no_section)
"""
import json, re, os
from datetime import datetime, timezone, timedelta

TMP = os.environ.get('TEMP', '/tmp')
now = datetime.now(timezone.utc)
cutoff = now - timedelta(days=14)

with open(os.path.join(TMP, 'audit-pr-merged.json'), encoding='utf-8') as f:
    prs = json.load(f)
with open(os.path.join(TMP, 'audit-open-all.json'), encoding='utf-8') as f:
    open_issues = json.load(f)

open_nums = {i['number']: [l['name'] for l in i.get('labels',[])] for i in open_issues}

CLOSE_RE = re.compile(r'(?:Closes|Fixes|Resolves)\s*#(\d+)', re.IGNORECASE)
REF_RE = re.compile(r'(?:Refs|Updates|Implements|See)\s*#(\d+)', re.IGNORECASE)
ANY_RE = re.compile(r'#(\d+)')


def parse_bv(body):
    """Parse Brugerverifikation section. Returns (category, checked, total)."""
    if not body: return ('no_section', 0, 0)
    m = re.search(r'##+\s*Brugerverifikation', body, re.IGNORECASE)
    if not m: return ('no_section', 0, 0)
    after = body[m.end():]
    end = re.search(r'\n##+\s', after)
    if end: after = after[:end.start()]
    checked = len(re.findall(r'^\s*-\s*\[x\]', after, re.MULTILINE | re.IGNORECASE))
    unchecked = len(re.findall(r'^\s*-\s*\[ \]', after, re.MULTILINE))
    total = checked + unchecked
    if total == 0: return ('section_no_boxes', 0, 0)
    if checked == total: return ('fully', checked, total)
    if checked == 0: return ('all_unchecked', 0, total)
    return ('partial', checked, total)


bv_stats = {'fully': 0, 'partial': 0, 'all_unchecked': 0, 'section_no_boxes': 0, 'no_section': 0}
recent_prs_count = 0
missing_done_label = []
orphan_prs = []

for pr in prs:
    mt = pr.get('mergedAt')
    if not mt: continue
    mtd = datetime.fromisoformat(mt.replace('Z','+00:00'))
    if mtd < cutoff: continue
    recent_prs_count += 1
    body = pr.get('body') or ''
    title = pr.get('title') or ''
    full = body + ' ' + title
    closes = set(int(n) for n in CLOSE_RE.findall(full))
    any_refs = set(int(n) for n in ANY_RE.findall(full))
    for n in closes:
        if n in open_nums and 'claude:done' not in open_nums[n]:
            missing_done_label.append({'pr': pr['number'], 'issue': n, 'title': pr['title']})
    if not any_refs:
        t = title.lower()
        if not t.startswith(('chore(deps)','build(deps)')) and 'dependabot' not in t:
            orphan_prs.append({'pr': pr['number'], 'title': pr['title']})
    cat, _, _ = parse_bv(body)
    bv_stats[cat] += 1

print(f"=== Merged PRs sidste 14d: {recent_prs_count} ===")
print(f"\n=== Kategori A: CLOSE-intent vs open uden claude:done ({len(missing_done_label)}) ===")
for x in missing_done_label[:20]:
    print(f"  PR #{x['pr']} closes #{x['issue']}: {x['title'][:70]}")
print(f"\n=== Kategori J: orphan PRs uden #N ({len(orphan_prs)}) ===")
for x in orphan_prs[:30]:
    print(f"  PR #{x['pr']}: {x['title'][:70]}")
print(f"\n=== Brugerverifikation stats (last 14d, {recent_prs_count} PRs) ===")
for k, v in bv_stats.items():
    print(f"  {k:<20}: {v}")

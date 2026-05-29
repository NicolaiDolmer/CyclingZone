"""Cross-reference merged PRs against open issues per Trin 2.

Usage:
    PYTHONUTF8=1 python crossref.py            # menneskelæsbar (default)
    PYTHONUTF8=1 python crossref.py --json       # maskinlæsbar JSON til auto-close-routinen

Reads:
  - $TEMP/audit-pr-merged.json (`gh pr list --state merged --limit 200 --json number,title,mergedAt,body`)
  - $TEMP/audit-open-all.json (`gh issue list --state open --limit 300 --json number,title,labels,updatedAt`)

Output:
  - Kategori A: CLOSE-intent vs open issue without claude:done (label-glemt)
  - close_intent_open: ALLE åbne issues med en merged PR der bruger Closes/Fixes/Resolves #N
    (uanset done-label) → Tier-1-close-intent-kandidater. Routinen cross-verificerer commit på main + backend-label.
  - Kategori J: orphan PRs without any #N ref (filtered for dependabot/chore-deps)
  - Brugerverifikation stats (fully / partial / all_unchecked / section_no_boxes / no_section)
"""
import json, re, os, sys
from datetime import datetime, timezone, timedelta

TMP = os.environ.get('TEMP', '/tmp')
AS_JSON = '--json' in sys.argv
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

BACKEND_LABELS = ('cat:infra','cat:ai-ops','type:docs','type:ci','backend-only','docs-only','security','type:investigation','type:refactor')
FORBIDDEN_LABELS = ('needs-user-action', 'manual:user', 'needs-decision', 'manual-review', 'auto-close-veto')


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


def tier_hint(labels):
    """Foreløbig tier-hint ud fra labels alene (routinen cross-verificerer commit på main)."""
    if any(l in labels for l in FORBIDDEN_LABELS) or any(l.startswith('epic:') for l in labels):
        return 3
    if 'cat:user-feature' in labels:
        return 2
    if any(l in labels for l in BACKEND_LABELS):
        return 1
    return 1  # ingen cat-label → konservativ Tier-1-kandidat, dobbelttjek scope


bv_stats = {'fully': 0, 'partial': 0, 'all_unchecked': 0, 'section_no_boxes': 0, 'no_section': 0}
recent_prs_count = 0
missing_done_label = []
orphan_prs = []
close_intent_open = []  # alle åbne issues med merged Closes-PR → auto-close-kandidater

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
        if n in open_nums:
            labels = open_nums[n]
            close_intent_open.append({
                'pr': pr['number'], 'issue': n, 'title': pr['title'],
                'tier_hint': tier_hint(labels), 'labels': labels,
                'needs_xverify': ['pr_merged', 'commit_on_main'],
            })
            if 'claude:done' not in labels:
                missing_done_label.append({'pr': pr['number'], 'issue': n, 'title': pr['title']})
    if not any_refs:
        t = title.lower()
        if not t.startswith(('chore(deps)','build(deps)')) and 'dependabot' not in t:
            orphan_prs.append({'pr': pr['number'], 'title': pr['title']})
    cat, _, _ = parse_bv(body)
    bv_stats[cat] += 1

if AS_JSON:
    print(json.dumps({
        'merged_prs_14d': recent_prs_count,
        'kategori_a_missing_done': missing_done_label,
        'close_intent_open': close_intent_open,
        'orphan_prs': orphan_prs,
        'bv_stats': bv_stats,
    }, ensure_ascii=False, indent=2))
else:
    print(f"=== Merged PRs sidste 14d: {recent_prs_count} ===")
    print(f"\n=== close-intent (Closes/Fixes/Resolves) mod ÅBENT issue ({len(close_intent_open)}) — Tier-1-close-kandidater ===")
    for x in close_intent_open[:30]:
        print(f"  PR #{x['pr']} closes #{x['issue']} (tier-hint {x['tier_hint']}): {x['title'][:60]}")
    print(f"\n=== Kategori A: CLOSE-intent vs open uden claude:done ({len(missing_done_label)}) ===")
    for x in missing_done_label[:20]:
        print(f"  PR #{x['pr']} closes #{x['issue']}: {x['title'][:70]}")
    print(f"\n=== Kategori J: orphan PRs uden #N ({len(orphan_prs)}) ===")
    for x in orphan_prs[:30]:
        print(f"  PR #{x['pr']}: {x['title'][:70]}")
    print(f"\n=== Brugerverifikation stats (last 14d, {recent_prs_count} PRs) ===")
    for k, v in bv_stats.items():
        print(f"  {k:<20}: {v}")

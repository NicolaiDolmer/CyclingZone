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
  - Kategori K (glemt-done): ÅBNE ikke-done-issues med en kvalificerende merged PR via ENHVER #N-ref
    (Refs/parenthetical/Closes), efter støj-filter. Dette repo bruger næsten altid `Refs #N` (ikke Closes),
    så et leveret issue der blev glemt at markere/lukke falder ellers igennem hver audit. Lektion 2026-06-02:
    8+ dev-færdige issues lå i claude:todo (#532/#719/#646 lukket, #793/#19/#896 → done). KRÆVER scope-verify
    (script kan ikke skelne levering fra delvis/incidentel) — surface kun, auto-luk ALDRIG.
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
open_title = {i['number']: i.get('title','') for i in open_issues}

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
forgotten_refs = {}  # {issue#: [pr#]} for ALLE merged PRs (glemt-done akkumulerer over tid, ikke kun 14d)
pr_title = {}        # {pr#: title}

for pr in prs:
    mt = pr.get('mergedAt')
    if not mt: continue
    mtd = datetime.fromisoformat(mt.replace('Z','+00:00'))
    # glemt-done-indsamling sker FØR 14d-cutoff (bruger alle 200 merged PRs)
    _full_all = (pr.get('body') or '') + ' ' + (pr.get('title') or '')
    pr_title[pr['number']] = pr.get('title') or ''
    for _n in set(int(x) for x in ANY_RE.findall(_full_all)):
        if _n in open_nums:
            forgotten_refs.setdefault(_n, []).append(pr['number'])
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


# === Kategori K: glemt-done cross-ref (lektion 2026-06-02) ===
# Åbne ikke-done-issues med en KVALIFICERENDE merged PR via enhver #N-ref.
# Bruger ALLE 200 merged PRs (ikke kun 14d) — glemt-done akkumulerer over tid.
def is_incidental_pr(title):
    """PR-typer der typisk kun NÆVNER #N uden at LEVERE det (false-positive-kilder fra 2026-06-02)."""
    t = (title or '').lower()
    if t.startswith(('chore(deps', 'build(deps')) or 'dependabot' in t or 'bump ' in t:
        return True  # dep-bumps: deres egen changelog indeholder fremmede #-numre (brace-expansion m.fl.)
    if t.startswith('docs(now)'):
        return True  # NOW.md-close-outs nævner #N i changelog uden at levere
    if 'milestones for epic' in t or t.startswith('chore(github): milestones'):
        return True  # epic-milestone-PR lister sub-issues uden at levere dem
    return False

forgotten_done = []
for n, labels in open_nums.items():
    if 'claude:done' in labels:
        continue  # håndteres af score_done (Kategori B/C)
    if any(l in labels for l in FORBIDDEN_LABELS) or any(l.startswith('epic:') for l in labels):
        continue  # NUA/blocked/manual/epic = legitimt åbne
    title = open_title.get(n, '')
    if title.lower().startswith('[epic]') or '[epic]' in title.lower():
        continue
    quals = sorted(set(p for p in forgotten_refs.get(n, []) if not is_incidental_pr(pr_title.get(p, ''))))
    if quals:
        forgotten_done.append({
            'issue': n, 'title': title, 'labels': labels,
            'pr_candidates': quals,
            'note': 'VERIFICÉR scope mod PR — levering vs delvis/incidentel',
        })
forgotten_done.sort(key=lambda x: -x['issue'])

if AS_JSON:
    print(json.dumps({
        'merged_prs_14d': recent_prs_count,
        'kategori_a_missing_done': missing_done_label,
        'close_intent_open': close_intent_open,
        'kategori_k_forgotten_done': forgotten_done,
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
    print(f"\n=== Kategori K: glemt-done — åbne ikke-done-issues m. kvalificerende merged PR ({len(forgotten_done)}) ===")
    print("    (VERIFICÉR scope mod PR før close/done — script skelner ikke levering fra delvis/incidentel)")
    for x in forgotten_done[:40]:
        st = ','.join(l for l in x['labels'] if l.startswith('claude:')) or 'NO-STATE'
        prs_str = ' '.join(f"#{p}" for p in x['pr_candidates'])
        print(f"  #{x['issue']} [{st}] {x['title'][:48]}\n       PRs: {prs_str}")
    print(f"\n=== Kategori J: orphan PRs uden #N ({len(orphan_prs)}) ===")
    for x in orphan_prs[:30]:
        print(f"  PR #{x['pr']}: {x['title'][:70]}")
    print(f"\n=== Brugerverifikation stats (last 14d, {recent_prs_count} PRs) ===")
    for k, v in bv_stats.items():
        print(f"  {k:<20}: {v}")

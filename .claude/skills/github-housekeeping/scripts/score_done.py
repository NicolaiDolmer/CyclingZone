"""Score claude:done issues per Trin 3 + tier-klassifikation for auto-close.

Usage:
    PYTHONUTF8=1 python score_done.py            # menneskelæsbar tabel (default)
    PYTHONUTF8=1 python score_done.py --json      # maskinlæsbar JSON til auto-close-routinen

Reads $TEMP/audit-done.json (produced by `gh issue list --state open --label "claude:done" --json number,title,labels,comments,updatedAt`).

Output (print): per-issue table with score, hours since last comment, author, flags, evidence.
Output (--json): list of dicts incl. score + tier + auto_close_candidate + needs_xverify + blockers + reason.

**Tier-klassifikation er FORELØBIG.** Scriptet ser kun issue-tekst + labels — det ved IKKE om en PR er
merged eller om en commit er på main. Et issue markeret `auto_close_candidate: true` har bestået alle
tekst-/label-baserede gates, men routinen SKAL stadig cross-verificere alt i `needs_xverify` (PR state=MERGED,
commit på origin/main, og for Tier 2 et Vercel/Supabase-match) FØR den faktisk lukker. Kan en cross-verify
ikke gennemføres → eskalér i stedet for at lukke.

  Tier 1 = backend/docs/CI/security (uden cat:user-feature): STRONG ≥24h ELLER NO_COMMENTS
           → needs_xverify: pr_merged + commit_on_main
  Tier 2 = cat:user-feature: STRONG ≥24h
           → needs_xverify: vercel_or_supabase_match + pr_merged + commit_on_main (match obligatorisk)
  Tier 3 = alt andet → eskalér til daglig digest (luk ALDRIG)

Edit STRONG_PATTERNS / NEG_KEYWORDS / WORK_PENDING_PATTERNS / FORBIDDEN_LABELS to tune.
"""
import json, re, os, sys
from datetime import datetime, timezone

TMP = os.environ.get('TEMP', '/tmp')
AS_JSON = '--json' in sys.argv

with open(os.path.join(TMP, 'audit-done.json'), encoding='utf-8') as f:
    issues = json.load(f)

now = datetime.now(timezone.utc)

STRONG_PATTERNS = [
    r'verify-deploy\.ps1\s*OK',
    r'verificeret\s+(?:p[åa]\s+)?prod',
    r'verified\s+on\s+prod',
    r'deploy(?:ment)?[\s-]*OK',
    r'\bHTTP\s+200\b.*prod',
    r'prod[-\s]*verifikation',
    r'prod[-\s]*verification',
    r'[Ll]ive\s+verificeret',
    r'verificeret\s+live',
    r'200\s*OK.*\bcycling-zone\.vercel\.app\b',
    r'\bcycling-zone\.vercel\.app\b.*200\s*OK',
    r'merget\s+til\s+main.*deployet\s+til\s+prod',
    r'(?:Migration\s+)?anvendt\s+p[åa]\s+prod',
]

NEG_KEYWORDS = [
    r'klar til din verifikation',
    r'awaiting verification',
    r'please verify',
    r'b[øo]r tage\s+~?\d+\s*min',
    r'🟡',
    r'⚠️',
    r'kr[æa]ver user-action',
    r'kan ikke .* via API',
    r'kun g[øo]res manuelt',
    r'resterende cleanup',
]

WORK_PENDING_PATTERNS = [
    r'N[æa]ste session', r'next session', r'bagudretter', r'efter merge', r'mangler',
    # Eksplicitte ejer-verify-pending-markører (lektion 2026-06-03 #19): et type:bug/bar-label
    # backend-close-kandidat med "afventer din manuelle spot-check" SKAL ned-grades til Tier3,
    # ikke auto-lukkes — selvom backend-tests er grønne, er den brugervendte adfærd ikke ejer-verificeret.
    r'afventer\s+(?:kun\s+)?(?:din|dit|ejer)', r'spot-?check', r'kun du kan',
    r'manuel(?:t|le)?\s+(?:ejer-?)?verif',
]

BACKEND_LABELS = ('cat:infra','cat:ai-ops','type:docs','type:ci','backend-only','docs-only','security','type:investigation','type:refactor')

# Labels der ALDRIG må auto-lukkes (forbidden zones, jf. routine-prompt sikkerhedsnet).
# epic:* håndteres separat via prefix-check. auto-close-veto = issue reopenet efter tidligere auto-close.
FORBIDDEN_LABELS = ('needs-user-action', 'manual:user', 'needs-decision', 'manual-review', 'auto-close-veto')

STRONG_MIN_HOURS = 24


def hours_since(iso):
    if not iso: return None
    t = datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return (now - t).total_seconds() / 3600


def classify_tier(score, hours, is_backend, is_user_feature, forbidden, neg_match, work_pending):
    """Foreløbig tier-klassifikation. Returnér (tier, auto_close_candidate, needs_xverify, blockers, reason)."""
    blockers = []
    if forbidden:
        blockers.append(f'forbidden:{forbidden}')
    if neg_match:
        blockers.append(f'neg:{neg_match[:24]}')
    if work_pending:
        blockers.append('work-pending')
    if blockers:
        return (3, False, [], blockers, 'eskalér: ' + ', '.join(blockers))

    enough_age = (hours is None) or (hours >= STRONG_MIN_HOURS)

    # Tier 2: user-feature tager forrang (selv hvis også backend-label) — UI-verify er den meningsfulde test.
    if is_user_feature:
        if score == 'STRONG' and enough_age:
            return (2, True, ['vercel_or_supabase_match', 'pr_merged', 'commit_on_main'], [],
                    'Tier2: user-feature STRONG ≥24h → KRÆVER uafhængigt MCP-match, ellers eskalér')
        if score == 'STRONG':
            return (3, False, [], ['strong-<24h'], f'vent: user-feature STRONG men kun {hours:.1f}h (<24h)')
        return (3, False, [], [f'score:{score}'], f'eskalér: user-feature score={score} — UI-verify selv')

    # Tier 1: backend/docs/CI/security uden user-feature.
    if is_backend:
        if score == 'NO_COMMENTS':
            return (1, True, ['pr_merged', 'commit_on_main'], [],
                    'Tier1: backend NO_COMMENTS → verificér merged PR (Refs/Closes) + commit på main')
        if score == 'STRONG' and enough_age:
            return (1, True, ['pr_merged', 'commit_on_main'], [],
                    'Tier1: backend STRONG ≥24h → verificér merged PR + commit på main')
        if score == 'STRONG':
            return (3, False, [], ['strong-<24h'], f'vent: backend STRONG men kun {hours:.1f}h (<24h)')
        return (3, False, [], [f'score:{score}'], f'eskalér: backend men score={score}')

    # Ingen cat-label: behandl konservativt som Tier 1-kandidat hvis STRONG ≥24h, ellers eskalér.
    if score == 'STRONG' and enough_age:
        return (1, True, ['pr_merged', 'commit_on_main'], ['no-cat-label'],
                'Tier1?: ingen cat-label, STRONG ≥24h → verificér merged PR + commit (dobbelttjek scope)')
    return (3, False, [], [f'score:{score}', 'no-cat-label'], f'eskalér: ingen cat-label, score={score}')


def score_issue(issue):
    comments = issue.get('comments', [])
    labels = [l['name'] for l in issue.get('labels', [])]
    is_backend = any(l in labels for l in BACKEND_LABELS)
    is_user_feature = 'cat:user-feature' in labels
    is_nua = 'needs-user-action' in labels
    is_epic = any(l.startswith('epic:') for l in labels)
    forbidden = next((l for l in labels if l in FORBIDDEN_LABELS), None) or ('epic' if is_epic else None)

    if not comments:
        tier, cand, xverify, blockers, reason = classify_tier(
            'NO_COMMENTS', None, is_backend, is_user_feature, forbidden, None, False)
        return {
            'number': issue['number'], 'title': issue['title'],
            'labels': labels, 'score': 'NO_COMMENTS', 'hours': None,
            'author': None, 'evidence': '(0 comments)',
            'backend': is_backend, 'user_feature': is_user_feature, 'nua': is_nua,
            'neg': None, 'work_pending': False,
            'tier': tier, 'auto_close_candidate': cand, 'needs_xverify': xverify,
            'blockers': blockers, 'reason': reason,
        }
    last = comments[-1]
    body = last.get('body','')
    author = last.get('author',{}).get('login','?')
    hours = hours_since(last.get('createdAt'))
    has_strong = any(re.search(p, body, re.IGNORECASE) for p in STRONG_PATTERNS)
    neg_match = None
    for p in NEG_KEYWORDS:
        if re.search(p, body, re.IGNORECASE):
            neg_match = p
            break
    unchecked = '- [ ]' in body
    if unchecked and not is_backend:
        neg_match = neg_match or '- [ ] checkbox'
    has_work_pending = any(re.search(p, body, re.IGNORECASE) for p in WORK_PENDING_PATTERNS)
    score = 'WEAK'
    if has_strong and not neg_match:
        score = 'STRONG'
    elif has_strong and neg_match:
        score = 'MEDIUM'
    tier, cand, xverify, blockers, reason = classify_tier(
        score, hours, is_backend, is_user_feature, forbidden, neg_match, has_work_pending)
    return {
        'number': issue['number'], 'title': issue['title'],
        'labels': labels, 'score': score, 'hours': hours,
        'author': author, 'evidence': body[:200].replace('\n',' '),
        'backend': is_backend, 'user_feature': is_user_feature, 'nua': is_nua,
        'neg': neg_match, 'work_pending': has_work_pending,
        'tier': tier, 'auto_close_candidate': cand, 'needs_xverify': xverify,
        'blockers': blockers, 'reason': reason,
    }


results = [score_issue(i) for i in issues]
results.sort(key=lambda x: x['number'])

if AS_JSON:
    print(json.dumps(results, ensure_ascii=False, indent=2))
else:
    for r in results:
        h = f"{r['hours']:.1f}h" if r['hours'] else "—"
        flags = []
        if r['user_feature']: flags.append('user')
        if r['backend']: flags.append('backend')
        if r['nua']: flags.append('NUA')
        if r['neg']: flags.append(f"NEG:{r['neg'][:20]}")
        if r['work_pending']: flags.append('PEND')
        author = r['author'] or 'NONE'
        cand = '→AUTO-CLOSE-CAND' if r['auto_close_candidate'] else ''
        print(f"#{r['number']:>3} {r['score']:<11} {h:>7} T{r['tier']} {cand:<17} by={author:<22} [{','.join(flags)}] {r['title'][:50]}")
        print(f"      reason: {r['reason']}")
        if r['needs_xverify']:
            print(f"      needs_xverify: {', '.join(r['needs_xverify'])}")
        print(f"      ev: {r['evidence'][:130]}")

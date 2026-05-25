"""Score claude:done issues per Trin 3.

Usage:
    PYTHONUTF8=1 python score_done.py

Reads $TEMP/audit-done.json (produced by `gh issue list --state open --label "claude:done" --json number,title,labels,comments,updatedAt`).

Output: per-issue table with score (STRONG/MEDIUM/WEAK/NO_COMMENTS), hours since last comment, author, flags (user/backend/NUA/NEG/PEND), evidence quote.

Edit STRONG_PATTERNS / NEG_KEYWORDS / WORK_PENDING_PATTERNS to tune.
"""
import json, re, os
from datetime import datetime, timezone

TMP = os.environ.get('TEMP', '/tmp')

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
    r'N[æa]ste session', r'next session', r'bagudretter', r'efter merge', r'mangler'
]

BACKEND_LABELS = ('cat:infra','cat:ai-ops','type:docs','type:ci','backend-only','docs-only','security','type:investigation','type:refactor')


def hours_since(iso):
    if not iso: return None
    t = datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return (now - t).total_seconds() / 3600


def score_issue(issue):
    comments = issue.get('comments', [])
    labels = [l['name'] for l in issue.get('labels', [])]
    is_backend = any(l in labels for l in BACKEND_LABELS)
    is_user_feature = 'cat:user-feature' in labels
    is_nua = 'needs-user-action' in labels

    if not comments:
        return {
            'number': issue['number'], 'title': issue['title'],
            'labels': labels, 'score': 'NO_COMMENTS', 'hours': None,
            'author': None, 'evidence': '(0 comments)',
            'backend': is_backend, 'user_feature': is_user_feature, 'nua': is_nua,
            'neg': None, 'work_pending': False,
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
    return {
        'number': issue['number'], 'title': issue['title'],
        'labels': labels, 'score': score, 'hours': hours,
        'author': author, 'evidence': body[:200].replace('\n',' '),
        'backend': is_backend, 'user_feature': is_user_feature, 'nua': is_nua,
        'neg': neg_match, 'work_pending': has_work_pending,
    }


results = [score_issue(i) for i in issues]
results.sort(key=lambda x: x['number'])

for r in results:
    h = f"{r['hours']:.1f}h" if r['hours'] else "—"
    flags = []
    if r['user_feature']: flags.append('user')
    if r['backend']: flags.append('backend')
    if r['nua']: flags.append('NUA')
    if r['neg']: flags.append(f"NEG:{r['neg'][:20]}")
    if r['work_pending']: flags.append('PEND')
    author = r['author'] or 'NONE'
    print(f"#{r['number']:>3} {r['score']:<11} {h:>7} by={author:<25} [{','.join(flags)}] {r['title'][:60]}")
    print(f"      ev: {r['evidence'][:140]}")

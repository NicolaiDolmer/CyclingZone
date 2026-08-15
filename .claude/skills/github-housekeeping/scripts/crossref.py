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

# === Kategori K carry-forward seen-cache (lektion 2026-06-03) ===
# crossref bruger ALLE merged PRs (ingen cutoff), så de samme incidentelle omtaler dukker op hver dag
# og koster sub-agent-runtime ved re-verify. Cachen husker issues der allerede er verificeret legitimt-åbne.
# Format: {"<issue>": {"date": "YYYY-MM-DD", "prs": [pr-numre set ved verify-tidspunkt]}}
# Et candidate markeres prev_legit hvis dets nuværende kvalificerende PR-sæt ⊆ det cachede sæt (intet nyt
# siden sidst). Dukker en NY PR op → prev_legit_stale (re-verificér — der kan være leveret noget nyt).
# Skriv cachen efter verify:  PYTHONUTF8=1 python crossref.py --mark-legit 33,253,266,...
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LEGIT_CACHE = os.path.join(SCRIPT_DIR, 'k-legit-open.json')


def load_legit_cache():
    try:
        with open(LEGIT_CACHE, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

with open(os.path.join(TMP, 'audit-pr-merged.json'), encoding='utf-8') as f:
    prs = json.load(f)
with open(os.path.join(TMP, 'audit-open-all.json'), encoding='utf-8') as f:
    open_issues = json.load(f)


# === Direkte commits på main (lektion 2026-08-15) ===
# crossref matchede oprindeligt KUN mod PR'er. Men docs/chore må gå direkte på main i dette repo
# (hard rule: kun feat/fix/refactor kræver branch+PR), så et issue leveret i en direkte commit var
# usynligt for Kategori K. #3662 blev leveret i commit 91646dff og blev kun fundet ved manuel
# efterprøvning af en agents begrundelse. Vi læser derfor git-log ved siden af PR-listen.
COMMIT_LOG_LIMIT = 800
_REC, _FLD = '\x1e', '\x1f'


def load_main_commits():
    """(sha, subject, body)-tupler fra main. Prøver git direkte, falder tilbage til cache-fil."""
    raw = ''
    try:
        import subprocess
        repo = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', '..'))
        res = subprocess.run(
            ['git', 'log', '-n', str(COMMIT_LOG_LIMIT), f'--format=%H{_FLD}%s{_FLD}%b{_REC}', 'origin/main'],
            cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60,
        )
        raw = res.stdout or ''
    except Exception:
        raw = ''
    if not raw.strip():
        # Fallback: $TEMP/audit-commits-main.txt genereret med samme --format
        try:
            with open(os.path.join(TMP, 'audit-commits-main.txt'), encoding='utf-8') as f:
                raw = f.read()
        except FileNotFoundError:
            return []
    out = []
    for rec in raw.split(_REC):
        rec = rec.strip('\n\r ')
        if not rec:
            continue
        parts = rec.split(_FLD)
        if len(parts) < 2:
            continue
        out.append((parts[0], parts[1], parts[2] if len(parts) > 2 else ''))
    return out


main_commits = load_main_commits()

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


# === Direkte-commit-refs: kun commits der IKKE hører til en kendt merged PR ===
# Squash-merges bærer "(#<pr>)" i subject; merge-commits bærer "Merge pull request #<pr>".
# Alt andet der nævner et åbent issue er en direkte leverance på main.
known_prs = {p['number'] for p in prs}
commit_refs = {}   # {issue#: [sha7]}
commit_subj = {}   # {sha7: subject}
PR_MERGE_RE = re.compile(r'Merge pull request #(\d+)')
PR_SQUASH_RE = re.compile(r'\(#(\d+)\)\s*$')


def is_incidental_commit(subject):
    """Commit-typer der nævner #N uden at levere det."""
    s = (subject or '').lower()
    if s.startswith(('chore(deps', 'build(deps', 'merge ', 'revert ')) or 'dependabot' in s:
        return True
    # `docs(now)` / `docs(now+masterplan)` / `docs(NOW)` er status-commits: NOW.md's close-out-blokke
    # NAVNGIVER 3-8 issues pr. commit uden at levere nogen af dem. Største enkeltstøjkilde i
    # subject-scanningen (22 af 26 kun-commit-kandidater 15/8).
    if s.startswith('docs(now'):
        return True
    return False


for sha, subj, body in main_commits:
    # Repoets squash-konvention hænger ALTID PR-nummeret bagpå: "... (#3105)". Et trailing (#N)
    # eller "Merge pull request #N" betyder derfor PR-afledt, uanset om PR'en ligger i 200-vinduet.
    if PR_MERGE_RE.search(subj) or PR_SQUASH_RE.search(subj):
        continue
    if is_incidental_commit(subj):
        continue
    # Kun SUBJECT scannes, ikke body (lektion 2026-08-15). Close-out- og masterplan-commits
    # opremser 5-15 issuenumre i deres body som status; det er ikke leverance. Står nummeret
    # derimod i selve overskriften — scope (`docs(3659):`) eller tekst ("omskriv efter #3662")
    # — er commit'en skrevet OM det issue. Body-scanning gav 63 kandidater, subject-scanning 9.
    short = sha[:8]
    hits = set(int(x) for x in ANY_RE.findall(subj))
    scope = re.match(r'^\w+\(([^)]*)\)', subj)
    if scope:
        hits |= set(int(x) for x in re.findall(r'\d+', scope.group(1)))
    for n in hits:
        if n in open_nums:
            commit_subj[short] = subj
            commit_refs.setdefault(n, []).append(short)


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

legit_cache = load_legit_cache()
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
    cquals = sorted(set(commit_refs.get(n, [])))
    if quals or cquals:
        # Carry-forward-diff: er dette allerede verificeret legitimt-åbent i en tidligere audit?
        cached = legit_cache.get(str(n))
        prev_legit = False
        prev_date = None
        prev_stale = False
        if cached:
            prev_date = cached.get('date')
            seen_prs = set(cached.get('prs', []))
            # Legacy-entries (skrevet før commit-scanningen 15/8) har ingen 'commits'-nøgle. De må
            # IKKE flagges stale bare fordi commit-evidens nu er synlig for første gang — ellers
            # ryger hele cachen til re-verify på én gang. De seedes i stedet ved næste --mark-legit.
            seen_commits = set(cached['commits']) if 'commits' in cached else set(cquals)
            if set(quals) <= seen_prs and set(cquals) <= seen_commits:
                prev_legit = True       # intet nyt siden verify → spring re-dispatch over
            else:
                prev_stale = True       # NY PR eller NY commit dukket op → re-verificér
        forgotten_done.append({
            'issue': n, 'title': title, 'labels': labels,
            'pr_candidates': quals,
            'commit_candidates': cquals,
            'commit_subjects': {c: commit_subj.get(c, '') for c in cquals},
            'prev_legit': prev_legit, 'prev_legit_date': prev_date, 'prev_legit_stale': prev_stale,
            'note': 'VERIFICÉR scope mod PR/commit — levering vs delvis/incidentel',
        })
forgotten_done.sort(key=lambda x: -x['issue'])

# Writer-mode: marker verificeret-legitimt-åbne issues i cachen efter audit.
if '--mark-legit' in sys.argv:
    idx = sys.argv.index('--mark-legit')
    arg = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else ''
    nums = [int(x) for x in re.split(r'[,\s]+', arg.strip()) if x.strip().isdigit()]
    today = now.strftime('%Y-%m-%d')
    for n in nums:
        quals = sorted(set(p for p in forgotten_refs.get(n, []) if not is_incidental_pr(pr_title.get(p, ''))))
        legit_cache[str(n)] = {'date': today, 'prs': quals, 'commits': sorted(set(commit_refs.get(n, [])))}
    # Ryd cache-entries der ikke længere er åbne K-kandidater (lukket / nu claude:done).
    still_open = {str(x['issue']) for x in forgotten_done}
    for k in list(legit_cache.keys()):
        if k not in still_open and k not in {str(n) for n in nums}:
            del legit_cache[k]
    with open(LEGIT_CACHE, 'w', encoding='utf-8') as f:
        json.dump(legit_cache, f, ensure_ascii=False, indent=2, sort_keys=True)
    print(f"Cache opdateret: {len(nums)} markeret legit-open ({today}); {len(legit_cache)} entries i alt.")
    sys.exit(0)

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
    n_fresh = sum(1 for x in forgotten_done if not x['prev_legit'])
    n_prev = sum(1 for x in forgotten_done if x['prev_legit'])
    print(f"\n=== Kategori K: glemt-done — åbne ikke-done-issues m. kvalificerende merged PR ({len(forgotten_done)}; {n_fresh} til verify, {n_prev} prev-legit) ===")
    print("    (VERIFICÉR scope mod PR før close/done — script skelner ikke levering fra delvis/incidentel)")
    print("    [prev-legit]=allerede verificeret legit-åben i tidl. audit, spring re-dispatch over · [RE-VERIFY]=ny PR siden")
    for x in forgotten_done[:50]:
        if x['prev_legit']:
            continue  # vises samlet nedenfor — fokus på det der kræver verify
        st = ','.join(l for l in x['labels'] if l.startswith('claude:')) or 'NO-STATE'
        tag = ' [RE-VERIFY: ny evidens]' if x['prev_legit_stale'] else ''
        print(f"  #{x['issue']} [{st}]{tag} {x['title'][:48]}")
        if x['pr_candidates']:
            print(f"       PRs: {' '.join(f'#{p}' for p in x['pr_candidates'])}")
        for c in x['commit_candidates']:
            print(f"       COMMIT {c}: {x['commit_subjects'].get(c, '')[:64]}")
    if n_prev:
        prev_list = ' '.join(f"#{x['issue']}" for x in forgotten_done if x['prev_legit'])
        print(f"  --- prev-verified-legit (skip): {prev_list}")
    print(f"\n=== Kategori J: orphan PRs uden #N ({len(orphan_prs)}) ===")
    for x in orphan_prs[:30]:
        print(f"  PR #{x['pr']}: {x['title'][:70]}")
    print(f"\n=== Brugerverifikation stats (last 14d, {recent_prs_count} PRs) ===")
    for k, v in bv_stats.items():
        print(f"  {k:<20}: {v}")

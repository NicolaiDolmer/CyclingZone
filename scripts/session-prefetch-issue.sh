#!/bin/bash
# session-prefetch-issue.sh
# SessionStart hook: pre-fetch active GitHub issue context based on NOW.md
#
# Hvad: Læser docs/NOW.md, finder første #N reference, henter issue + seneste
# 3 comments via gh, og skriver et struktureret resumé til
# .codex.local/SESSION_CONTEXT.md.
#
# Hvorfor: Sparer 300-500 tokens pr. session start ved at undgå manuel
# `gh issue view` round-trip i samtalen. Filen auto-loades af Claude/Codex
# via eksisterende CLAUDE.md startup-step.
#
# Fail-safe: Exit altid 0. Skriver ikke til SESSION_CONTEXT.md hvis
# noget fejler (bevarer evt. eksisterende manuel fil).
#
# Brug: konfigureret som SessionStart hook i .claude/settings.json.

set +e  # Tolerant mod alle fejl — exit 0 til sidst uanset hvad.

REPO="NicolaiDolmer/CyclingZone"
NOW_MD="docs/NOW.md"
OUTPUT_DIR=".codex.local"
OUTPUT_FILE="$OUTPUT_DIR/SESSION_CONTEXT.md"

# 1. Tidlig exit hvis vi ikke er i repo-roden
[ -f "$NOW_MD" ] || exit 0

# 2. Tjek gh er installeret + auth
command -v gh >/dev/null 2>&1 || exit 0
gh auth status >/dev/null 2>&1 || exit 0

# 3. Find første GitHub-issue # i NOW.md.
# Regex-noter:
#   - `(^|[^a-zA-Z0-9])` undgår Discord-tags som "Zone#8784" (# preceded by alnum)
#   - Strategi: prøv først lines 1-25 (typisk "Aktiv slice" + status), fallback
#     til hele filen. Brugeren styrer prioritering ved at placere det aktive
#     #N højt i NOW.md.
extract_issue() {
  local input="$1"
  echo "$input" | grep -oE '(^|[^a-zA-Z0-9])#[0-9]+' | head -1 | tr -dc '0-9'
}
ISSUE=$(extract_issue "$(head -25 "$NOW_MD")")
[ -z "$ISSUE" ] && ISSUE=$(extract_issue "$(cat "$NOW_MD")")
[ -z "$ISSUE" ] && exit 0

# 4. Hent issue + comments i ét kald (én round-trip)
ISSUE_DATA=$(timeout 15 gh issue view "$ISSUE" --repo "$REPO" \
  --json number,title,body,state,labels,url,comments 2>/dev/null)
[ -z "$ISSUE_DATA" ] && exit 0

# 5. Find en JSON-parser. Prefer python3 (most stable), fallback to node.
# Vigtigt: pipe via stdin for at undgå Windows-path-translation-issues
# når git-bash giver `/tmp/...`-stier til en native Windows-python.
PYBIN=""
if command -v python3 >/dev/null 2>&1; then
  PYBIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYBIN="python"
fi

NODEBIN=""
command -v node >/dev/null 2>&1 && NODEBIN="node"

format_with_python() {
  PYTHONIOENCODING=utf-8 "$PYBIN" <<'PYEOF'
import os, sys, json
# Windows-python defaulter til cp1252 for stdout — tving UTF-8 så æøå ikke knækker.
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
raw = os.environ.get('ISSUE_JSON', '')
# På Windows kan env-vars komme som cp1252-bytes når git-bash forwarder dem;
# ISSUE_JSON er rent ASCII (gh outputter UTF-8 men bash pipes som bytes), så
# vi forsøger først direkte parse, ellers re-decode.
try:
    d = json.loads(raw)
except Exception as e:
    try:
        d = json.loads(raw.encode('latin-1').decode('utf-8'))
    except Exception:
        print(f"_(JSON parse fejl: {e})_")
        raise SystemExit(0)

title = d.get('title', '(intet title)')
state = d.get('state', '?')
labels = ', '.join(l.get('name', '') for l in d.get('labels', []))
url = d.get('url', '')
body = (d.get('body') or '').strip() or '_(ingen body)_'

print(f"## Aktivt issue: #{d.get('number', '?')} — {title}")
print()
print(f"**State:** {state}")
print(f"**Labels:** {labels}")
print(f"**URL:** {url}")
print()
print("### Body")
print()
print(body)
print()
print("### Seneste 3 comments")
print()

cs = d.get('comments') or []
cs.sort(key=lambda c: c.get('createdAt', ''))
recent = cs[-3:]

if not recent:
    print("_(ingen comments)_")
else:
    for c in recent:
        author = (c.get('author') or {}).get('login', 'unknown')
        created = (c.get('createdAt') or '').replace('T', ' ')
        # Trim "2026-05-06 12:34:56Z" → "2026-05-06 12:34"
        if 'Z' in created:
            created = created.split('Z')[0]
        if '.' in created:
            created = created.split('.')[0]
        if len(created) >= 16:
            created = created[:16]
        body_c = (c.get('body') or '').strip()
        print(f"**{author}** · {created}")
        print()
        print(body_c)
        print()
        print("---")
        print()
PYEOF
}

format_with_node() {
  "$NODEBIN" <<'NODEEOF'
const raw = process.env.ISSUE_JSON || '';
let d;
try { d = JSON.parse(raw); }
catch (e) { console.log(`_(JSON parse fejl: ${e.message})_`); process.exit(0); }
(() => {

  const title = d.title || '(intet title)';
  const state = d.state || '?';
  const labels = (d.labels || []).map(l => l.name || '').join(', ');
  const url = d.url || '';
  const body = ((d.body || '').trim()) || '_(ingen body)_';

  console.log(`## Aktivt issue: #${d.number || '?'} — ${title}`);
  console.log();
  console.log(`**State:** ${state}`);
  console.log(`**Labels:** ${labels}`);
  console.log(`**URL:** ${url}`);
  console.log();
  console.log('### Body');
  console.log();
  console.log(body);
  console.log();
  console.log('### Seneste 3 comments');
  console.log();

  let cs = (d.comments || []).slice();
  cs.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const recent = cs.slice(-3);

  if (!recent.length) {
    console.log('_(ingen comments)_');
  } else {
    recent.forEach(c => {
      const author = (c.author && c.author.login) || 'unknown';
      let created = (c.createdAt || '').replace('T', ' ');
      if (created.includes('Z')) created = created.split('Z')[0];
      if (created.includes('.')) created = created.split('.')[0];
      if (created.length >= 16) created = created.substring(0, 16);
      const bodyC = (c.body || '').trim();
      console.log(`**${author}** · ${created}`);
      console.log();
      console.log(bodyC);
      console.log();
      console.log('---');
      console.log();
    });
  }
})();
NODEEOF
}

# 6. Format. Pass JSON via env var (ikke stdin) — heredoc claimer ellers stdin.
FORMATTED=""
export ISSUE_JSON="$ISSUE_DATA"
if [ -n "$PYBIN" ]; then
  FORMATTED=$(format_with_python 2>/dev/null)
fi
if [ -z "$FORMATTED" ] && [ -n "$NODEBIN" ]; then
  FORMATTED=$(format_with_node 2>/dev/null)
fi
unset ISSUE_JSON

# Hvis hverken python eller node virkede, exit (ingen ufuldstændig fil)
[ -z "$FORMATTED" ] && exit 0

# 7. Skriv output
mkdir -p "$OUTPUT_DIR"
NOW=$(date '+%Y-%m-%d %H:%M')

cat > "$OUTPUT_FILE" <<EOF
# Session context — auto-genereret $NOW

> Genereret af \`scripts/session-prefetch-issue.sh\` (SessionStart hook).
> Issue # udtrukket fra første \`#N\` i \`docs/NOW.md\`.

$FORMATTED
EOF

exit 0

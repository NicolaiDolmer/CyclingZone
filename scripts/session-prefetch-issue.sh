#!/bin/bash
# session-prefetch-issue.sh
# SessionStart hook: pre-fetch active GitHub issue context based on NOW.md
#
# Hvad: Læser docs/NOW.md, finder første #N reference, henter issue + seneste
# comment via gh, og skriver et bounded struktureret resumé til
# .codex.local/SESSION_CONTEXT.md.
#
# Hvorfor: Sparer tokens ved at undgå manuel `gh issue view` round-trip i
# samtalen, men output skal være bounded fordi filen auto-loades ved start.
#
# Source of truth: Dette er kun en regenererbar cache af GitHub-data.
# Varigt handoff skal ligge i GitHub/OneDrive, ikke her.
#
# Fail-safe: Exit altid 0. Skriver ikke til SESSION_CONTEXT.md hvis
# noget fejler.
#
# Brug: konfigureret som SessionStart hook i .claude/settings.json.

set +e  # Tolerant mod alle fejl — exit 0 til sidst uanset hvad.

REPO="NicolaiDolmer/CyclingZone"
NOW_MD="docs/NOW.md"
OUTPUT_DIR=".codex.local"
OUTPUT_FILE="$OUTPUT_DIR/SESSION_CONTEXT.md"
BODY_LIMIT="${SESSION_CONTEXT_BODY_LIMIT:-900}"
COMMENT_LIMIT="${SESSION_CONTEXT_COMMENT_LIMIT:-450}"
MAX_COMMENTS="${SESSION_CONTEXT_MAX_COMMENTS:-1}"

# 1. Tidlig exit hvis vi ikke er i repo-roden
[ -f "$NOW_MD" ] || exit 0

# 2. Tjek gh er installeret + auth
command -v gh >/dev/null 2>&1 || exit 0
gh auth status >/dev/null 2>&1 || exit 0

# 3. Find aktivt GitHub-issue # i NOW.md.
# Regex-noter:
#   - `(^|[^a-zA-Z0-9])` undgår Discord-tags som "Zone#8784" (# preceded by alnum)
#   - Strategi (#1097-fix): "🎯 Next action"-linjen i "## Aktiv styring" er det
#     kanoniske pointer til aktivt arbejde (CLAUDE.md Start trin 1). Den gamle
#     første-#N-i-filen-heuristik blev brudt af permanente top-referencer
#     (Produktkompas-linjen → prefetchede konsekvent #1145 i stedet for aktivt
#     issue). Fallback-kæden bevarer gammel adfærd hvis Next action mangler.
extract_issue() {
  local input="$1"
  echo "$input" | grep -oE '(^|[^a-zA-Z0-9])#[0-9]+' | head -1 | tr -dc '0-9'
}
ISSUE=$(extract_issue "$(grep -m1 -i 'Next action' "$NOW_MD")")
[ -z "$ISSUE" ] && ISSUE=$(extract_issue "$(head -25 "$NOW_MD")")
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

def limit_text(text, limit):
    text = (text or '').strip()
    if not text:
        return '_(ingen)_'
    try:
        limit = int(limit)
    except Exception:
        limit = 900
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit('\n', 1)[0].strip()
    if len(cut) < limit * 0.6:
        cut = text[:limit].rsplit(' ', 1)[0].strip()
    return cut + f"\n\n_[truncated: {len(text) - len(cut)} tegn udeladt]_"

title = d.get('title', '(intet title)')
state = d.get('state', '?')
labels = ', '.join(l.get('name', '') for l in d.get('labels', []))
url = d.get('url', '')
body = limit_text(d.get('body') or '', os.environ.get('BODY_LIMIT', '900'))

print(f"## Aktivt issue: #{d.get('number', '?')} — {title}")
print()
print(f"**State:** {state}")
print(f"**Labels:** {labels}")
print(f"**URL:** {url}")
print()
print("### Body (bounded)")
print()
print(body)
print()
print(f"### Seneste {os.environ.get('MAX_COMMENTS', '1')} comment(s) (bounded)")
print()

cs = d.get('comments') or []
cs.sort(key=lambda c: c.get('createdAt', ''))
try:
    max_comments = int(os.environ.get('MAX_COMMENTS', '1'))
except Exception:
    max_comments = 1
recent = cs[-max(0, max_comments):] if max_comments else []

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
        body_c = limit_text(c.get('body') or '', os.environ.get('COMMENT_LIMIT', '450'))
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
  const limitText = (value, rawLimit) => {
    const text = String(value || '').trim();
    if (!text) return '_(ingen)_';
    const limit = Number.parseInt(rawLimit || '900', 10) || 900;
    if (text.length <= limit) return text;
    let cut = text.slice(0, limit);
    const nl = cut.lastIndexOf('\n');
    const sp = cut.lastIndexOf(' ');
    if (nl > limit * 0.6) cut = cut.slice(0, nl);
    else if (sp > limit * 0.6) cut = cut.slice(0, sp);
    cut = cut.trim();
    return `${cut}\n\n_[truncated: ${text.length - cut.length} tegn udeladt]_`;
  };

  const title = d.title || '(intet title)';
  const state = d.state || '?';
  const labels = (d.labels || []).map(l => l.name || '').join(', ');
  const url = d.url || '';
  const body = limitText(d.body, process.env.BODY_LIMIT);

  console.log(`## Aktivt issue: #${d.number || '?'} — ${title}`);
  console.log();
  console.log(`**State:** ${state}`);
  console.log(`**Labels:** ${labels}`);
  console.log(`**URL:** ${url}`);
  console.log();
  console.log('### Body (bounded)');
  console.log();
  console.log(body);
  console.log();
  console.log(`### Seneste ${process.env.MAX_COMMENTS || '1'} comment(s) (bounded)`);
  console.log();

  let cs = (d.comments || []).slice();
  cs.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const maxComments = Number.parseInt(process.env.MAX_COMMENTS || '1', 10) || 0;
  const recent = maxComments > 0 ? cs.slice(-maxComments) : [];

  if (!recent.length) {
    console.log('_(ingen comments)_');
  } else {
    recent.forEach(c => {
      const author = (c.author && c.author.login) || 'unknown';
      let created = (c.createdAt || '').replace('T', ' ');
      if (created.includes('Z')) created = created.split('Z')[0];
      if (created.includes('.')) created = created.split('.')[0];
      if (created.length >= 16) created = created.substring(0, 16);
      const bodyC = limitText(c.body, process.env.COMMENT_LIMIT || '450');
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
export BODY_LIMIT COMMENT_LIMIT MAX_COMMENTS
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
> Issue # udtrukket fra "🎯 Next action"-linjen i \`docs/NOW.md\` (fallback: første \`#N\`).
> Lokal cache only: varig context skal ligge i GitHub/OneDrive.

$FORMATTED
EOF

exit 0

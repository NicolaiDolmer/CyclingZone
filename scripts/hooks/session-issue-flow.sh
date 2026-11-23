#!/bin/bash
# session-issue-flow.sh (#7827)
# SessionStart hook: en linje med issue-flowet, saa det er synligt, om tingene
# foelges til doers. Stdout fra en SessionStart-hook lander hos Claude.
# Fail-safe: exit altid 0, og uden gh eller netvaerk skrives intet.

set +e

REPO="NicolaiDolmer/CyclingZone"
command -v gh >/dev/null 2>&1 || exit 0

count() {
  timeout 4 gh api -X GET search/issues -f "q=repo:$REPO is:issue $1" -f per_page=1 --jq .total_count 2>/dev/null
}

SINCE=$(date -u -d '7 days ago' +%F 2>/dev/null)
[ -n "$SINCE" ] || exit 0

OPEN=$(count "is:open")
DONE=$(count "is:open label:claude:done")
CREATED=$(count "created:>=$SINCE")
CLOSED=$(count "closed:>=$SINCE")
[ -n "$OPEN" ] && [ -n "$DONE" ] && [ -n "$CREATED" ] && [ -n "$CLOSED" ] || exit 0

echo "ISSUE-FLOW (#7827): $OPEN åbne, $CREATED oprettet og $CLOSED lukket på 7 dage, $DONE færdige men åbne. Vis ejeren tallene ved sessionsstart, og tag de færdige men åbne til dørs."

# Opfoelgningslisten: lukkede opgaver, hvor beviset venter paa en haendelse i prod.
WAITING=$(timeout 4 gh issue view 7829 --repo "$REPO" --json body --jq '.body' 2>/dev/null | grep -c '^- \[ \]')
[ "${WAITING:-0}" -gt 0 ] && echo "OPFØLGNING (#7829): $WAITING bevis venter på en hændelse i prod. Tjek listen, og sæt kryds ved det, der er set."

# Aabne CodeQL-fund paa main (ejer 23/11: foelges automatisk til doers samme dag).
CODEQL=$(timeout 4 gh api "repos/$REPO/code-scanning/alerts?state=open&ref=refs/heads/main&per_page=20" \
  --jq '.[] | "#\(.number) \(.rule.security_severity_level // .rule.severity) \(.rule.id) \(.most_recent_instance.location.path):\(.most_recent_instance.location.start_line)"' 2>/dev/null)
if [ -n "$CODEQL" ]; then
  echo "CODEQL (ejer 23/11): $(printf '%s\n' "$CODEQL" | wc -l | tr -d ' ') åbne fund på main. Ret dem i denne session (worktree + PR, se PR #8603 som mønster), med mindre en åben PR allerede retter dem:"
  printf '%s\n' "$CODEQL" | sed 's/^/  /'
fi
exit 0

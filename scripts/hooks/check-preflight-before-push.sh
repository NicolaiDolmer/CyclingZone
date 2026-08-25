#!/bin/bash
# PreToolUse hook (matcher: Bash). Naar der forsoeges `git push` paa en
# feature-branch, og scripts/preflight-pr.ps1 ikke er koert groent siden de
# aendrede filer sidst blev roert, emittes en warning.
#
# Bidt 2026-08-25 (PR #4237): CLAUDE.md kraever preflight FOER push paa alle
# PR'er. Sessionen pushede uden, koerte den bagefter (groen), men raekkefoelgen
# var forkert. Reglen var ren honor-system: intet fangede springet. Sibling-
# hooken check-ci-before-push.sh daekker roed CI, ikke oversprunget preflight.
#
# Warning-mode only: exit altid 0. Fail-safe: alt uventet giver silent skip.
# Stamp'en skrives af preflight-pr.ps1 og ligger i .git/preflight-ok
# (worktree-specifik via `git rev-parse --git-path`).

set -u

INPUT=$(cat 2>/dev/null || true)

# Bail-out: kun Bash tool-calls
case "$INPUT" in
  *'"tool_name":"Bash"'*|*'"tool_name": "Bash"'*) ;;
  *) exit 0 ;;
esac

CMD=$(printf '%s' "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -c 4000)
[ -z "$CMD" ] && exit 0

case "$CMD" in
  *'git push'*) ;;
  *) exit 0 ;;
esac

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
[ -z "$CURRENT_BRANCH" ] && exit 0

# main/master: chore/docs-pushes gaar direkte og skal ikke stoppes af en
# PR-preflight-regel. Samme undtagelse som check-ci-before-push.sh.
case "$CURRENT_BRANCH" in
  main|master) exit 0 ;;
esac

# Hvilke filer udgoer DETTE arbejde? Tre kilder, deduplikeret:
#   1. commits paa branchen siden merge-base (tre-punkts, IKKE to-punkts:
#      `git diff origin/main` ville ogsaa liste filer som *main* har aendret
#      mens branchen laa stille, og et `git pull` giver dem friske mtimes
#      -> falske advarsler om filer man aldrig har roert).
#   2. ucommittede aendringer i arbejdstraeet.
#   3. nye untrackede filer (ellers taeller en helt ny kildefil ikke med).
# Ingen aendringer = intet at preflighte.
git rev-parse --verify origin/main >/dev/null 2>&1 || exit 0
CHANGED=$(
  {
    git diff --name-only origin/main...HEAD 2>/dev/null
    git diff --name-only HEAD 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
  } | sort -u
)
[ -z "$CHANGED" ] && exit 0

# Preflight daekker frontend-lint, i18n/tone, og en raekke lint-guards. Rene
# docs-/learnings-diffs har intet at hente der, saa de skal ikke give stoej.
RELEVANT=$(printf '%s\n' "$CHANGED" | grep -vE '^(docs/|\.claude/learnings/|.*\.md$)' || true)
[ -z "$RELEVANT" ] && exit 0

STAMP=$(git rev-parse --git-path preflight-ok 2>/dev/null)
[ -z "$STAMP" ] && exit 0

emit() {
  printf '{"systemMessage": "%s"}\n' "$1"
  exit 0
}

if [ ! -f "$STAMP" ]; then
  emit "PREFLIGHT-GUARD: scripts/preflight-pr.ps1 ser ikke ud til at vaere koert i dette worktree.\\nCLAUDE.md kraever den FOER push paa alle PR-er (spejler CI-vagterne lokalt, tager under et minut):\\n  pwsh -File scripts/preflight-pr.ps1\\nKoer den, eller sig eksplicit hvorfor den springes over."
fi

# Er stamp'en aeldre end nogen af de relevante aendrede filer? Saa er den
# forældet: der er redigeret efter sidste groenne preflight.
NEWER=$(printf '%s\n' "$RELEVANT" | while IFS= read -r f; do
  [ -f "$f" ] || continue
  if [ "$f" -nt "$STAMP" ]; then printf '%s\n' "$f"; fi
done)

if [ -n "$NEWER" ]; then
  COUNT=$(printf '%s\n' "$NEWER" | grep -c .)
  FIRST=$(printf '%s\n' "$NEWER" | head -3 | tr '\n' ' ')
  emit "PREFLIGHT-GUARD: $COUNT fil(er) er aendret siden sidste groenne preflight (fx $FIRST).\\nCLAUDE.md kraever scripts/preflight-pr.ps1 FOER push:\\n  pwsh -File scripts/preflight-pr.ps1\\nKoer den igen, eller sig eksplicit hvorfor den springes over."
fi

exit 0

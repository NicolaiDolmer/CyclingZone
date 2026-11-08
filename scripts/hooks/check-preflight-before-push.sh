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
  # Review #7907: alle globale flag (git --no-pager push, git -c x=y push), ikke kun -C.
  *'git push'*|*'git -'*' push'*) ;;
  *) exit 0 ;;
esac

# Ejer 4/11: `cd <dir> && git push` eller `git -C <dir> push` pusher fra et andet
# worktree end sessionens cwd; tjek det worktree (ellers maaltes det forkerte trae).
# Codex P2 (#7660): kommandoen afkodes som JSON, og shell-quoting fjernes (lib/push-target-dir.mjs).
# Ejer 8/11: destinations-branchen i en eksplicit refspec (`HEAD:wip/x`) er maalet, ikke den lokale branch.
# Et maal pr. linje, efterfulgt af tab + mappe naar netop det push koerer et andet sted (review #7907).
DEST=$(printf '%s' "$INPUT" | node "$(dirname "$0")/lib/push-target-dir.mjs" --dest 2>/dev/null)
# Ejer 8/11: kun undtaget naar HVERT maal er en backup-branch (wip/*, backup/*) eller en sletning:
# ingen PR at beskytte, intet nyt kode sendes.
[ "$DEST" = "__ALL_EXEMPT__" ] && exit 0
# Intet maal fundet (usaedvanlig kommandoform, node fejlede): tjek den lokale branch som foer.
[ -z "$DEST" ] && DEST="__LOCAL__"

# Eksplicit, begrundet undtagelse: PREFLIGHT_SKIP="<hvorfor>" i kommandoen.
case "$CMD" in *PREFLIGHT_SKIP=*) exit 0 ;; esac

# Ejer 4/11: en advarsel i systemMessage ses kun af ejeren, saa pushet gik igennem
# uden preflight. Nu afvises pushet med en begrundelse, Claude ser og handler paa.
emit() {
  # Ejer 8/11: ingen systemMessage; den viste hele teksten i ejerens vindue. Afvisningen naar Claude via begrundelsen.
  printf '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "%s\\nUndtagelse: saet PREFLIGHT_SKIP=\\"<hvorfor>\\" foran git push."}}\n' "$1"
  exit 0
}

# Koeres i en subshell pr. maal, saa cd og emit ikke rammer de naeste maal.
check_push() {
TARGET="$1"
PUSH_DIR="$2"
if [ -n "$PUSH_DIR" ]; then cd "$PUSH_DIR" 2>/dev/null || return 0; fi

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0

# Review #7907: samme vurdering som CI-vagten. Koden paa vej til main/master kommer
# fra den lokale branch, og et eksplicit feature-maal er et PR-push, ogsaa fra main.
case "$TARGET" in
  __LOCAL__|main|master) TARGET=$(git branch --show-current 2>/dev/null) ;;
esac
[ -z "$TARGET" ] && return 0

# main/master: chore/docs-pushes gaar direkte og skal ikke stoppes af en
# PR-preflight-regel. Samme undtagelse som check-ci-before-push.sh.
case "$TARGET" in
  main|master) return 0 ;;
esac

# Hvilke filer udgoer DETTE arbejde? Tre kilder, deduplikeret:
#   1. commits paa branchen siden merge-base (tre-punkts, IKKE to-punkts:
#      `git diff origin/main` ville ogsaa liste filer som *main* har aendret
#      mens branchen laa stille, og et `git pull` giver dem friske mtimes
#      -> falske advarsler om filer man aldrig har roert).
#   2. ucommittede aendringer i arbejdstraeet.
#   3. nye untrackede filer (ellers taeller en helt ny kildefil ikke med).
# Ingen aendringer = intet at preflighte.
git rev-parse --verify origin/main >/dev/null 2>&1 || return 0
CHANGED=$(
  {
    git diff --name-only origin/main...HEAD 2>/dev/null
    git diff --name-only HEAD 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
  } | sort -u
)
[ -z "$CHANGED" ] && return 0

# Preflight daekker frontend-lint, i18n/tone, og en raekke lint-guards. Rene
# docs-/learnings-diffs har intet at hente der, saa de skal ikke give stoej.
RELEVANT=$(printf '%s\n' "$CHANGED" | grep -vE '^(docs/|\.claude/learnings/|.*\.md$)' || true)
[ -z "$RELEVANT" ] && return 0

STAMP=$(git rev-parse --git-path preflight-ok 2>/dev/null)
[ -z "$STAMP" ] && return 0

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
}

TAB=$(printf '\t')
while IFS="$TAB" read -r TARGET PUSH_DIR; do
  DENIAL=$(check_push "$TARGET" "$PUSH_DIR" </dev/null)
  if [ -n "$DENIAL" ]; then
    printf '%s\n' "$DENIAL"
    exit 0
  fi
done <<EOT
$DEST
EOT

exit 0

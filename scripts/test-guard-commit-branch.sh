#!/usr/bin/env bash
# Test suite for scripts/guard-commit-branch.sh (#4658).
#
# Run from repo root: bash scripts/test-guard-commit-branch.sh
#
# Bygger et throwaway-repo + et linked worktree under mktemp og koerer guarden
# mod dem i alle tilstande. Roerer ALDRIG det rigtige repo. Foelger run()-
# moenstret fra scripts/test-block-dangerous-secret-commands.sh.
#
# De to scenarier fra #4658:
#   A) delt checkout paa forkert branch                      -> stadig BLOKERET (exit 1)
#   B) worktree paa korrekt branch, guarden kaldt fra en ANDEN cwd
#      med <dir> som 2. argument                              -> IKKE falsk-blokeret (exit 0)
#
# Plus den praecise 2/9-fejl: worktree-kopien af scriptet kaldt UDEN <dir> fra
# hoved-checkoutets cwd. Guarden maa ikke svare "BLOKERET: main" (falsk); den skal
# sige at to traeer er i spil og bede om <dir>.
#
# Refs: #4658, #4016.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD="$REPO_ROOT/scripts/guard-commit-branch.sh"

if [ ! -f "$GUARD" ]; then
  echo "FAIL: guard ikke fundet: $GUARD"
  exit 1
fi

PASS=0
FAIL=0
WORK="$(mktemp -d)"
STDOUT_TMP="$WORK/stdout"
STDERR_TMP="$WORK/stderr"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# Throwaway-repo med guarden committet under scripts/, saa det linkede worktree
# ogsaa faar sin egen kopi af scriptet (praecis som CyclingZone-worktrees har).
MAIN="$WORK/main"
WT="$WORK/wt"
OUTSIDE="$WORK/outside"   # cwd der IKKE er et git-repo
NOHOOKS="$WORK/nohooks"   # tom hooksPath, saa brugerens globale hooks ikke blander sig
mkdir -p "$MAIN/scripts" "$OUTSIDE" "$NOHOOKS"
cp "$GUARD" "$MAIN/scripts/guard-commit-branch.sh"

g() {
  git -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c core.hooksPath="$NOHOOKS" \
      -c core.autocrlf=false -c core.safecrlf=false "$@"
}

g -C "$MAIN" init -q -b main
g -C "$MAIN" add -A
g -C "$MAIN" commit -q -m init
g -C "$MAIN" worktree add -q -b feat/x "$WT" main

MAIN_GUARD="$MAIN/scripts/guard-commit-branch.sh"
WT_GUARD="$WT/scripts/guard-commit-branch.sh"

# run NAME WANT_EXIT WANT_STDERR_SUBSTR CWD SCRIPT [ARGS...]
#   WANT_STDERR_SUBSTR="" springer substring-tjekket over.
#   Ved WANT_EXIT=0 kraeves desuden TAVSHED (tom stdout+stderr): en guard der
#   passerer skal ikke stoeje i en &&-kaede.
run() {
  local name="$1" want_exit="$2" want_err="$3" cwd="$4"
  shift 4
  (cd "$cwd" && bash "$@") >"$STDOUT_TMP" 2>"$STDERR_TMP"
  LAST_CODE=$?
  LAST_ERR="$(cat "$STDERR_TMP" 2>/dev/null || echo "")"
  LAST_OUT="$(cat "$STDOUT_TMP" 2>/dev/null || echo "")"

  local ok=1
  [ "$LAST_CODE" = "$want_exit" ] || ok=0
  if [ -n "$want_err" ] && ! printf '%s' "$LAST_ERR" | grep -qF -- "$want_err"; then ok=0; fi
  if [ "$want_exit" = "0" ] && [ -n "$LAST_ERR$LAST_OUT" ]; then ok=0; fi

  if [ "$ok" = "1" ]; then
    PASS=$((PASS+1))
    echo "PASS  $name"
  else
    FAIL=$((FAIL+1))
    echo "FAIL  $name (exit=$LAST_CODE want=$want_exit, want stderr~\"$want_err\")"
    [ -n "$LAST_ERR" ] && echo "  stderr head: $(printf '%s' "$LAST_ERR" | head -c 300)"
    [ -n "$LAST_OUT" ] && echo "  stdout head: $(printf '%s' "$LAST_OUT" | head -c 300)"
  fi
}

# last_err_has NAME SUBSTR -- den seneste koersels stderr SKAL indeholde SUBSTR.
last_err_has() {
  local name="$1" wanted="$2"
  if printf '%s' "$LAST_ERR" | grep -qF -- "$wanted"; then
    PASS=$((PASS+1))
    echo "PASS  $name"
  else
    FAIL=$((FAIL+1))
    echo "FAIL  $name (stderr mangler \"$wanted\")"
    echo "  stderr head: $(printf '%s' "$LAST_ERR" | head -c 300)"
  fi
}

# last_err_lacks NAME SUBSTR -- den seneste koersels stderr maa IKKE indeholde SUBSTR.
last_err_lacks() {
  local name="$1" forbidden="$2"
  if printf '%s' "$LAST_ERR" | grep -qF -- "$forbidden"; then
    FAIL=$((FAIL+1))
    echo "FAIL  $name (stderr indeholder \"$forbidden\")"
    echo "  stderr head: $(printf '%s' "$LAST_ERR" | head -c 300)"
  else
    PASS=$((PASS+1))
    echo "PASS  $name"
  fi
}

# ===== Eksisterende adfaerd (regression, fix 18/8) =====

run "mangler argument -> exit 2" \
  2 "mangler forventet branch" "$MAIN" scripts/guard-commit-branch.sh

run "delt checkout paa korrekt branch -> exit 0, tavs" \
  0 "" "$MAIN" scripts/guard-commit-branch.sh main

# Scenario A: hoved-checkoutet er skiftet til en fremmed branch (klassikeren, 5 bid).
g -C "$MAIN" checkout -q -b other
run "A: delt checkout paa forkert branch -> BLOKERET exit 1" \
  1 'BLOKERET' "$MAIN" scripts/guard-commit-branch.sh main
last_err_has "A: beskeden naevner den faktiske branch \"other\"" '"other"'
g -C "$MAIN" checkout -q main
g -C "$MAIN" branch -q -D other

g -C "$MAIN" checkout -q --detach
run "detached HEAD i delt checkout -> BLOKERET exit 1" \
  1 "detached HEAD" "$MAIN" scripts/guard-commit-branch.sh main
g -C "$MAIN" checkout -q main

# ===== #4658: eksplicit <dir> som 2. argument =====

# Scenario B: worktree paa korrekt branch, guard kaldt fra hoved-checkoutets cwd
# (der staar paa main) med worktree-stien som <dir>. Agent-shells nulstiller cwd
# mellem kald, saa dette ER den normale form for en git -C-baseret worker.
run "B: worktree korrekt branch + <dir>, cwd=hoved-checkout -> exit 0, tavs" \
  0 "" "$MAIN" "$WT_GUARD" feat/x "$WT"

run "B2: worktree korrekt branch + <dir>, cwd er slet ikke et repo -> exit 0, tavs" \
  0 "" "$OUTSIDE" "$MAIN_GUARD" feat/x "$WT"

run "B3: <dir> som relativ sti -> exit 0, tavs" \
  0 "" "$WORK" "$MAIN_GUARD" feat/x wt

run "B4: <dir>=. fra worktree-cwd med hoved-checkoutets script-kopi -> exit 0, tavs" \
  0 "" "$WT" "$MAIN_GUARD" feat/x .

run "worktree paa forkert branch + <dir> -> BLOKERET exit 1" \
  1 'BLOKERET' "$MAIN" "$MAIN_GUARD" main "$WT"
last_err_has "...beskeden naevner den faktiske branch \"feat/x\"" '"feat/x"'

g -C "$WT" checkout -q --detach
run "detached HEAD i worktree + <dir> -> BLOKERET exit 1" \
  1 "detached HEAD" "$MAIN" "$MAIN_GUARD" feat/x "$WT"
g -C "$WT" checkout -q feat/x

run "<dir> findes ikke -> exit 2 (aldrig stille pass)" \
  2 "ikke et git-arbejdstrae" "$MAIN" "$MAIN_GUARD" feat/x "$WORK/findes-ikke"

run "<dir> er ikke et repo -> exit 2" \
  2 "ikke et git-arbejdstrae" "$MAIN" "$MAIN_GUARD" feat/x "$OUTSIDE"

# ===== Den praecise 2/9-fejl: to traeer i spil, intet <dir> =====

# Worktree-kopien af scriptet kaldt UDEN <dir> fra hoved-checkoutets cwd. Foer fixet
# svarede guarden "BLOKERET: main" (falsk: worktree'et stod korrekt). Nu skal den
# sige at to traeer er i spil og pege paa <dir>-argumentet.
run "2/9-fejl: worktree-script uden <dir> fra hoved-cwd -> exit 2 med <dir>-hint" \
  2 "<dir>" "$MAIN" "$WT_GUARD" feat/x
last_err_lacks "2/9-fejl: ingen falsk BLOKERET-dom" "BLOKERET"

run "omvendt: hoved-checkoutets script uden <dir> fra worktree-cwd -> exit 2 med <dir>-hint" \
  2 "<dir>" "$WT" "$MAIN_GUARD" feat/x

run "cwd er ikke et repo og intet <dir> -> exit 2, ikke 'detached HEAD'" \
  2 "<dir>" "$OUTSIDE" "$MAIN_GUARD" main
last_err_lacks "...ingen misvisende detached-HEAD-besked" "detached HEAD"

# ===== Summary =====
echo ""
echo "================================"
echo "Result: $PASS pass, $FAIL fail"
echo "================================"

[ "$FAIL" -gt 0 ] && exit 1 || exit 0

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

# ===== #5094: markoer + pre-commit-kontrol + PowerShell-wrapper =====
#
# Fejlklassen: kaeden `bash guard && git commit` kan fortsaette forbi guarden
# naar `bash` ikke resolves i den kaldende proces. Guarden kan ikke sige fra naar
# den aldrig blev startet, saa Git skal. Guarden skriver en engangs-markoer;
# .githooks/check-commit-guard-marker.sh kraever den.
#
# Bemaerk mappingen: "bash mangler" og "guarden koerte ikke" er SAMME tilstand
# set fra commit'ets side - ingen markoer. Testene nedenfor daekker den tilstand.

CHECK="$REPO_ROOT/.githooks/check-commit-guard-marker.sh"

ok() { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && echo "  $2"; }

marker_path() { git -C "$1" rev-parse --absolute-git-dir 2>/dev/null; }

# Fixture-repoerne faar en origin der ligner CyclingZone: markoer-kontrollen
# springer bevidst repoer UDEN den over (temp-/fixture-repoer).
g -C "$MAIN" remote add origin https://github.com/NicolaiDolmer/CyclingZone.git

# --- markoer skrives af en BESTAAET guard, i det rigtige trae ---
rm -f "$(marker_path "$MAIN")/cz-commit-guard-ok" "$(marker_path "$WT")/cz-commit-guard-ok" 2>/dev/null || true
run "markoer: bestaaet guard er stadig tavs" 0 "" "$MAIN" scripts/guard-commit-branch.sh main
if [ -f "$(marker_path "$MAIN")/cz-commit-guard-ok" ]; then
  ok "markoer: bestaaet guard skriver markoer i traeets egen git-dir"
else
  bad "markoer: bestaaet guard skriver markoer i traeets egen git-dir" "ingen fil i $(marker_path "$MAIN")"
fi

# --- markoeren er per-worktree: guard paa WT maa ikke laegge en markoer i MAIN ---
rm -f "$(marker_path "$MAIN")/cz-commit-guard-ok" "$(marker_path "$WT")/cz-commit-guard-ok" 2>/dev/null || true
run "markoer: guard mod worktree er tavs" 0 "" "$MAIN" "$MAIN_GUARD" feat/x "$WT"
if [ -f "$(marker_path "$WT")/cz-commit-guard-ok" ] && [ ! -f "$(marker_path "$MAIN")/cz-commit-guard-ok" ]; then
  ok "markoer: worktree-guard skriver KUN i worktreets egen git-dir"
else
  bad "markoer: worktree-guard skriver KUN i worktreets egen git-dir"
fi

# --- BLOKERET guard efterlader ingen markoer ---
rm -f "$(marker_path "$WT")/cz-commit-guard-ok" 2>/dev/null || true
run "markoer: blokeret guard -> exit 1" 1 "BLOKERET" "$MAIN" "$MAIN_GUARD" main "$WT"
if [ ! -f "$(marker_path "$WT")/cz-commit-guard-ok" ]; then
  ok "markoer: en BLOKERET guard efterlader ingen markoer"
else
  bad "markoer: en BLOKERET guard efterlader ingen markoer"
fi

# --- pre-commit-kontrollen ---
check_in() { (cd "$1" && bash "$CHECK") >"$STDOUT_TMP" 2>"$STDERR_TMP"; }

rm -f "$(marker_path "$MAIN")/cz-commit-guard-ok" 2>/dev/null || true
if check_in "$MAIN"; then
  bad "pre-commit: uden markoer skal commit blokeres" "exit 0"
else
  if grep -qF "blev ikke koert" "$STDERR_TMP"; then
    ok "pre-commit: guarden ikke koert (= bash manglede) -> BLOKERET med aarsag"
  else
    bad "pre-commit: guarden ikke koert -> BLOKERET med aarsag" "$(head -c 200 "$STDERR_TMP")"
  fi
fi

bash "$MAIN_GUARD" main "$MAIN"
if check_in "$MAIN"; then
  ok "pre-commit: guard koert -> commit slipper igennem"
else
  bad "pre-commit: guard koert -> commit slipper igennem" "$(head -c 200 "$STDERR_TMP")"
fi

# ... og markoeren er brugt op: anden commit i traek kraever en ny guard-koersel.
if check_in "$MAIN"; then
  bad "pre-commit: markoeren er engangsbrug" "samme markoer daekkede to commits"
else
  ok "pre-commit: markoeren er engangsbrug (anden commit blokeres)"
fi

# DEFER: pre-commit forbruger foerst markoeren naar HELE hooken er bestaaet.
# Blokerer gitleaks/lint-staged bagefter, skal naeste forsoeg kunne bruge samme
# godkendelse - ellers faar man "guarden blev ikke koert" om en guard der KOERTE.
bash "$MAIN_GUARD" main "$MAIN"
if (cd "$MAIN" && CZ_GUARD_DEFER_MARKER=1 bash "$CHECK") >"$STDOUT_TMP" 2>"$STDERR_TMP"; then
  if [ -f "$(marker_path "$MAIN")/cz-commit-guard-ok" ]; then
    ok "pre-commit: DEFER beholder markoeren, saa et senere trins fejl ikke kraever ny guard"
  else
    bad "pre-commit: DEFER beholder markoeren" "markoeren blev slettet alligevel"
  fi
else
  bad "pre-commit: DEFER beholder markoeren" "$(head -c 200 "$STDERR_TMP")"
fi
rm -f "$(marker_path "$MAIN")/cz-commit-guard-ok" 2>/dev/null || true

# --- markoer fra en anden branch daekker ikke ---
bash "$MAIN_GUARD" main "$MAIN"
g -C "$MAIN" checkout -q -b other
if check_in "$MAIN"; then
  bad "pre-commit: markoer fra anden branch afvises" "exit 0"
else
  grep -qF 'gjaldt branch' "$STDERR_TMP" \
    && ok "pre-commit: markoer fra anden branch afvises" \
    || bad "pre-commit: markoer fra anden branch afvises" "$(head -c 200 "$STDERR_TMP")"
fi
g -C "$MAIN" checkout -q main
g -C "$MAIN" branch -q -D other

# --- markoer fra et ANDET trae daekker ikke ---
# Branchen SKAL matche, ellers stopper branch-tjekket markoeren foer trae-tjekket
# naas, og testen ville bevise noget andet end den paastaar.
printf 'v1\nbranch=main\nepoch=%s\ntree=%s\npid=1\n' \
  "$(date +%s)" "$(git -C "$WT" rev-parse --show-toplevel)" \
  > "$(marker_path "$MAIN")/cz-commit-guard-ok"
if check_in "$MAIN"; then
  bad "pre-commit: markoer med fremmed trae-sti afvises" "exit 0"
else
  grep -qF 'andet arbejdstrae' "$STDERR_TMP" \
    && ok "pre-commit: markoer med fremmed trae-sti afvises" \
    || bad "pre-commit: markoer med fremmed trae-sti afvises" "$(head -c 200 "$STDERR_TMP")"
fi

# --- for gammel markoer daekker ikke ---
bash "$MAIN_GUARD" main "$MAIN"
MK="$(marker_path "$MAIN")/cz-commit-guard-ok"
printf 'v1\nbranch=main\nepoch=%s\ntree=%s\npid=1\n' \
  "$(( $(date +%s) - 4000 ))" "$(git -C "$MAIN" rev-parse --show-toplevel)" > "$MK"
if check_in "$MAIN"; then
  bad "pre-commit: for gammel markoer afvises" "exit 0"
else
  grep -qF 'graense 300s' "$STDERR_TMP" \
    && ok "pre-commit: for gammel markoer afvises" \
    || bad "pre-commit: for gammel markoer afvises" "$(head -c 200 "$STDERR_TMP")"
fi

# --- repo uden origin springes bevidst over (fixture-/temp-repoer) ---
g -C "$MAIN" remote remove origin
rm -f "$MK" 2>/dev/null || true
if check_in "$MAIN"; then
  ok "pre-commit: repo uden CyclingZone-origin springes over"
else
  bad "pre-commit: repo uden CyclingZone-origin springes over" "$(head -c 200 "$STDERR_TMP")"
fi
g -C "$MAIN" remote add origin https://github.com/NicolaiDolmer/CyclingZone.git

# --- PowerShell-wrapperen ---
PS_GUARD="$REPO_ROOT/scripts/guard-commit-branch.ps1"
if command -v pwsh >/dev/null 2>&1; then
  ps_run() { pwsh -NoProfile -File "$PS_GUARD" "$@" >"$STDOUT_TMP" 2>"$STDERR_TMP"; }

  rm -f "$MK" 2>/dev/null || true
  if ps_run main "$MAIN"; then
    [ -f "$MK" ] && ok "ps1: korrekt branch -> exit 0 og markoer skrevet" \
                 || bad "ps1: korrekt branch -> exit 0 og markoer skrevet" "ingen markoer"
  else
    bad "ps1: korrekt branch -> exit 0 og markoer skrevet" "$(head -c 200 "$STDERR_TMP")"
  fi

  if ps_run main "$WT"; then
    bad "ps1: forkert branch -> exit 1 (guardens kode gives videre)" "exit 0"
  else
    ok "ps1: forkert branch -> exit 1 (guardens kode gives videre)"
  fi

  # Den praecise #5094-tilstand: bash findes ingen steder. Wrapperen SKAL fejle
  # haardt, saa en `&&`-kaede ikke kan fortsaette til git commit.
  if CZ_GUARD_TEST_NO_BASH=1 ps_run main "$MAIN"; then
    bad "ps1: bash mangler -> kaeden stopper (exit 1)" "exit 0 uden at guarden koerte"
  else
    if grep -qF 'bash kunne ikke findes' "$STDOUT_TMP" "$STDERR_TMP"; then
      ok "ps1: bash mangler -> kaeden stopper (exit 1) med aarsag"
    else
      bad "ps1: bash mangler -> kaeden stopper med aarsag" "$(head -c 200 "$STDOUT_TMP")"
    fi
  fi
else
  echo "SKIP  ps1-tests (pwsh ikke paa PATH)"
fi

# ===== Summary =====
echo ""
echo "================================"
echo "Result: $PASS pass, $FAIL fail"
echo "================================"

[ "$FAIL" -gt 0 ] && exit 1 || exit 0

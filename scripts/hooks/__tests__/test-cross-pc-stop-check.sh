#!/bin/bash
# Test suite for scripts/cross-pc-stop-check.sh (Stop-hook), #3654.
# Run from repo root: bash scripts/hooks/__tests__/test-cross-pc-stop-check.sh
#
# Kontrakt: hooken er TAVS medmindre en anden PC end denne har synket ind i den
# delte OneDrive-context indenfor CROSS_PC_ACTIVE_DAYS. Begge stier testes:
# den slukkede (ingen/gammel anden PC) og den taendte (frisk anden PC).
#
# Alt koerer mod et wegwerf-git-repo + en fake OneDrive-rod i mktemp, saa
# testene hverken laeser eller skriver ejerens rigtige state. HOME peges ogsaa
# ind i temp, saa transcript-syncen (trin 5) ikke finder noget at kopiere.

set -u
FAIL=0
PASS=0

HOOK="$(pwd)/scripts/cross-pc-stop-check.sh"
if [ ! -f "$HOOK" ]; then
  echo "FAIL  kan ikke finde $HOOK, koer fra repo-root"
  exit 1
fi

WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# --- wegwerf-repo med beskidt arbejdstrae (saa der ER noget at advare om) ---
REPO="$WORK/repo"
mkdir -p "$REPO"
(
  cd "$REPO" || exit 1
  git init -q .
  git config user.email test@example.com
  git config user.name Test
  echo baseline > tracked.txt
  git add tracked.txt
  git commit -qm baseline
  echo dirt > untracked.txt          # -> 1 uncommitted aendring
) >/dev/null 2>&1

FAKE_HOME="$WORK/home"
mkdir -p "$FAKE_HOME"

CTX="$WORK/onedrive/CyclingZone-context"
mkdir -p "$CTX"

# Hjaelper: laeg en fil for <pc> med en given alder (i dage) i contexten.
seed_pc() {
  local pc=$1 age_days=$2 dir
  dir="$CTX/claude-transcripts-$pc"
  mkdir -p "$dir"
  echo "session" > "$dir/session.jsonl"
  touch -d "$age_days days ago" "$dir/session.jsonl"
}

# Hjaelper: koer hooken i wegwerf-repoet med fake HOME/OneDrive.
run_hook() {
  (
    cd "$REPO" || exit 1
    env HOME="$FAKE_HOME" \
        USERPROFILE="$FAKE_HOME" \
        OneDrive="$WORK/onedrive" \
        COMPUTERNAME="THISPC" \
        "$@" \
        bash "$HOOK" </dev/null 2>/dev/null
  )
}

assert_silent() {
  local name=$1 out=$2
  if [ -z "$out" ]; then
    PASS=$((PASS + 1)); echo "PASS  $name"
  else
    FAIL=$((FAIL + 1)); echo "FAIL  $name: forventede tavshed, fik: $out"
  fi
}

assert_contains() {
  local name=$1 out=$2 want=$3
  if printf '%s' "$out" | grep -qF "$want"; then
    PASS=$((PASS + 1)); echo "PASS  $name"
  else
    FAIL=$((FAIL + 1)); echo "FAIL  $name: manglede '$want' i: $out"
  fi
}

# ---- SLUKKET STI ----

# 1. Ingen delt context overhovedet -> ingen cross-PC-situation.
OUT=$(
  cd "$REPO" && env HOME="$FAKE_HOME" USERPROFILE="$FAKE_HOME" \
    OneDrive="$WORK/no-such-onedrive" COMPUTERNAME="THISPC" \
    bash "$HOOK" </dev/null 2>/dev/null
)
assert_silent "ingen OneDrive-context -> tavs (beskidt repo til trods)" "$OUT"

# 2. Kun DENNE PC har synket -> stadig ikke en cross-PC-situation.
seed_pc "THISPC" 0
OUT=$(run_hook)
assert_silent "kun egen PC i contexten -> tavs" "$OUT"

# 3. Anden PC findes, men er gammel (49 dage, det maalte EMMAPC-tal fra #3654).
seed_pc "EMMAPC" 49
OUT=$(run_hook)
assert_silent "anden PC sidst set for 49 dage siden -> tavs" "$OUT"

# 4. Anden PC er frisk, men eksplicit slaaet fra.
seed_pc "EMMAPC" 1
OUT=$(run_hook CROSS_PC_STOP_CHECK=off)
assert_silent "CROSS_PC_STOP_CHECK=off -> tavs trods frisk anden PC" "$OUT"

# 5. Frisk anden PC, men vinduet er strammet under dens alder.
seed_pc "EMMAPC" 5
OUT=$(run_hook CROSS_PC_ACTIVE_DAYS=2)
assert_silent "CROSS_PC_ACTIVE_DAYS=2 med 5 dage gammel PC -> tavs" "$OUT"

# ---- TAENDT STI ----

# 6. Anden PC synket i gaar -> advarslen skal fyre og navngive PC'en.
seed_pc "EMMAPC" 1
OUT=$(run_hook)
assert_contains "frisk anden PC -> advarsel fyrer" "$OUT" "ADVARSEL"
assert_contains "advarslen navngiver den aktive PC" "$OUT" "EMMAPC"
assert_contains "advarslen taeller uncommitted" "$OUT" "uncommitted aendring"
assert_contains "advarslen er gyldig JSON-form" "$OUT" '{"systemMessage":'

# 7. always tvinger gammel adfaerd frem uden nogen anden PC.
rm -rf "$CTX/claude-transcripts-EMMAPC"
OUT=$(run_hook CROSS_PC_STOP_CHECK=always)
assert_contains "CROSS_PC_STOP_CHECK=always -> advarsel uden anden PC" "$OUT" "ADVARSEL"

# 8. Taendt gate, men rent arbejdstrae -> intet at advare om.
CLEAN="$WORK/clean-repo"
mkdir -p "$CLEAN"
(
  cd "$CLEAN" || exit 1
  git init -q .
  git config user.email test@example.com
  git config user.name Test
  echo baseline > tracked.txt
  git add tracked.txt
  git commit -qm baseline
) >/dev/null 2>&1
seed_pc "EMMAPC" 1
OUT=$(
  cd "$CLEAN" && env HOME="$FAKE_HOME" USERPROFILE="$FAKE_HOME" \
    OneDrive="$WORK/onedrive" COMPUTERNAME="THISPC" \
    bash "$HOOK" </dev/null 2>/dev/null
)
assert_silent "taendt gate + rent arbejdstrae -> ingen advarsel" "$OUT"

# 9. Exit-koden er altid 0 (Stop-hook maa aldrig blokere).
(
  cd "$REPO" && env HOME="$FAKE_HOME" USERPROFILE="$FAKE_HOME" \
    OneDrive="$WORK/onedrive" COMPUTERNAME="THISPC" \
    bash "$HOOK" </dev/null >/dev/null 2>&1
)
if [ $? -eq 0 ]; then
  PASS=$((PASS + 1)); echo "PASS  hooken exit'er 0 paa den taendte sti"
else
  FAIL=$((FAIL + 1)); echo "FAIL  hooken exit'ede != 0 (Stop-hook skal vaere non-blocking)"
fi

echo ""
echo "Results: $PASS pass, $FAIL fail"
[ "$FAIL" = "0" ] && exit 0 || exit 1

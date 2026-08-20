#!/bin/bash
# Tests for scripts/hooks/lib/active_sessions_engine.py + the two thin
# bash wrappers (set-active-sessions.sh / clear-active-sessions.sh).
#
# Never touches the real ~/.claude/sessions/*.json registry or the real
# docs/NOW.md -- builds a throwaway fake HOME + fake NOW.md per test.
#
# Refs: #3712.

set -u
FAIL=0
PASS=0

REPO_ROOT="$(git rev-parse --show-toplevel)"
ENGINE="$REPO_ROOT/scripts/hooks/lib/active_sessions_engine.py"
PY="$(command -v python3 || command -v python)"

WORK=$(mktemp -d)
FAKE_HOME="$WORK/home"
mkdir -p "$FAKE_HOME/.claude/sessions"
NOW_MD="$WORK/NOW.md"

cleanup() {
  # Kill the long-lived pwsh probe explicitly -- without this it lingers
  # for its full 60s. That is not just wasted time: if this script's own
  # stdout/stderr is a pipe (`| tail`, `| grep`, or a `$(...)` capture
  # around the whole script -- exactly how a preflight/CI step or a
  # human re-running this file would invoke it), a background child that
  # inherits the pipe's write end keeps it open until IT exits too, so
  # the pipe reader blocks for the remaining ~60s even though every test
  # already finished. Confirmed empirically while fixing #3712: piping
  # this script through `tail` reproduced a ~60s hang.
  #
  # Bash-level `kill "$ALIVE_BPID"` alone is NOT enough here -- confirmed
  # empirically it leaves the real pwsh.exe process (and its inherited
  # pipe handle) running; MSYS's signal emulation over a real Win32 child
  # does not reliably terminate it. `taskkill /F /PID` against the actual
  # WINPID (already resolved into $ALIVE_PID below) does terminate it and
  # immediately unblocks a downstream pipe reader. `MSYS_NO_PATHCONV=1` --
  # see the tasklist comment further down for why.
  if [ -n "${ALIVE_PID:-}" ]; then
    MSYS_NO_PATHCONV=1 taskkill /F /PID "$ALIVE_PID" >/dev/null 2>&1
  fi
  [ -n "${ALIVE_BPID:-}" ] && kill "$ALIVE_BPID" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

# Real Windows PID we can point tasklist at. We spawn a long-lived pwsh
# and read its WINPID via `ps -W` (MSYS PIDs from `$!` do NOT match real
# Windows PIDs, so tasklist can't be fed them directly).
#
# IMPORTANT: the spawn (`pwsh ... &`) must happen at the TOP LEVEL of this
# script, not inside a function called via command substitution -- wrapping
# it in `X="$(fn)"` runs `fn` in a subshell, and in this sandbox the
# backgrounded child does not outlive that subshell's exit (empirically
# verified while writing this test: the process is gone within ~1s when
# spawned that way, but stays alive normally at the top level).
#
# stdout/stderr redirected to /dev/null (not inherited) -- see cleanup()
# above for why an inherited pipe fd here causes a ~60s hang downstream.
pwsh -NoProfile -Command "Start-Sleep -Seconds 60" >/dev/null 2>&1 &
ALIVE_BPID=$!

# `ps -W`'s MSYS-PID -> WINPID mapping is populated asynchronously right
# after spawn and is genuinely racy here: a single `sleep 1` sometimes
# reads a stale/wrong WINPID (occasionally even the wrapper bash's WINPID
# instead of pwsh's own), which tasklist then reports as not found even
# though pwsh is alive and well. Poll both the mapping AND tasklist
# liveness together, several times, before trusting a candidate.
# (`MSYS_NO_PATHCONV=1` stops MSYS from mangling `/FI` into a Windows path
# when tasklist is invoked directly from bash -- confirmed while
# debugging #3712: without it tasklist errors with "Invalid
# argument/option - 'C:/Program Files/Git/FI'".)
ALIVE_PID=""
for _try in 1 2 3 4 5 6 7 8 9 10; do
  CANDIDATE=$(ps -W 2>/dev/null | awk -v b="$ALIVE_BPID" '$1==b{print $4}')
  if [ -n "$CANDIDATE" ] && MSYS_NO_PATHCONV=1 tasklist /FI "PID eq $CANDIDATE" /NH 2>/dev/null | grep -q "$CANDIDATE"; then
    ALIVE_PID="$CANDIDATE"
    break
  fi
  sleep 0.3
done
if [ -z "$ALIVE_PID" ]; then
  echo "SKIP  could not determine a real Windows PID to test liveness with (ps -W/tasklist unsupported here)"
fi
DEAD_PID=999999

write_session() {
  # write_session <file> <pid> <sessionId> <cwd> <startedAtMsAgo> <name>
  local file="$1" pid="$2" sid="$3" cwd="$4" ago_ms="$5" name="$6"
  local now_ms started cwd_json
  now_ms=$(($(date +%s) * 1000))
  started=$((now_ms - ago_ms))
  # Every caller passes a Windows-style cwd ("C:\Dev\...") with single
  # backslashes. Embedded straight into a JSON string that is invalid JSON
  # ("\D", "\C", ... aren't legal JSON escapes) -- json.load() throws and
  # read_registry()'s (deliberately fail-safe) except/continue silently
  # drops the whole entry. Every "other session" in this suite was
  # invisible to the engine for this reason until fixed here (#3712);
  # tests asserting an *absence* of a warning passed anyway, by accident.
  cwd_json="${cwd//\\/\\\\}"
  cat > "$file" <<EOF
{"pid":$pid,"sessionId":"$sid","cwd":"$cwd_json","startedAt":$started,"name":"$name","kind":"interactive"}
EOF
}

run_engine() {
  local mode="$1" stdin_json="$2"
  printf '%s' "$stdin_json" | USERPROFILE= HOME="$FAKE_HOME" "$PY" "$ENGINE" --mode "$mode" --repo-root "C:/Dev/CyclingZone-Fake" --now-md "$NOW_MD" 2>&1
}

check() {
  local desc="$1" cond="$2"
  if [ "$cond" = "0" ]; then
    PASS=$((PASS+1)); echo "PASS  $desc"
  else
    FAIL=$((FAIL+1)); echo "FAIL  $desc"
  fi
}

# ---------------------------------------------------------------------
# Test 1: empty/reset field + one OTHER alive repo-associated session ->
# field gets auto-populated AND the multi-AI warning fires.
# ---------------------------------------------------------------------
rm -f "$FAKE_HOME/.claude/sessions"/*.json
printf '# NOW\r\n\r\n> **\xF0\x9F\xA4\x96 Aktive sessioner:** Ingen aktiv session\r\n\r\nresten\r\n' > "$NOW_MD"

if [ -n "$ALIVE_PID" ]; then
  write_session "$FAKE_HOME/.claude/sessions/other.json" "$ALIVE_PID" "other-sid" "C:\\Dev\\CyclingZone-Fake" 120000 "cyclingzone-other"
  OUT="$(run_engine start '{"session_id":"self-sid"}')"
  check "warning fires when another alive session exists" "$( [ -n "$OUT" ] && echo 0 || echo 1 )"
  check "warning mentions MULTI-AI GATE" "$(printf '%s' "$OUT" | grep -q 'MULTI-AI GATE' && echo 0 || echo 1)"
  NEW_VAL=$(grep -a "Aktive sessioner" "$NOW_MD")
  check "field auto-populated (no longer 'Ingen aktiv session')" "$(printf '%s' "$NEW_VAL" | grep -qv 'Ingen aktiv session' && echo 0 || echo 1)"
  check "field carries auto-tag" "$(printf '%s' "$NEW_VAL" | grep -q '\[auto #3712\]' && echo 0 || echo 1)"
  check "CRLF preserved" "$(grep -c $'\r$' "$NOW_MD" >/dev/null && echo 0 || echo 1)"
fi

# ---------------------------------------------------------------------
# Test 2: alone (no other sessions) -> no warning, field still gets
# (re)written to reflect just self.
# ---------------------------------------------------------------------
rm -f "$FAKE_HOME/.claude/sessions"/*.json
printf '# NOW\r\n\r\n> **\xF0\x9F\xA4\x96 Aktive sessioner:** Ingen aktiv session\r\n' > "$NOW_MD"
OUT="$(run_engine start '{"session_id":"self-sid"}')"
check "no warning when alone" "$( [ -z "$OUT" ] && echo 0 || echo 1 )"

# ---------------------------------------------------------------------
# Test 3: curated prose in the field -> NEVER overwritten, even with a
# concurrent session detected (warning still fires though).
# ---------------------------------------------------------------------
rm -f "$FAKE_HOME/.claude/sessions"/*.json
printf '# NOW\r\n\r\n> **\xF0\x9F\xA4\x96 Aktive sessioner:** **NATBOELGE XL** -- rig kurateret kontekst med [links](x) og flere saetninger.\r\n' > "$NOW_MD"
BEFORE_SHA=$(md5sum "$NOW_MD" | cut -d' ' -f1)
if [ -n "$ALIVE_PID" ]; then
  write_session "$FAKE_HOME/.claude/sessions/other2.json" "$ALIVE_PID" "other-sid-2" "C:\\Dev\\CyclingZone-Fake" 60000 "cyclingzone-other2"
fi
OUT="$(run_engine start '{"session_id":"self-sid"}')"
AFTER_SHA=$(md5sum "$NOW_MD" | cut -d' ' -f1)
check "curated field left byte-for-byte untouched" "$( [ "$BEFORE_SHA" = "$AFTER_SHA" ] && echo 0 || echo 1 )"
if [ -n "$ALIVE_PID" ]; then
  check "warning STILL fires even though file wasn't touched" "$( [ -n "$OUT" ] && echo 0 || echo 1 )"
fi

# ---------------------------------------------------------------------
# Test 4: dead pid (stale session file, process no longer running) is
# ignored entirely -- no warning, field stays reset.
# ---------------------------------------------------------------------
rm -f "$FAKE_HOME/.claude/sessions"/*.json
printf '# NOW\r\n\r\n> **\xF0\x9F\xA4\x96 Aktive sessioner:** Ingen aktiv session\r\n' > "$NOW_MD"
write_session "$FAKE_HOME/.claude/sessions/stale.json" "$DEAD_PID" "stale-sid" "C:\\Dev\\CyclingZone-Fake" 999999999 "cyclingzone-stale"
OUT="$(run_engine start '{"session_id":"self-sid"}')"
check "stale/dead pid produces no warning" "$( [ -z "$OUT" ] && echo 0 || echo 1 )"

# ---------------------------------------------------------------------
# Test 5: session registered against an UNRELATED repo path is ignored.
# ---------------------------------------------------------------------
rm -f "$FAKE_HOME/.claude/sessions"/*.json
printf '# NOW\r\n\r\n> **\xF0\x9F\xA4\x96 Aktive sessioner:** Ingen aktiv session\r\n' > "$NOW_MD"
if [ -n "$ALIVE_PID" ]; then
  write_session "$FAKE_HOME/.claude/sessions/unrelated.json" "$ALIVE_PID" "unrelated-sid" "C:\\Dev\\SomeOtherRepo" 60000 "other-project"
  OUT="$(run_engine start '{"session_id":"self-sid"}')"
  check "session for a different repo path is not counted" "$( [ -z "$OUT" ] && echo 0 || echo 1 )"
fi

# ---------------------------------------------------------------------
# Test 6: worktree sibling path (<repo>-worktrees/<name>) IS counted as
# this repo.
# ---------------------------------------------------------------------
rm -f "$FAKE_HOME/.claude/sessions"/*.json
printf '# NOW\r\n\r\n> **\xF0\x9F\xA4\x96 Aktive sessioner:** Ingen aktiv session\r\n' > "$NOW_MD"
if [ -n "$ALIVE_PID" ]; then
  write_session "$FAKE_HOME/.claude/sessions/wt.json" "$ALIVE_PID" "wt-sid" "C:\\Dev\\CyclingZone-Fake-worktrees\\some-branch" 60000 "cyclingzone-wt"
  OUT="$(run_engine start '{"session_id":"self-sid"}')"
  check "worktree-sibling cwd counted as same repo" "$( [ -n "$OUT" ] && echo 0 || echo 1 )"
fi

# ---------------------------------------------------------------------
# Test 7: stop mode clears our own auto-marker back to reset sentinel
# when no others remain.
# ---------------------------------------------------------------------
rm -f "$FAKE_HOME/.claude/sessions"/*.json
printf '# NOW\r\n\r\n> **\xF0\x9F\xA4\x96 Aktive sessioner:** [auto #3712] 1 session(er): cyclingzone-e9 (dig) (2m)\r\n' > "$NOW_MD"
run_engine stop '{"session_id":"self-sid"}' >/dev/null
NEW_VAL=$(grep -a "Aktive sessioner" "$NOW_MD")
check "stop resets our own auto-marker to 'Ingen aktiv session' when alone" "$(printf '%s' "$NEW_VAL" | grep -q 'Ingen aktiv session' && echo 0 || echo 1)"

# ---------------------------------------------------------------------
# Test 8: stop mode leaves curated prose alone (never wrote it, not ours
# to clear).
# ---------------------------------------------------------------------
printf '# NOW\r\n\r\n> **\xF0\x9F\xA4\x96 Aktive sessioner:** **Kurateret note der IKKE maa fjernes af stop-hooken.**\r\n' > "$NOW_MD"
BEFORE_SHA=$(md5sum "$NOW_MD" | cut -d' ' -f1)
run_engine stop '{"session_id":"self-sid"}' >/dev/null
AFTER_SHA=$(md5sum "$NOW_MD" | cut -d' ' -f1)
check "stop never touches curated prose" "$( [ "$BEFORE_SHA" = "$AFTER_SHA" ] && echo 0 || echo 1 )"

# ---------------------------------------------------------------------
# Test 9: no field marker at all in the file -> engine does nothing to
# the file (no crash, no line invented out of nowhere).
# ---------------------------------------------------------------------
printf '# NOW\r\n\r\nno marker line here\r\n' > "$NOW_MD"
BEFORE_SHA=$(md5sum "$NOW_MD" | cut -d' ' -f1)
run_engine start '{"session_id":"self-sid"}' >/dev/null
AFTER_SHA=$(md5sum "$NOW_MD" | cut -d' ' -f1)
check "missing marker line -> file untouched, no crash" "$( [ "$BEFORE_SHA" = "$AFTER_SHA" ] && echo 0 || echo 1 )"

# ---------------------------------------------------------------------
# Test 10: malformed session-registry JSON is skipped, not fatal.
# ---------------------------------------------------------------------
rm -f "$FAKE_HOME/.claude/sessions"/*.json
printf '# NOW\r\n\r\n> **\xF0\x9F\xA4\x96 Aktive sessioner:** Ingen aktiv session\r\n' > "$NOW_MD"
echo '{not valid json' > "$FAKE_HOME/.claude/sessions/broken.json"
OUT="$(run_engine start '{"session_id":"self-sid"}')"
check "malformed registry file -> engine still exits cleanly (no warning)" "$( [ -z "$OUT" ] && echo 0 || echo 1 )"

echo ""
echo "Results: $PASS pass, $FAIL fail"
[ "$FAIL" = "0" ]

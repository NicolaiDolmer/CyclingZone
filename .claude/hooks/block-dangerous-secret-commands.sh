#!/usr/bin/env bash
# PreToolUse hook (matcher: "" = ALLE vaerktoejer, bevidst)
#
# Blokerer kendte command-patterns der dumper secret-values til stdout/stderr,
# Read/Grep mod secret-filer, og literal secrets i ENHVER tool_input (fx
# Agent-prompt, MCP-arg, Write/Edit-indhold). Derfor koerer den paa alle
# vaerktoejer - en matcher kun paa Bash|PowerShell ville tabe de to sidste lag.
# Defense-in-depth: PRIMÆR forsvarslinje før secret overhovedet printes.
# Sekundær er sanitize-secrets.sh (PostToolUse).
#
# Patterns katalogiseret i docs/SECRET_LEAK_VECTORS.md tabel A-D. Selve
# regelsaettet bor i block-dangerous-secret-commands.py ved siden af.
#
# Adfærd:
#   - Safe command  -> exit 0
#   - Dangerous     -> exit 2 med stderr (block), giv agent safe alternativ
#   - Scanner/runtime-fejl -> exit 2 (fail closed; intet antages sikkert)
#
# Ydelse (#8240): hooken koerer paa hvert eneste tool-kald med 5 s timeout, og en
# timeout er ingen beskyttelse. Derfor: ingen subshells/grep-pipelines, kun EEN
# Python-proces paa den normale sti (probe og scan i samme koersel). Den separate
# probe koeres kun naar scanningen fejler, for at skelne "ingen brugbar Python"
# fra "scanneren fejlede".
#
# Refs: #634 AC2, #8240.

set -u

# Stier uden subshells: normaliser backslashes og skær filnavnet af.
SELF="${BASH_SOURCE[0]//\\//}"
case "$SELF" in
  */*) HOOK_DIR="${SELF%/*}" ;;
  *) HOOK_DIR="." ;;
esac
HOOK_LIB="$HOOK_DIR/../../scripts/hooks/lib/resolve-python.sh"
SCANNER="$HOOK_DIR/block-dangerous-secret-commands.py"

# Security checks must not silently disappear when PATH contains a broken stub.
if ! source "$HOOK_LIB"; then
  echo 'SECRET GUARD BLOCKED: Python runtime helper unavailable.' >&2
  exit 2
fi

# --- #684 TRACE (cross-PC hook-firing investigation) --- (kun builtins)
{
  [ -d "$HOME/.claude" ] || mkdir -p "$HOME/.claude"
  printf -v TRACE_TS '%(%Y-%m-%dT%H:%M:%S%z)T' -1
  printf '%s hook=%s pid=%s host=%s cwd=%s\n' \
    "$TRACE_TS" \
    "${0##*/}" \
    "$$" \
    "${COMPUTERNAME:-${HOSTNAME:-unknown}}" \
    "${PWD:-}" \
    >> "$HOME/.claude/hook-trace.log"
} 2>/dev/null || true
# --- /#684 TRACE ---

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0
fi

# Samme probe som resolve_hook_python, men for EEN kandidat. Koeres kun paa
# fejlstien.
probe_python() {
  local reply
  reply=$("$1" -c 'import sys; sys.stdout.write("CZ_HOOK_PYTHON_OK" if sys.version_info >= (3, 8) else "unsupported")' </dev/null 2>/dev/null) || return 1
  [ "$reply" = 'CZ_HOOK_PYTHON_OK' ]
}

# Kandidater i samme raekkefoelge og med samme afvisning af Windows Store-aliaser
# som resolve_hook_python. PATH-opslaget sker via `hash` (builtin, ingen fork).
for name in python python3 py; do
  hash "$name" 2>/dev/null || continue
  candidate="${BASH_CMDS[$name]:-}"
  [ -n "$candidate" ] || continue
  case "${candidate,,}" in
    */windowsapps/python|*/windowsapps/python.exe|*/windowsapps/python3|*/windowsapps/python3.exe|*/windowsapps/py|*/windowsapps/py.exe) continue ;;
  esac

  # -I: ignorer PYTHON*-miljoe og laeg ikke scriptets mappe paa sys.path.
  # -S: spring site-import over (hurtigere opstart; kun stdlib bruges).
  "$candidate" -I -S "$SCANNER" <<<"$INPUT"
  rc=$?
  case "$rc" in
    10) exit 0 ;;   # tilladt
    12) exit 2 ;;   # blokeret; beskeden er skrevet af scanneren
  esac

  # Scanneren gav ikke et gyldigt svar. Er kandidaten en brugbar Python, er det
  # scanneren der fejlede -> bloker. Ellers proev naeste kandidat.
  if probe_python "$candidate"; then
    secret_runtime_failure 'tool-input scan failed' "scanner exit=$rc"
    exit 2
  fi
done

secret_runtime_failure 'no working Python >=3.8 (Windows Store aliases rejected)'
exit 2

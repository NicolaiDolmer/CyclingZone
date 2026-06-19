#!/bin/bash
# gh-retry.sh — delt retry-wrapper for gh CLI-kald (bash).
#
# Hvorfor: gh CLI rammer GitHub GraphQL med intermitterende HTTP 401
# (~40% af kald) under multiagent-natboelger hvor parallel-last er hoej
# og ingen ejer er vaagen til at koere 'gh auth refresh' (#1285). REST
# rammes sjaeldnere end GraphQL, men begge kan flake. Et enkelt retry
# med kort pause rydder typisk fejlen. Standardiserer det retry-loop som
# tidligere blev copy-pastet ind i hver fleet-prompt.
#
# Brug: source dette script og kald gh_with_retry i stedet for gh:
#   source "$(dirname "$0")/lib/gh-retry.sh"
#   gh_with_retry issue comment 42 --body "hej"
#   gh_with_retry api graphql -f query='query{viewer{login}}'
#
# Env-overrides (spejler PowerShell-variantens defaults):
#   GH_RETRY_ATTEMPTS  (default 5)
#   GH_RETRY_DELAY     (default 3, sekunder)
#
# Exit-kode: gh's sidste exit-kode hvis alle forsoeg fejler (saa callere
# kan teste $?), 0 ved succes. Ren stdout fra gh sendes uaendret videre.

gh_with_retry() {
  local attempts="${GH_RETRY_ATTEMPTS:-5}"
  local delay="${GH_RETRY_DELAY:-3}"
  [ "$attempts" -ge 1 ] 2>/dev/null || attempts=1

  local i rc=1
  for ((i = 1; i <= attempts; i++)); do
    gh "$@"
    rc=$?
    if [ "$rc" -eq 0 ]; then
      return 0
    fi
    if [ "$i" -lt "$attempts" ]; then
      echo "  [gh-retry] forsoeg $i/$attempts fejlede (exit $rc) — venter ${delay}s..." >&2
      sleep "$delay"
    fi
  done

  echo "  [gh-retry] alle $attempts forsoeg fejlede (sidste exit $rc): gh $*" >&2
  return "$rc"
}

#!/usr/bin/env bash
# Runtime discovery only. Caller decides whether absence is fatal or advisory.
resolve_hook_python() {
  local name candidate reply
  for name in python python3 py; do
    candidate=$(command -v "$name" 2>/dev/null) || continue
    # Windows app-execution aliases are stubs, not a verified interpreter.
    case "${candidate,,}" in
      */windowsapps/python|*/windowsapps/python.exe|*/windowsapps/python3|*/windowsapps/python3.exe|*/windowsapps/py|*/windowsapps/py.exe) continue ;;
    esac
    reply=$("$candidate" -c 'import sys; sys.stdout.write("CZ_HOOK_PYTHON_OK" if sys.version_info >= (3, 8) else "unsupported")' </dev/null 2>/dev/null) || continue
    [ "$reply" = 'CZ_HOOK_PYTHON_OK' ] || continue
    printf '%s' "$candidate"
    return 0
  done
  return 1
}

# Sanitér scanner-stderr til ÉN kort linje der kan vises i en blokeringsbesked.
# $1 = fil med scannerens stderr. Printer en afkortet, redacted enkelt-linje.
#
# Hvorfor (#5326): uden aarsagen i beskeden er en runtime-fejl i vagten umulig at
# fejlsoege — man starter forfra hver gang. Men stderr maa aldrig baere payload
# videre, saa: kun de sidste 10 linjer, alle lange token-lignende koerer
# maskeres, og resultatet klippes til 400 tegn. Bevidst uden Python: helperen
# bruges netop naar Python er den der fejlede.
#
# #5426: den generiske taerskel stod paa 25+ tegn — en AWS access key-ID er
# kun 20 tegn (AKIA + 16 tegn) og ville slippe igennem, hvis en fremtidig
# traceback i scan-secrets.py kom til at ekko raa input. Genbruger scannerens
# eget AKIA-moenster (PATTERNS i scan-secrets.py) som navngiven regel FOER den
# generiske faldback, og saenker selve faldback-taersklen til 20 tegn. Kun hvad
# denne funktion PRINTER aendres — vagtens BLOKERINGS-logik (scan-secrets.py)
# er uaendret.
secret_sanitize_detail() {
  local f="${1:-}"
  if [ -z "$f" ] || [ ! -s "$f" ]; then
    printf '%s' '(scanner wrote nothing to stderr)'
    return 0
  fi
  tail -n 10 "$f" 2>/dev/null \
    | tr '\r\n\t' '   ' \
    | sed -E \
        -e 's/\bAKIA[0-9A-Z]{16}\b/[REDACTED-AWS-KEY]/g' \
        -e 's/[A-Za-z0-9_+=-]{20,}/[REDACTED-LONG-TOKEN]/g' \
    | cut -c1-400
}

# $1 = kort aarsag (uaendret kontrakt). $2 = valgfri, allerede saniteret detalje.
secret_runtime_failure() {
  printf 'SECRET GUARD BLOCKED: %s. Input/output could not be checked; nothing is assumed safe.\n' "$1" >&2
  if [ -n "${2:-}" ]; then
    printf '  cause: %s\n' "$2" >&2
  fi
  return 2
}

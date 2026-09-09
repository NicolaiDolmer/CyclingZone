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

secret_runtime_failure() {
  printf 'SECRET GUARD BLOCKED: %s. Input/output could not be checked; nothing is assumed safe.\n' "$1" >&2
  return 2
}

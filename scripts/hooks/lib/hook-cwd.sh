# Faelles cwd- og rod-opslag for hooks (#8206). Sources, koeres ikke selv.
#
# Hvorfor: settings.json kalder hooks med absolut sti ("$CLAUDE_PROJECT_DIR/..."),
# men hook-PROCESSENS cwd er ikke noedvendigvis der, hvor kommandoen koerer.
# Maalt 15/11: i en worktree-session koerte hooks med cwd C:\Dev\CyclingZone
# (hovedmappen), mens Bash-vaerktoejet stod i worktreet eller i frontend/. Saa
# vurderede branch-, push- og slette-vagterne den forkerte mappe. Claude Code
# sender den rigtige mappe som "cwd" i hook-inputtet; den bruges her.
#
# Brug:
#   . "$(dirname "$0")/lib/hook-cwd.sh"     (fra scripts/hooks/*.sh)
#   hook_enter_cwd "$INPUT"   # cd til inputtets cwd, hvis den findes
#   ROOT=$(hook_repo_root)    # git-roden for cwd, ellers scriptets eget repo

HOOK_CWD_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"

# hook_input_cwd JSON -> skriver feltet "cwd" (JSON-escaping af \ fjernet), eller intet.
# Et "cwd" inde i en kommando-streng er escaped (\"cwd\") og matcher ikke.
hook_input_cwd() {
  printf '%s' "$1" | tr -d '\r\n' \
    | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\(\([^"\\]\|\\.\)*\)".*/\1/p' \
    | sed 's/\\\\/\\/g'
}

# hook_enter_cwd JSON -> cd til inputtets cwd. Mangler feltet, eller findes mappen
# ikke, bliver processen staaende (fail-open til tidligere adfaerd).
hook_enter_cwd() {
  local dir
  dir=$(hook_input_cwd "$1")
  [ -n "$dir" ] && [ -d "$dir" ] && cd "$dir" 2>/dev/null
  return 0
}

# hook_repo_root -> git-roden for den aktuelle mappe; uden for et repo roden for
# det repo, dette bibliotek ligger i. Exit 1 hvis ingen af dem kan findes.
hook_repo_root() {
  local root
  root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$root" ] && [ -n "$HOOK_CWD_LIB_DIR" ]; then
    root=$(git -C "$HOOK_CWD_LIB_DIR" rev-parse --show-toplevel 2>/dev/null)
  fi
  [ -n "$root" ] || return 1
  printf '%s\n' "$root"
}

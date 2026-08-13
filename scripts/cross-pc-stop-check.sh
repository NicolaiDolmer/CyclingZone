#!/bin/bash
# Stop-hook: advarer (ikke blokerende) om lokal state en ANDEN PC ikke kan se.
#
# BETINGET siden #3654. Hooken var permanent-taendt: den fyrede ved hver eneste
# session-end og paastod at "anden PC kan ikke fortsaette", ogsaa naar der ikke
# havde vaeret en anden PC i maanedsvis. Den modsagde dermed repoets egen regel,
# AGENTS.md §LOKAL: "Med solo Claude-operation er rutinen ikke laengere en
# per-session-gate — koer kun auditen ad hoc hvis du mistaenker drift (fx efter
# laengere ophold paa en sekundaer PC)."
#
# Gaten er nu den regel, i kode: advarslen er TAVS medmindre en anden PC end
# denne reelt har vaeret aktiv for nylig. "Aktiv" maales paa den delte
# OneDrive-context, hvor hver PC ejer sin egen claude-transcripts-<PC>/ +
# codex-sessions-<PC>/ (konvention fra scripts/cross-pc-sync.sh, #391). En PC
# der koerer sessions skriver ind i sin mappe ved hver Stop.
#
# Tjekker (KUN naar gaten er aaben):
#   1. Uncommitted changes (git status --porcelain)
#   2. Commits ahead af upstream (git log @{u}..HEAD)
#   3. Stash-entries (git stash list)
#   4. Lokal-only AI-state i .codex.local/ udenfor whitelist
#
# Uafhaengigt af gaten (koerer altid):
#   5. PUSH: trigger cross-PC transcript sync til OneDrive (background, non-blocking).
#      Det er selve maalingen gaten hviler paa, og den maa aldrig gates vaek (#391).
#
# Env-knapper:
#   CROSS_PC_STOP_CHECK   auto (default) | always | off
#                         auto  = advar kun naar en anden PC har vaeret aktiv
#                         always= advar altid (gammel adfaerd)
#                         off   = advar aldrig (transcript-sync koerer stadig)
#   CROSS_PC_ACTIVE_DAYS  vindue for "anden PC er aktiv", i dage (default 14)
#
# Output: systemMessage til Claude Code via JSON paa stdout. Exit altid 0 (non-blocking).

# Vaer tolerant overfor at vaere udenfor et git-repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

# Trigger transcript-sync i background (#391 Phase 2). Log: ~/.claude/cross-pc-sync.log
# Stiller hverken stdout-output op eller blokerer Stop-hook.
if [ -x "$(git rev-parse --show-toplevel)/scripts/cross-pc-sync.sh" ]; then
  nohup bash "$(git rev-parse --show-toplevel)/scripts/cross-pc-sync.sh" >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi

mode="${CROSS_PC_STOP_CHECK:-auto}"
if [ "$mode" = "off" ]; then
  exit 0
fi

active_days="${CROSS_PC_ACTIVE_DAYS:-14}"
case "$active_days" in
  '' | *[!0-9]*) active_days=14 ;;
esac

# Rod for den delte OneDrive-context. Samme udledning som scripts/cross-pc-sync.sh
# (bevidst duplikeret frem for sourced: sync-scriptet koeres detached via nohup, og
# et broken source dér ville droppe transcript-syncen lydloest).
onedrive_context_root() {
  local root="${OneDrive:-${USERPROFILE:-$HOME}/OneDrive}"
  root=$(echo "$root" | sed 's|\\|/|g')          # Windows-stier (\) -> Unix (/)
  root=$(echo "$root" | sed 's|^\([A-Z]\):|/\L\1|')  # C: -> /c (Git Bash)
  echo "$root/CyclingZone-context"
}

# Ekkoer navnet paa en ANDEN PC der har synket indenfor vinduet, ellers intet.
active_other_pc() {
  local ctx dir name this_pc
  ctx=$(onedrive_context_root)
  [ -d "$ctx" ] || return 0

  this_pc=$(echo "${COMPUTERNAME:-$(hostname)}" | tr '[:upper:]' '[:lower:]')

  for dir in "$ctx"/claude-transcripts-* "$ctx"/codex-sessions-*; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    name="${name#claude-transcripts-}"
    name="${name#codex-sessions-}"
    [ -n "$name" ] || continue
    # Denne PC's egen mappe er ikke en cross-PC-situation.
    [ "$(echo "$name" | tr '[:upper:]' '[:lower:]')" != "$this_pc" ] || continue
    # -print -quit: stop ved foerste traeffer, saa hooken ikke gaar en hel
    # transcript-mappe igennem ved hver session-end.
    if [ -n "$(find "$dir" -type f -mtime "-$active_days" -print -quit 2>/dev/null)" ]; then
      echo "$name"
      return 0
    fi
  done
}

other_pc=""
if [ "$mode" != "always" ]; then
  other_pc=$(active_other_pc)
  # Ingen anden PC har vaeret aktiv -> ingen cross-PC-situation -> ingen advarsel.
  if [ -z "$other_pc" ]; then
    exit 0
  fi
fi

issues=()

# 1. Uncommitted
porcelain=$(git status --porcelain 2>/dev/null)
if [ -n "$porcelain" ]; then
  count=$(echo "$porcelain" | wc -l)
  issues+=("$count uncommitted aendring(er)")
fi

# 2. Ahead af upstream
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
if [ -n "$upstream" ]; then
  ahead=$(git rev-list --count "@{u}..HEAD" 2>/dev/null || echo "0")
  if [ "$ahead" -gt 0 ]; then
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    issues+=("$branch er $ahead commit(s) ahead af $upstream (ikke pushet)")
  fi
fi

# 3. Stash
stash_count=$(git stash list 2>/dev/null | wc -l)
if [ "$stash_count" -gt 0 ]; then
  issues+=("$stash_count stash-entry/-ies eksisterer (ikke synced)")
fi

# 4. Lokal-only AI-state i .codex.local/ (whitelist match — alt andet er lokal-only persistent)
# Whitelist: SESSION_CONTEXT.md, SUPABASE_CONTEXT.md, supabase-readonly.env, preflight-state.json
# + ephemeral patterns: commit-msg*.txt, commit-N.txt, commitmsg-*.txt, pr*-body.md, pr-body-*.md
if [ -d ".codex.local" ]; then
  local_only=$(find .codex.local -type f \
    ! -name "SESSION_CONTEXT.md" \
    ! -name "SUPABASE_CONTEXT.md" \
    ! -name "supabase-readonly.env" \
    ! -name "preflight-state.json" \
    ! -name "commit-msg*.txt" \
    ! -name "commit-*.txt" \
    ! -name "commitmsg-*.txt" \
    ! -name "pr*-body.md" \
    ! -name "pr-body-*.md" \
    2>/dev/null)
  if [ -n "$local_only" ]; then
    count=$(echo "$local_only" | wc -l)
    issues+=("$count fil(er) i .codex.local/ udenfor whitelist (kør 'pwsh -File scripts/cross-pc-forensic-audit.ps1' for detaljer)")
  fi
fi

if [ ${#issues[@]} -eq 0 ]; then
  exit 0
fi

# Byg besked
msg="ADVARSEL — cross-PC sync ikke i orden:"
for i in "${issues[@]}"; do
  msg="$msg | $i"
done
if [ -n "$other_pc" ]; then
  msg="$msg | $other_pc har synket indenfor de sidste $active_days dage og kan ikke fortsaette uden disse aendringer."
else
  msg="$msg | Anden PC kan ikke fortsaette uden disse aendringer (CROSS_PC_STOP_CHECK=always)."
fi

# Escape til JSON (escape backslash og quote)
msg_json=$(echo "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')
echo "{\"systemMessage\": \"$msg_json\"}"
exit 0

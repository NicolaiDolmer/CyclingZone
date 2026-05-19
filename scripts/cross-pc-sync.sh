#!/bin/bash
# Cross-PC transcript sync — push lokale Claude/Codex sessions til OneDrive
# Issue: #391 (Phase 2 sub-task 1) — time-tracker cross-PC merge
#
# Hver PC ejer sin egen <root>/claude-transcripts-<COMPUTERNAME>/ + codex-sessions-<COMPUTERNAME>/.
# Idempotent: bruger `cp -ru` (kun nye/modificerede filer).
# Designet til at køre fra Stop-hook i background — output går til log, ikke stdout.
#
# Brug:
#   bash scripts/cross-pc-sync.sh          # synkron, til CLI-debugging
#   bash scripts/cross-pc-sync.sh &        # background (Stop-hook pattern)
#
# Log: ~/.claude/cross-pc-sync.log (roterer ved 1MB)

set -u

PC_NAME="${COMPUTERNAME:-$(hostname)}"
LOG="$HOME/.claude/cross-pc-sync.log"

# Roter log hvis > 1MB
if [ -f "$LOG" ]; then
  size=$(wc -c < "$LOG" 2>/dev/null || echo 0)
  if [ "$size" -gt 1048576 ]; then
    mv "$LOG" "${LOG}.old" 2>/dev/null || true
  fi
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# Find OneDrive-root via $OneDrive env var, fallback til USERPROFILE/OneDrive
ONEDRIVE="${OneDrive:-${USERPROFILE:-$HOME}/OneDrive}"
# Konverter Windows-stier (\) til Unix (/)
ONEDRIVE=$(echo "$ONEDRIVE" | sed 's|\\|/|g')
# Konverter C: → /c (Git Bash)
ONEDRIVE=$(echo "$ONEDRIVE" | sed 's|^\([A-Z]\):|/\L\1|')

CTX_ROOT="$ONEDRIVE/CyclingZone-context"

if [ ! -d "$CTX_ROOT" ]; then
  log "skip $PC_NAME: OneDrive-context mangler ($CTX_ROOT)"
  exit 0
fi

CLAUDE_SRC="$HOME/.claude/projects/C--dev-CyclingZone"
CODEX_SRC="$HOME/.codex/sessions"

CLAUDE_DST="$CTX_ROOT/claude-transcripts-${PC_NAME}"
CODEX_DST="$CTX_ROOT/codex-sessions-${PC_NAME}"

sync_dir() {
  local src="$1" dst="$2" name="$3"
  if [ ! -d "$src" ]; then
    log "skip $name: source mangler ($src)"
    return
  fi
  mkdir -p "$dst" 2>>"$LOG"
  # cp -ru: rekursivt, kun nye/modificerede filer (mtime-baseret)
  # 2>&1 fanger eventuelle OneDrive-lås-fejl uden at fejle hooket
  local start=$(date +%s)
  cp -ru "$src/." "$dst/" 2>>"$LOG"
  local rc=$?
  local elapsed=$(($(date +%s) - start))
  if [ $rc -eq 0 ]; then
    local file_count=$(find "$dst" -type f 2>/dev/null | wc -l)
    log "synced $name → $dst (${elapsed}s, $file_count files total)"
  else
    log "ERROR syncing $name → $dst (rc=$rc, ${elapsed}s)"
  fi
}

sync_dir "$CLAUDE_SRC" "$CLAUDE_DST" "claude"
sync_dir "$CODEX_SRC" "$CODEX_DST" "codex"

exit 0

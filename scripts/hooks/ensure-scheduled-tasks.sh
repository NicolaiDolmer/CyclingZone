#!/bin/bash
# SessionStart hook. For hver canonical task-konfiguration i
# scripts/scheduled-tasks/*.json: tjek om SKILL.md findes under
# ~/.claude/scheduled-tasks/<taskId>/. Hvis nogen mangler, emit en
# systemMessage til Claude med præcise MCP-instruktioner til at registrere
# dem via `mcp__scheduled-tasks__create_scheduled_task`.
#
# Idempotent: gør intet hvis alle tasks allerede er registreret.
# Fail-safe: exit 0 også ved fejl, så session-start aldrig blokeres.
#
# Refs: issue #380, PR #453.

set -u

CONFIG_DIR="scripts/scheduled-tasks"
SCHED_DIR="$HOME/.claude/scheduled-tasks"

[ -d "$CONFIG_DIR" ] || exit 0

MISSING=()

# Glob, men toleret hvis ingen matches.
shopt -s nullglob 2>/dev/null || true
for f in "$CONFIG_DIR"/*.json; do
  taskId=$(sed -n 's/.*"taskId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -1)
  [ -z "$taskId" ] && continue
  if [ ! -f "$SCHED_DIR/$taskId/SKILL.md" ]; then
    MISSING+=("$taskId|$f")
  fi
done

[ "${#MISSING[@]}" -eq 0 ] && exit 0

MSG="📅 Scheduled-tasks mangler at blive registreret på denne PC ($(${COMPUTERNAME:+echo $COMPUTERNAME} || hostname 2>/dev/null || echo unknown)).\\n\\nFor hver task nedenfor: kald \`mcp__scheduled-tasks__create_scheduled_task\` med præcis disse parametre (læs prompt-filen og indsæt indholdet som \`prompt\`).\\n"

for entry in "${MISSING[@]}"; do
  taskId="${entry%%|*}"
  file="${entry#*|}"
  desc=$(sed -n 's/.*"description"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -1)
  cron=$(sed -n 's/.*"cronExpression"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -1)
  promptFile=$(sed -n 's/.*"promptFile"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -1)
  MSG="${MSG}\\n- **taskId**: \`$taskId\`\\n  - description: $desc\\n  - cronExpression: \`$cron\`\\n  - prompt: indhold af \`$promptFile\` (læs filen)\\n"
done

MSG="${MSG}\\nEfter registrering kører hook'en stille på alle fremtidige sessioner — denne besked vises kun indtil tasksene er live."

printf '{"systemMessage": "%s"}\n' "$MSG"
exit 0

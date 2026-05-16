# Canonical scheduled-tasks for CyclingZone

Hver `*.json`-fil her beskriver én scheduled task der bør findes på **alle** PCs hvor der arbejdes med dette repo. SessionStart-hook'en [`scripts/hooks/ensure-scheduled-tasks.sh`](../hooks/ensure-scheduled-tasks.sh) tjekker hver session om de tilsvarende SKILL.md-filer findes i `~/.claude/scheduled-tasks/<taskId>/`. Hvis nogen mangler, beder den den aktive Claude-session registrere dem via `mcp__scheduled-tasks__create_scheduled_task` (en MCP-tool-call).

## Schema

```json
{
  "taskId": "kebab-case-id",
  "description": "One-line description (used in SKILL.md frontmatter)",
  "cronExpression": "minute hour dayOfMonth month dayOfWeek",
  "promptFile": "scripts/scheduled-tasks/<taskId>-prompt.md"
}
```

`cronExpression` er valgfri; udelad for ad-hoc tasks. Brug `fireAt` (ISO 8601) i stedet for engangs-kørsler.

## Hvorfor ikke bare committe SKILL.md direkte?

`~/.claude/scheduled-tasks/` er user-scoped (per-PC) og scheduler-staten (cron-firing) lever inde i MCP-serverens egen state. At kopiere en SKILL.md-fil registrerer **ikke** cron-jobbet — vi skal kalde `create_scheduled_task` for at MCP'en ved den skal fyre. Derfor det indirekte mønster: canonical config i repo + hook der beder Claude registrere.

## Tilføj ny task

1. Skriv `scripts/scheduled-tasks/<taskId>.json` (følg schema over).
2. Skriv `scripts/scheduled-tasks/<taskId>-prompt.md` (selve prompten — skal være selv-indeholdt, da hver kørsel starter med tom kontekst).
3. Commit + push. På næste session-start på enhver PC vil hook'en detektere den manglende task og bede Claude registrere den.

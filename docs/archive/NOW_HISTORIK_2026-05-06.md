# NOW-historik 2026-05-06

## Senest leveret (flyttet fra NOW.md ved session-slut 2026-05-06 Discord MCP cross-PC automation)

- 2026-05-06: **Discord→GitHub bridge LIVE** (`0d2b703`). 42 issues (#7-#48) genereret fra 49 aktive Discord-tråde via `mcp-discord` MCP + `gh` CLI. 27 skærmbilleder downloaded til `docs/discord-attachments/` (refereret via raw.github URLs). Setup: [`docs/DISCORD_MCP_SETUP.md`](../DISCORD_MCP_SETUP.md). Re-sync: `scripts/sync-discord-attachments.js`. Batch-filing template: `scripts/file-discord-issues-batch3.js`. Tier 4 archive blokeret — bot mangler `MANAGE_THREADS` perm (manual close i Discord, eller grant perm).
- 2026-05-06: **Slice DX Lag 1+2+3 — agent-loop live** (`c1a8970`). 3 workflows: `claude.yml` (@claude-trigger via OAuth Pro-subscription), `claude-review.yml` (opus-4-7), `claude-triage.yml` (sonnet-4-6). Auto-triage kører nu på Discord-issues.

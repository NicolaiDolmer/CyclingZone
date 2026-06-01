# Codex Workflows

Codex is the local operator for CyclingZone: fast repo inspection, small safe edits, verification, issue hygiene, browser checks, and connector-backed runtime checks. Long-lived state still belongs in GitHub issues, repo docs, or OneDrive context; local Codex files are caches only.

## Session Start

Run this before Codex edits tracked files:

```bash
npm run codex:doctor
```

The command wraps the AGENTS.md cold-start checks in a Codex-friendly way:

- verifies repo root
- fetches origin and prints branch status
- checks tracked secret files
- blocks obvious inline secrets in `.mcp.json`
- runs the cross-PC forensic audit
- summarizes `agent-doctor`
- shows the current `claude:todo` issue queue
- classifies `.agents/`, `issues*.json`, and `open_issues.json` as local regenerable artifacts

If `mcp-local-secret` fails, stop implementation work until the token is rotated and `.mcp.json` is rebuilt from environment-backed config.

## MCP Secrets

MCP secrets must never be stored in repo workspace config files. `.mcp.json` is gitignored, but it is still local-only state and may be copied, indexed, or pasted accidentally.

Use `.mcp.example.json` as the shape template and provide secrets via the parent process environment or Infisical. For Discord MCP, `DISCORD_TOKEN` must be injected outside the file.

Manual rotation checklist:

1. Rotate the Discord bot token in the Discord Developer Portal.
2. Store the new value in Infisical or the local user environment, not in the repo.
3. Recreate `.mcp.json` from `.mcp.example.json` without an `env` block containing token values.
4. Run `npm run codex:doctor` and confirm `mcp-local-secret` is OK.
5. Treat any old token visible in chat, screenshots, shell history, or local config as compromised.

## Tool Routing

Use the smallest tool that proves the slice:

| Trigger | Codex tool path |
|---|---|
| Frontend/UI change | Run local checks, start the app if needed, then verify with Browser. |
| Deploy or preview verification | Use Vercel MCP/CLI for deployment state and logs, then fetch the preview/prod URL. |
| Database/schema/RLS question | Use Supabase tooling or Infisical-backed scripts; never infer DB truth from docs alone. |
| Production/runtime errors | Use Sentry first, then logs, then code. |
| Issue grooming or handoff | Use GitHub CLI/app with bounded `--json` fields and comment back to the issue. |
| Security-sensitive diff | Use Codex Security scan skills before commit or PR. |
| Repeating launch checks | Propose a Codex automation for user review before creating it. |

## Issue Labels

Recommended Codex labels:

- `agent:codex` - Codex owns the next action.
- `codex:good-first` - small, low-risk local slice.
- `codex:needs-browser` - requires browser verification.
- `codex:needs-supabase` - requires DB/schema/runtime verification.
- `codex:needs-prod-verify` - requires production or preview verification after deploy.
- `codex:blocked-access` - blocked by missing connector, token, login, or manual user action.

Add this field to agent handoff comments when Codex is next:

```md
**Codex verification:** command/browser/connector checks required before close-out.
```

## Patch Notes

Docs/tooling-only Codex workflow changes do not require `PatchNotesPage.jsx`. Mention "Patch notes not needed: no user-facing runtime/UI change" in the close-out or issue comment.

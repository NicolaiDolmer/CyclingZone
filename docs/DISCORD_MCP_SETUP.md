# Discord MCP Setup — Quick Guide

How to recreate the Discord-GitHub feedback bridge on a new PC.

The bridge reads Discord threads from `#bug-reports` and `#feature-request` (and other channels) and creates GitHub issues with embedded screenshots, via:
- `scripts/discord/mcp-readonly-server.mjs` — our own **read-only** MCP server (REST only, zero dependencies), exposed to Claude Code as server `discord` (#5484)
- Direct Discord REST API calls — for capabilities the MCP server doesn't expose (attachment URLs, thread archive, active-thread listing)
- `gh` CLI — issue creation (MCP write returns 403 until claude.ai-connector reconnects)

### Why not `npx mcp-discord` / the Discord plugin (#5484)

- **`npx -y mcp-discord`** (used until 24/9) did a Discord **gateway** login before answering the MCP handshake. Discord allows one gateway IDENTIFY per 5 s per bot (`max_concurrency: 1`), so parallel session starts queued up (measured: 5, 10, 15, 20, 22, 31 s for 6 at once) and Claude Code's 30 s connect timeout cut them off. 30 % of starts failed with `CONNECT_TIMEOUT` in September. The replacement uses REST only: handshake in ~0.1 s, 1.3–1.9 s for 4 fresh sessions started at once.
- **`discord@claude-plugins-official`** (`plugin:discord:discord`) is a different product: a two-way chat bridge that needs Bun, `--channels` and pairing. Bun was never installed, so it failed with `Connection closed` on every start (275/275). `setup-discord-mcp.ps1` disables it.
- The server has **no write tools** (no send/delete/create), which enforces `docs/SOCIAL_RULES.md` structurally. Anything that writes to Discord goes through an owner-approved script, never MCP.

---

## Prerequisites

- Node.js installed (for the MCP server and the helper scripts)
- `gh` CLI installed and authenticated (`gh auth status` shows logged in)
- Discord bot already created at https://discord.com/developers/applications
  - Bot: **"Cycling Zone#8784"** (id: `1500376268825301033`)
  - Server: **"Cycling Zone"** (id: `1504615050831466669`, verified 24/9)
- Bot token — `DISCORD_TOKEN` as a **User env var** (Claude Code passes its own environment to the server). `setup-discord-mcp.ps1 -SyncTokenFromInfisical` copies it from Infisical dev. Do not write it into `.mcp.json`: an `env` block there overrides the parent env (verified 24/9), so a stale inline token silently wins.
- Bot already invited to the server with permissions:
  - ✅ View Channels
  - ✅ Read Message History
  - ✅ Send Messages (used by production backend for DM notifications)
  - ⚠️ Manage Threads (NOT yet granted — needed for auto-archiving via API; otherwise you must close threads manually in Discord client)
- Bot has **Message Content Intent** enabled (Discord Developer Portal → Bot → Privileged Gateway Intents)

---

## Quickstart — automatiseret (anbefalet)

Kør én kommando i en normal PowerShell (én gang pr. PC, og igen når `scripts/discord/mcp-readonly-server.mjs` ændres):

```powershell
pwsh -File scripts/setup-discord-mcp.ps1 -SyncTokenFromInfisical
```

Scriptet (idempotent):
1. Installerer serveren til `%LOCALAPPDATA%\CyclingZone\discord-mcp\` (uden for checkoutet, så den virker uanset hvilken branch et checkout står på)
2. Skriver `.mcp.json` uden secrets i main-checkout, alle worktrees og OneDrive-kilden `CyclingZone-context\secrets\mcp.json`, som nye worktrees hardlinker fra
3. Sætter `DISCORD_TOKEN` som User env var fra Infisical dev (kun med `-SyncTokenFromInfisical`) og tjekker den mod `GET /users/@me`. Værdien printes aldrig
4. Slår `discord@claude-plugins-official` fra
5. Sikrer at `.claude/settings.local.json` har `enabledMcpjsonServers: ["discord"]`
6. Smoke-tester MCP-handshaket

Start derefter en **ny** Claude Code-session (MCP loades kun ved opstart). Verificér med `/mcp`: `discord` skal stå som connected. Hvad scriptet ændrer uden for repoet står i [`CROSS_PC_SETUP.md`](CROSS_PC_SETUP.md#discord-mcp-pr-pc-5484).

---

## Manuel setup (fallback)

### 1. Create `.mcp.json` in repo root

Gitignored on purpose and must contain no token values (template: `.mcp.example.json`). Claude Code expands `${LOCALAPPDATA}`:

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["${LOCALAPPDATA}/CyclingZone/discord-mcp/mcp-readonly-server.mjs"]
    }
  }
}
```

Copy `scripts/discord/mcp-readonly-server.mjs` to that path first.

### 2. Verify `.claude/settings.local.json` has

```json
{
  "enabledMcpjsonServers": ["discord"]
}
```

Also gitignored. Add it if missing.

### 3. Restart Claude Code

MCP servers load only at startup. Close and reopen from project root.

### 4. Verify in Claude Code

- `/mcp` — should list `discord` as connected
- `mcp__discord__discord_login` — replies `Discord REST OK as Cycling Zone (id ...)`

---

## Tools available (all read-only)

Names match the old `mcp-discord`, so existing prompts keep working:
- `discord_read_messages` — up to 100 messages from a text channel or thread, oldest first
- `discord_get_server_info` — guild info plus all channels grouped by type
- `discord_get_forum_channels` — forum channels in a guild
- `discord_get_forum_post` — a forum thread plus its 10 newest messages
- `discord_login` — identity check for the configured token (takes no token argument)

There are no write tools. Posting to Discord is an owner decision (`docs/SOCIAL_RULES.md`) and happens outside MCP.

---

## What the MCP server can NOT do (and the workarounds)

| Limitation | Workaround |
|---|---|
| `discord_read_messages` returns an `attachments` count, **not URLs** | Use Discord REST `GET /channels/{id}/messages?limit=20` directly — see `scripts/sync-discord-attachments.js` |
| No "list guilds" tool | User provides guild ID manually (right-click server icon → Copy Server ID; requires User Settings → Advanced → Developer Mode ON) |
| No "list active threads" tool | Use Discord REST `GET /guilds/{id}/threads/active` directly (`scripts/discord/list-active-threads.mjs`) |
| No archive/close-thread tool | PATCH `/channels/{thread_id}` with `{"archived": true, "locked": false}`. **Requires `MANAGE_THREADS` permission** for other users' threads — otherwise `50001 Missing Access` |
| Daily triage across all channels | `infisical run --env=dev --silent -- node scripts/discord/sweep-daily.mjs` (batch report with cutoff state; complements MCP, not a workaround) |

---

## Re-sync images from Discord

When new feedback arrives in Discord:

```bash
node scripts/sync-discord-attachments.js
```

This script:
1. Reads `DISCORD_TOKEN` from the process environment
2. Fetches messages from each thread ID listed in `THREADS` (top of file — update as new threads appear)
3. Downloads all attachments to `docs/discord-attachments/{thread-id}-{att-id}.png`
4. Writes `docs/discord-attachments/_mapping.json` with metadata for each image

After running, commit and push:
```bash
git add docs/discord-attachments/
git commit -m "feat: sync Discord image attachments"
git push origin main
```

This makes images available at `https://raw.githubusercontent.com/NicolaiDolmer/CyclingZone/main/docs/discord-attachments/{filename}`.

---

## File new GitHub issues from Discord

`scripts/file-discord-issues-batch3.js` is a self-contained reference template. To file a new batch:

1. Copy the script to e.g. `scripts/file-discord-issues-batch4.js`
2. Replace the `issues` array with new issue data (each entry: `id`, `threadId`, `title`, `labelType`, `author`, `threadTitle`, `timestamp`, `text`, `images[]`, `files[]`, `notes`, `acceptance[]`)
3. Image references work via `RAW_BASE` constant (already configured)
4. Run:
   ```bash
   node scripts/file-discord-issues-batch4.js
   ```
   The script handles 504 retries automatically.

---

## Workflow summary

```
Discord feedback → run sync script → commit images → run file-issues script → GitHub issues w/ embedded images → auto-triage workflow labels them → manager fixes
```

---

## Permissions checklist

If you later want full automation (incl. auto-archive of resolved threads):

**Discord server** (Server Settings → Roles → bot role):
- ✅ View Channels
- ✅ Read Message History
- ✅ Send Messages
- ⚠️ Manage Threads — NOT yet granted (needed for archive)
- ⚠️ Manage Messages — NOT yet granted (needed for delete-message)

To grant on the bot's role: enable in Discord, no token rotation needed.

---

## Security notes

- **`.mcp.json` is local config, not a secret store:** gitignored and must contain no token values. Use `.mcp.example.json` as the template.
- **Token rotation required after transcript exposure:** Discord Developer Portal → Bot → Reset Token, update Infisical/user-env `DISCORD_TOKEN`, restart Claude Code/Codex, verify with `/mcp`. Old token keeps working until reset.
- The Supabase service key was also briefly exposed in a tool result. **Rotate too:** Supabase Dashboard → Settings → API → "Reset service_role key", then update Railway `SUPABASE_SERVICE_KEY`.
- **✅ Read/Grep leak-vector closed (2026-05-29, #634 follow-up):** agents can no longer Read/Grep this file (or any `*.env` / `*/secrets/*`) — `block-dangerous-secret-commands.sh` blocks it (exit 2), and the PostToolUse sanitizer now also covers `Read`/`Grep` output as backup. Verified live + in `scripts/test-sanitize-secrets.ps1`. Details: `docs/SECRET_LEAK_VECTORS.md` (table B). To inspect `.mcp.json` structure, read this doc's redacted example instead of the file.

---

## Troubleshooting

**Claude Code doesn't see discord tools after restart**
- Check `/mcp` output for error messages, or the connect log: `%LOCALAPPDATA%\claude-cli-nodejs\Cache\<project>\mcp-logs-discord\*.jsonl` (look for `Successfully connected ... in Nms`)
- Re-run `pwsh -File scripts/setup-discord-mcp.ps1` — step 6 smoke-tests the handshake
- Verify Node.js is on PATH: `node --version`
- `.mcp.json` still says `cmd /c npx -y mcp-discord`? That is the old setup that timed out; re-run the setup script

**`plugin:discord:discord` fails with `Connection closed`**
- That is the unused Discord channel plugin (needs Bun). Disable it: `claude plugin disable discord@claude-plugins-official` (the setup script does this)

**Tool call returns `DISCORD_TOKEN is not set`**
- The User env var is missing on this PC. Run `pwsh -File scripts/setup-discord-mcp.ps1 -SyncTokenFromInfisical`, then restart Claude Code (it reads env vars at launch)

**Discord API returns 401 Unauthorized**
- Token expired or rotated — run `pwsh -File scripts/setup-discord-mcp.ps1 -SyncTokenFromInfisical` and restart Claude Code/Codex. Do not put the value in `.mcp.json`.

**Discord API returns 403 Missing Access (50001)**
- Bot lacks the permission for that operation in that channel/thread
- Most common: `MANAGE_THREADS` for archive operations
- Fix: grant in Server Settings → Roles → bot role

**`gh issue create` returns 504 Gateway Timeout**
- Transient GitHub error. The batch script retries up to 3 times automatically.
- Manual: just rerun. The previous attempt usually didn't create an issue (verify with `gh issue list`).

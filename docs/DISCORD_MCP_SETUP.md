# Discord MCP Setup — Quick Guide

How to recreate the Discord-GitHub feedback bridge on a new PC.

The bridge reads Discord threads from `#bug-reports` and `#feature-request` (and other channels) and creates GitHub issues with embedded screenshots, via:
- `mcp-discord` (community MCP server, npm `mcp-discord`) — read access to Discord
- Direct Discord REST API calls — for capabilities mcp-discord doesn't expose (attachment URLs, thread archive, active-thread listing)
- `gh` CLI — issue creation (MCP write returns 403 until claude.ai-connector reconnects)

---

## Prerequisites

- Node.js installed (for `npx` and the helper scripts)
- `gh` CLI installed and authenticated (`gh auth status` shows logged in)
- Discord bot already created at https://discord.com/developers/applications
  - Bot: **"Cycling Zone#8784"** (id: `1500376268825301033`)
  - Server: **"Cycling Career"** (id: `474142653529849886`)
- Bot token — inject through Infisical or the local parent process environment as `DISCORD_TOKEN`. Do not write it into `.mcp.json`.
- Bot already invited to the server with permissions:
  - ✅ View Channels
  - ✅ Read Message History
  - ✅ Send Messages (used by production backend for DM notifications)
  - ⚠️ Manage Threads (NOT yet granted — needed for auto-archiving via API; otherwise you must close threads manually in Discord client)
- Bot has **Message Content Intent** enabled (Discord Developer Portal → Bot → Privileged Gateway Intents)

---

## Quickstart — automatiseret (anbefalet)

Kør én kommando i en normal PowerShell — den skriver non-secret `.mcp.json` til main repo + alle worktrees:

```powershell
pwsh -File scripts/setup-discord-mcp.ps1
```

Scriptet:
1. Verificerer Node/npm
2. Advarer hvis `DISCORD_TOKEN` ikke er tilgængelig i den aktuelle shell
3. Skriver `.mcp.json` (gitignored, uden inline secrets) i main repo og hver eksisterende worktree
4. Sikrer at `.claude/settings.local.json` har `enabledMcpjsonServers: ["discord"]`

Efter scriptet: sørg for at `DISCORD_TOKEN` injectes via Infisical eller user-env, og **genstart Claude Code/Codex** (MCP loades kun ved opstart). Verificér med `/mcp` — `discord` skal stå som connected.

---

## Manuel setup (fallback)

Hvis scriptet ikke virker — eller du foretrækker manuelt:

### 1. Create `.mcp.json` in repo root

This file is **gitignored** on purpose but must not contain secrets. It must exist on each machine.

```json
{
  "mcpServers": {
    "discord": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "mcp-discord"]
    }
  }
}
```

**On macOS/Linux**, swap the Windows-specific command:
```json
"command": "npx",
"args": ["-y", "mcp-discord"]
```

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
- Or ask: "list Discord servers" / "log in to Discord" — should respond with bot identity

---

## Tools available via mcp-discord

Read-only (used by the bridge):
- `discord_login` — confirms bot identity
- `discord_get_server_info` — lists channels in a guild
- `discord_read_messages` — reads up to 100 messages from a channel/thread
- `discord_get_forum_post` — for forum-style threads (we don't use forums)

Write (use sparingly, requires user-confirmation):
- `discord_send` — post a message
- `discord_add_reaction`, `discord_create_text_channel`, etc.

---

## What mcp-discord can NOT do (and the workarounds)

| Limitation | Workaround |
|---|---|
| `discord_read_messages` returns `attachments` count, **not URLs** | Use Discord REST `GET /channels/{id}/messages?limit=20` directly — see `scripts/sync-discord-attachments.js` |
| No "list guilds" tool | User provides guild ID manually (right-click server icon → Copy Server ID; requires User Settings → Advanced → Developer Mode ON) |
| No "list active threads" tool | Use Discord REST `GET /guilds/{id}/threads/active` directly |
| No archive/close-thread tool | PATCH `/channels/{thread_id}` with `{"archived": true, "locked": false}`. **Requires `MANAGE_THREADS` permission** for other users' threads — otherwise `50001 Missing Access` |
| Bot has no concept of which threads are archived | Use the active-threads endpoint (above) to filter |

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

- **`.mcp.json` is local config, not a secret store:** gitignored (`.gitignore:27`) and must contain no token values. Use `.mcp.example.json` as the template.
- **Token rotation required after transcript exposure:** Discord Developer Portal → Bot → Reset Token, update Infisical/user-env `DISCORD_TOKEN`, restart Claude Code/Codex, verify with `/mcp`. Old token keeps working until reset.
- The Supabase service key was also briefly exposed in a tool result. **Rotate too:** Supabase Dashboard → Settings → API → "Reset service_role key", then update Railway `SUPABASE_SERVICE_KEY`.
- **✅ Read/Grep leak-vector closed (2026-05-29, #634 follow-up):** agents can no longer Read/Grep this file (or any `*.env` / `*/secrets/*`) — `block-dangerous-secret-commands.sh` blocks it (exit 2), and the PostToolUse sanitizer now also covers `Read`/`Grep` output as backup. Verified live + in `scripts/test-sanitize-secrets.ps1`. Details: `docs/SECRET_LEAK_VECTORS.md` (table B). To inspect `.mcp.json` structure, read this doc's redacted example instead of the file.

---

## Troubleshooting

**Claude Code doesn't see discord tools after restart**
- Check `/mcp` output for error messages
- Verify Node.js is on PATH: `node --version`
- Try running mcp-discord manually: `npx -y mcp-discord` — should hang waiting for stdin (that's correct)
- On Windows: ensure `command: "cmd"` and `args: ["/c", "npx", ...]` (not just `"npx"`)

**Discord API returns 401 Unauthorized**
- Token expired or rotated — inject a fresh `DISCORD_TOKEN` via Infisical/user-env and restart Claude Code/Codex. Do not put the value in `.mcp.json`.

**Discord API returns 403 Missing Access (50001)**
- Bot lacks the permission for that operation in that channel/thread
- Most common: `MANAGE_THREADS` for archive operations
- Fix: grant in Server Settings → Roles → bot role

**`gh issue create` returns 504 Gateway Timeout**
- Transient GitHub error. The batch script retries up to 3 times automatically.
- Manual: just rerun. The previous attempt usually didn't create an issue (verify with `gh issue list`).

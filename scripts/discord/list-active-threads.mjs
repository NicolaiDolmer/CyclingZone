#!/usr/bin/env node
/**
 * List active (non-archived) threads in the Discord guild + a snippet of each
 * thread's opening message, so we can triage Discord feedback into GitHub issues.
 *
 * Fills the gap noted in docs/DISCORD_MCP_SETUP.md: mcp-discord has no
 * "list active threads" tool — use REST `GET /guilds/{id}/threads/active`.
 *
 * The bot token is read from DISCORD_TOKEN/DISCORD_BOT_TOKEN env and is NEVER
 * printed. Output is thread metadata + message snippets only.
 *
 * Usage:  node scripts/discord/list-active-threads.mjs
 */
const GUILD = '474142653529849886'; // "Cycling Career"
const API = 'https://discord.com/api/v10';

function readToken() {
  return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null;
}

async function dapi(token, pathPart) {
  const res = await fetch(`${API}${pathPart}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} on ${pathPart} :: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function snip(s, n = 280) {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim().slice(0, n);
}

async function main() {
  const token = readToken();
  if (!token) {
    console.error('NO_TOKEN: set DISCORD_TOKEN via Infisical or parent process environment.');
    process.exit(3);
  }

  // 1) channel name lookup
  const channels = await dapi(token, `/guilds/${GUILD}/channels`);
  const chanName = new Map(channels.map((c) => [c.id, c.name]));

  // 2) active threads (covers forum posts + text-channel threads)
  const active = await dapi(token, `/guilds/${GUILD}/threads/active`);
  const threads = (active.threads || []).slice();

  // sort newest-activity first via thread id (snowflake ~ time)
  threads.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

  console.log(`ACTIVE_THREADS: ${threads.length}\n`);

  for (const t of threads) {
    const parent = chanName.get(t.parent_id) || t.parent_id;
    let opener = '';
    let author = '';
    let ts = '';
    let count = t.message_count ?? '?';
    try {
      // oldest message in thread = the opening post (limit 1, after=0)
      const msgs = await dapi(token, `/channels/${t.id}/messages?after=0&limit=1`);
      if (msgs.length) {
        opener = snip(msgs[0].content);
        author = msgs[0].author?.username || '';
        ts = (msgs[0].timestamp || '').slice(0, 10);
      }
    } catch (e) {
      opener = `(could not read messages: ${e.message})`;
    }
    console.log(`#${t.id}  [${parent}]  msgs=${count}  ${ts}  @${author}`);
    console.log(`  title: ${t.name}`);
    if (opener) console.log(`  open:  ${opener}`);
    console.log('');
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});

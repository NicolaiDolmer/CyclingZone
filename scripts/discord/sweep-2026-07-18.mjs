#!/usr/bin/env node
/**
 * READ-ONLY sweep of "Cycling Zone" guild since 2026-07-17 midday sweep.
 * Forum threads (#feedback-and-ideas, #bugs): dumps OP + all messages for
 * threads with activity since cutoff. Skips text channels (read via MCP i dag).
 *
 * Token from DISCORD_TOKEN/DISCORD_BOT_TOKEN env; never printed.
 * Output: scripts/discord/.sweep-2026-07-18.md
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const GUILD = '1504615050831466669';
const SINCE_ISO = '2026-07-17T10:00:00';
const OUT = path.join(process.cwd(), 'scripts', 'discord', '.sweep-2026-07-18.md');
const FORUMS = [
  { id: '1505952827615481927', name: 'feedback-and-ideas' },
  { id: '1505952830811541585', name: 'bugs' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readToken() { return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null; }

function snowflakeTs(id) {
  return new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString();
}

async function dapi(token, p, { okEmpty = false } = {}) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    await sleep(Math.ceil((body.retry_after || 1) * 1000) + 250);
    return dapi(token, p, { okEmpty });
  }
  if (!res.ok) { if (okEmpty) return null; throw new Error(`${res.status} on ${p}`); }
  return res.json();
}

function fmtMsg(m) {
  const author = m.author?.bot ? `${m.author.username} [BOT]` : (m.author?.username || '?');
  const ts = (m.timestamp || '').slice(0, 16).replace('T', ' ');
  const content = (m.content || '').trim();
  let s = `**@${author}** (${ts} UTC):\n${content || '_(ingen tekst)_'}\n`;
  for (const a of (m.attachments || [])) {
    s += `  [BILLEDE: ${a.filename} ${a.width || ''}x${a.height || ''} ${a.url}]\n`;
  }
  const embeds = (m.embeds || []).map((e) => [e.title, e.description].filter(Boolean).join(' — ')).filter(Boolean);
  for (const e of embeds) s += `  [EMBED: ${e.slice(0, 400)}]\n`;
  return s + '\n';
}

async function dumpThread(token, t) {
  const msgs = await dapi(token, `/channels/${t.id}/messages?limit=100`, { okEmpty: true });
  if (!msgs) return `## TRÅD: ${t.name} (${t.id}) — kunne ikke læses\n\n`;
  msgs.reverse();
  let out = `## TRÅD: ${t.name}\nthread: ${t.id} · created: ${snowflakeTs(t.id).slice(0, 16).replace('T', ' ')} UTC\n\n`;
  for (const m of msgs) out += fmtMsg(m);
  return out + '\n';
}

async function main() {
  const token = readToken();
  if (!token) { console.error('No DISCORD_TOKEN/DISCORD_BOT_TOKEN in env'); process.exit(1); }
  const since = new Date(SINCE_ISO + 'Z').getTime();
  let out = `# Discord forum-sweep 2026-07-18 — siden ${SINCE_ISO}Z\n\n`;

  const active = await dapi(token, `/guilds/${GUILD}/threads/active`);
  const activeThreads = active?.threads || [];

  for (const forum of FORUMS) {
    out += `# FORUM: #${forum.name} (${forum.id})\n\n`;
    const archived = await dapi(token, `/channels/${forum.id}/threads/archived/public?limit=50`, { okEmpty: true });
    const all = [
      ...activeThreads.filter((t) => t.parent_id === forum.id),
      ...((archived?.threads) || []),
    ];
    const seen = new Set();
    let any = false;
    for (const t of all) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const lastId = t.last_message_id || t.id;
      const lastTs = new Date(snowflakeTs(lastId)).getTime();
      if (lastTs < since) continue;
      any = true;
      out += await dumpThread(token, t);
      await sleep(300);
    }
    if (!any) out += '_(ingen tråde med aktivitet siden cutoff)_\n\n';
  }

  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`Wrote ${OUT} (${out.length} chars)`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

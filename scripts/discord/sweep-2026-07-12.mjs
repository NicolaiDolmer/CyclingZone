#!/usr/bin/env node
/**
 * READ-ONLY sweep of "Cycling Zone" guild since last full sweep (2026-07-04).
 * Dumps ALL threads (active + archived) in the two forum channels
 * (#feedback-and-ideas, #bugs) with full message content, plus recent
 * messages (since cutoff) in the other text channels.
 *
 * Token from DISCORD_TOKEN/DISCORD_BOT_TOKEN env; never printed.
 * Output: scripts/discord/.sweep-2026-07-12.md
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const GUILD = '1504615050831466669';
const SINCE_ISO = '2026-07-04T00:00:00';
const OUT = path.join(process.cwd(), 'scripts', 'discord', '.sweep-2026-07-12.md');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readToken() { return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null; }

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
    s += `  [BILLEDE: ${a.filename} ${a.width || ''}x${a.height || ''}]\n`;
  }
  const embeds = (m.embeds || []).map((e) => [e.title, e.description].filter(Boolean).join(' — ')).filter(Boolean);
  for (const e of embeds) s += `  [EMBED: ${e.slice(0, 400)}]\n`;
  return s + '\n';
}

async function dumpThread(token, id, label, createdAt) {
  let out = `\n---\n\n## ${label}\nthread: ${id}${createdAt ? ` · created: ${createdAt}` : ''}\n\n`;
  try {
    const msgs = (await dapi(token, `/channels/${id}/messages?limit=100`)).reverse();
    for (const m of msgs) out += fmtMsg(m);
  } catch (e) { out += `_(read error: ${e.message})_\n`; }
  return out;
}

async function dumpForum(token, channelId, label) {
  let out = `\n\n# FORUM: ${label} (${channelId})\n`;
  const found = new Map();
  const active = await dapi(token, `/guilds/${GUILD}/threads/active`);
  for (const t of (active.threads || [])) {
    if (t.parent_id === channelId) found.set(t.id, t);
  }
  let before;
  for (let page = 0; page < 15; page++) {
    const q = `/channels/${channelId}/threads/archived/public?limit=100${before ? `&before=${before}` : ''}`;
    const archived = await dapi(token, q, { okEmpty: true });
    await sleep(300);
    if (!archived || !(archived.threads || []).length) break;
    for (const t of archived.threads) found.set(t.id, t);
    if (!archived.has_more) break;
    before = archived.threads[archived.threads.length - 1].thread_metadata?.archive_timestamp;
    if (!before) break;
  }
  const all = [...found.values()];
  out += `Total threads found: ${all.length}\n`;
  const ids = all.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
  for (const t of ids) {
    const archived = t.thread_metadata?.archived ? ' [ARKIVERET]' : ' [AKTIV]';
    out += await dumpThread(token, t.id, `TRÅD${archived}: ${t.name}`);
    await sleep(300);
  }
  return out;
}

const OTHER_CHANNELS = [
  ['1505952830811541585', '#bugs (id used in pinned msg, cross-check)'],
];

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }

  const channels = await dapi(token, `/guilds/${GUILD}/channels`);
  const byName = new Map(channels.map((c) => [c.name, c]));

  let out = `# Discord sweep 2026-07-12 — "Cycling Zone" (${GUILD})\nSince: ${SINCE_ISO}\n\n`;

  const feedback = byName.get('feedback-and-ideas');
  const bugs = byName.get('bugs');
  if (feedback) out += await dumpForum(token, feedback.id, '#feedback-and-ideas');
  if (bugs) out += await dumpForum(token, bugs.id, '#bugs');

  const textTargets = ['general', 'questions-and-answers', 'strategy-and-tips', 'team-showcase', 'transferlist', 'dansk-snak', 'dansk-strategi', 'staff-chat'];
  out += `\n\n# Text channels (recent messages since ${SINCE_ISO})\n`;
  for (const name of textTargets) {
    const c = byName.get(name);
    if (!c) { out += `\n### #${name}\n(kanal ikke fundet)\n`; continue; }
    out += `\n### #${name}\n`;
    try {
      const msgs = (await dapi(token, `/channels/${c.id}/messages?limit=100`, { okEmpty: true })) || [];
      const recent = msgs.filter((m) => (m.timestamp || '') >= SINCE_ISO).reverse();
      out += recent.length ? recent.map(fmtMsg).join('') : '_(ingen nye beskeder)_\n';
    } catch (e) { out += `_(read error: ${e.message})_\n`; }
    await sleep(300);
  }

  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`WROTE ${OUT} (${out.length} chars)`);
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

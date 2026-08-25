#!/usr/bin/env node
/**
 * Laes de sidste 10 dage fra én kanal (ejer-udpeget). Token fra
 * DISCORD_TOKEN/DISCORD_BOT_TOKEN; aldrig printet. Attachment-URLs printes IKKE.
 * Output: scripts/discord/.feedback-dump-2026-08-25.md
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const CHANNEL = process.env.CZ_CHANNEL_ID || '1522915781766283296';
const SINCE = process.env.CZ_SINCE || '2026-08-15T00:00:00.000Z';
const OUT = path.join(process.cwd(), 'scripts', 'discord', '.feedback-dump-2026-08-25.md');

const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!token) { console.error('NO_TOKEN'); process.exit(3); }

async function dapi(p) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) throw new Error(`${res.status} on ${p.split('?')[0]}`);
  return res.json();
}

const collected = [];
let before = '';
for (let page = 0; page < 10; page++) {
  const q = `/channels/${CHANNEL}/messages?limit=100${before ? `&before=${before}` : ''}`;
  const msgs = await dapi(q);
  if (!msgs.length) break;
  collected.push(...msgs);
  before = msgs[msgs.length - 1].id;
  if ((msgs[msgs.length - 1].timestamp || '') < SINCE) break;
}

const recent = collected
  .filter((m) => (m.timestamp || '') >= SINCE)
  .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

let out = `# Kanal-dump ${CHANNEL} — siden ${SINCE.slice(0, 10)}\n\n`;
for (const m of recent) {
  const who = m.author?.username || m.author?.id || '?';
  const att = (m.attachments || []).map((a) => `[vedhaeft: ${a.filename}]`).join(' ');
  const emb = (m.embeds || []).length ? `[${m.embeds.length} embed]` : '';
  const content = (m.content || '').trim();
  out += `**${who}** ${m.timestamp}\n${content}${att ? `\n${att}` : ''}${emb ? `\n${emb}` : ''}\n\n`;
}
out += `\n_${recent.length} beskeder._\n`;
fs.writeFileSync(OUT, out, 'utf8');
console.log(`OK ${recent.length} beskeder -> ${OUT}`);

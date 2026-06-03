#!/usr/bin/env node
/**
 * Read recent messages from a set of plain text channels (NOT threads), so we can
 * propose GitHub issues from feedback posted directly in those channels.
 * Token from DISCORD_TOKEN/DISCORD_BOT_TOKEN env; never printed. Attachment URLs
 * are NOT printed (only filename/id) to avoid the sanitize-hook high-entropy block.
 *
 * Output: scripts/discord/.channel-dump.md
 */
import fs from 'node:fs';
import path from 'node:path';

const GUILD = '474142653529849886';
const API = 'https://discord.com/api/v10';
const DISCORD_DIR = path.join(process.cwd(), 'scripts', 'discord');

// last 14 days from 2026-06-03 → since 2026-05-20T00:00:00Z
const SINCE = '2026-05-20T00:00:00.000Z';

const CHANNELS = [
  '1386713292491194458',
  '1504045892137779321',
  '1387129538315554867',
];

function readToken() {
  return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null;
}

async function dapi(token, p) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) throw new Error(`${res.status} on ${p}`);
  return res.json();
}

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }

  const channels = await dapi(token, `/guilds/${GUILD}/channels`);
  const chanName = new Map(channels.map((c) => [c.id, c.name]));

  let out = `# Channel dump — last 14 days (since ${SINCE.slice(0, 10)})\n\n`;
  for (const cid of CHANNELS) {
    const name = chanName.get(cid) || '(unknown channel)';
    out += `\n---\n\n## #${name}  (${cid})\n\n`;
    try {
      // page back until we pass SINCE (max 5 pages of 100 = 500 msgs)
      const collected = [];
      let before = '';
      for (let page = 0; page < 5; page++) {
        const q = `/channels/${cid}/messages?limit=100${before ? `&before=${before}` : ''}`;
        const msgs = await dapi(token, q);
        if (!msgs.length) break;
        collected.push(...msgs);
        before = msgs[msgs.length - 1].id;
        const oldest = msgs[msgs.length - 1].timestamp || '';
        if (oldest < SINCE) break;
      }
      const recent = collected
        .filter((m) => (m.timestamp || '') >= SINCE)
        .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
      out += `_messages in window: ${recent.length} (fetched ${collected.length})_\n\n`;
      for (const m of recent) {
        const ts = (m.timestamp || '').slice(0, 16).replace('T', ' ');
        const author = m.author?.username || '?';
        const content = (m.content || '').trim();
        out += `**@${author}** (${ts}):\n${content || '_(ingen tekst)_'}\n`;
        if (m.attachments && m.attachments.length) {
          for (const a of m.attachments) {
            out += `  [BILLEDE: ${a.filename} ${a.width || ''}x${a.height || ''} — id=${a.id}]\n`;
          }
        }
        out += `\n`;
      }
    } catch (e) {
      out += `_(read error: ${e.message})_\n`;
    }
  }

  fs.mkdirSync(DISCORD_DIR, { recursive: true });
  fs.writeFileSync(path.join(DISCORD_DIR, '.channel-dump.md'), out);
  console.error(`DONE channels=${CHANNELS.length} bytes=${out.length}`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

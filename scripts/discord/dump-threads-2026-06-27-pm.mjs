#!/usr/bin/env node
/**
 * Sweep 2026-06-27 PM — 3 eksplicit udpegede kanaler (ejer-anmodning).
 * Identificér ukendt kanal 1389612026632077353 + bredere vindue for at finde
 * opgaver Claude selv vurderer bør laves. Token fra env; aldrig printet.
 * Output: scripts/discord/.new-threads-2026-06-27-pm.md
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const GUILD = '474142653529849886';
const CHANNELS = [
  '1387129538315554867',
  '1389612026632077353',
  '1386713292491194458',
];
const SINCE_ISO = '2026-06-24T00:00:00'; // bredere vindue end forrige sweep

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
  let s = `**@${author}** (${ts}):\n${content || '_(ingen tekst)_'}\n`;
  for (const a of (m.attachments || [])) s += `  [BILLEDE: ${a.filename} ${a.width || ''}x${a.height || ''}]\n`;
  const embeds = (m.embeds || []).map((e) => [e.title, e.description].filter(Boolean).join(' — ')).filter(Boolean);
  for (const e of embeds) s += `  [EMBED: ${e.slice(0, 300)}]\n`;
  return s + '\n';
}

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }
  const channels = await dapi(token, `/guilds/${GUILD}/channels`);
  const chanName = new Map(channels.map((c) => [c.id, c.name]));

  let out = `# Discord-sweep 2026-06-27 PM — 3 kanaler, siden ${SINCE_ISO}\n\n`;
  for (const chId of CHANNELS) {
    const label = chanName.get(chId) ? `#${chanName.get(chId)}` : `(ukendt ${chId})`;
    out += `\n=======================================================\n## ${label}  [${chId}]\n=======================================================\n\n`;
    try {
      const msgs = (await dapi(token, `/channels/${chId}/messages?limit=100`)).reverse();
      const recent = msgs.filter((m) => (m.timestamp || '') >= SINCE_ISO);
      if (!recent.length) out += '_(ingen beskeder i vinduet)_\n';
      for (const m of recent) out += fmtMsg(m);
    } catch (e) { out += `_(read error: ${e.message})_\n`; }
    await sleep(300);
  }
  const file = path.join(process.cwd(), 'scripts', 'discord', '.new-threads-2026-06-27-pm.md');
  fs.writeFileSync(file, out, 'utf8');
  console.error(`DONE bytes=${out.length}`);
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

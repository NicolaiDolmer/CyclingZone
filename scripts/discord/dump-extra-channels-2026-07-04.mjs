#!/usr/bin/env node
/**
 * FINAL sweep tillæg: 3 kanaler der ikke indgår i det faste daglige delta-sæt
 * (next-step-cz, auktioner, hjælp-jeg-hoster) — tjekkes én gang grundigt før
 * vi lukker "Cycling Career"-guilden ned som kilde.
 * Token fra env; aldrig printet. Output: scripts/discord/.extra-channels-2026-07-04.md
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const CHANNELS = [
  ['1504045892137779321', '#next-step-cz'],
  ['1494297765423874109', '#auktioner'],
  ['1509151163025592410', '#hjælp-jeg-hoster'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readToken() { return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null; }

async function dapi(token, p) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    await sleep(Math.ceil((body.retry_after || 1) * 1000) + 250);
    return dapi(token, p);
  }
  if (!res.ok) throw new Error(`${res.status} on ${p}`);
  return res.json();
}

function fmtMsg(m) {
  const author = m.author?.bot ? `${m.author.username} [BOT]` : (m.author?.username || '?');
  const ts = (m.timestamp || '').slice(0, 16).replace('T', ' ');
  const content = (m.content || '').trim();
  let s = `**@${author}** (${ts}):\n${content || '_(ingen tekst)_'}\n`;
  for (const a of (m.attachments || [])) s += `  [BILLEDE: ${a.filename}]\n`;
  return s + '\n';
}

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }
  let out = `# Ekstra kanaler — tjekket grundigt 2026-07-04 (sidste gennemlæsning)\n\n`;
  for (const [id, label] of CHANNELS) {
    out += `\n---\n\n## KANAL: ${label} (${id}) — seneste 100\n\n`;
    try {
      const msgs = (await dapi(token, `/channels/${id}/messages?limit=100`)).reverse();
      out += msgs.length ? msgs.map(fmtMsg).join('') : '_(tom)_\n';
    } catch (e) { out += `_(read error: ${e.message})_\n`; }
  }
  const OUT = path.join(process.cwd(), 'scripts', 'discord', '.extra-channels-2026-07-04.md');
  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`WROTE ${OUT} (${out.length} chars)`);
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

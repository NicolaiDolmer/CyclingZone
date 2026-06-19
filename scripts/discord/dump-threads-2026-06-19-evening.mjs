#!/usr/bin/env node
/**
 * Dump full content of the 7 NEW feedback threads created on 2026-06-19 evening
 * (@bobby2106), all newer than cutoff thread 1517456336353361980 (09:09).
 * Token from env; never printed. Output: scripts/discord/.new-threads-2026-06-19-evening.md
 */
import fs from 'node:fs';
import path from 'node:path';
const API = 'https://discord.com/api/v10';
const THREADS = [
  ['1517540295007277056', 'Skader mere synligt'],
  ['1517539765602484387', 'Indberetning af resultater (PCM ud)'],
  ['1517538882038665327', 'Træningsrapporter'],
  ['1517537218619641996', 'Ændringer på managerprofilen'],
  ['1517536976650113094', 'Race engine - afvikl enkelt etape'],
  ['1517536840146485258', 'Ændringer til dashboard'],
  ['1517536518435115200', 'Rytterside, fejl i sortering'],
];
function readToken() { return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null; }
async function dapi(token, p) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) throw new Error(`${res.status} on ${p}`);
  return res.json();
}
async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }
  let out = `# Aften-feedback-tråde 2026-06-19 (@bobby2106) — nye siden 09:09-sweep\n\n`;
  for (const [id, label] of THREADS) {
    out += `\n---\n\n## ${label}\nthread: ${id}\n\n`;
    try {
      const msgs = (await dapi(token, `/channels/${id}/messages?limit=50`)).reverse();
      for (const m of msgs) {
        const ts = (m.timestamp || '').slice(0, 16).replace('T', ' ');
        const author = m.author?.username || '?';
        const content = (m.content || '').trim();
        out += `**@${author}** (${ts}):\n${content || '_(ingen tekst)_'}\n`;
        if (m.attachments && m.attachments.length) {
          for (const a of m.attachments) {
            out += `  [BILLEDE: ${a.filename} ${a.width||''}x${a.height||''} — id=${a.id}]\n`;
          }
        }
        out += `\n`;
      }
    } catch (e) { out += `_(read error: ${e.message})_\n`; }
  }
  fs.writeFileSync(path.join(process.cwd(),'scripts','discord','.new-threads-2026-06-19-evening.md'), out);
  console.error(`DONE threads=${THREADS.length} bytes=${out.length}`);
}
main().catch((e)=>{console.error('ERROR:',e.message);process.exit(1);});

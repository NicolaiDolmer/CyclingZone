#!/usr/bin/env node
/**
 * Dump full content of NEW feedback threads created 2026-06-21 evening,
 * all newer than cutoff thread 1518285801010626621 (2026-06-21 16:05).
 * Token from env; never printed. Output: scripts/discord/.new-threads-2026-06-21-evening.md
 */
import fs from 'node:fs';
import path from 'node:path';
const API = 'https://discord.com/api/v10';
const THREADS = [
  ['1518341550285918378', 'Grammatik på landingssiden - Engelsk (@jeppek)'],
  ['1518341244332540075', 'Landing space feedback (@cybersimon)'],
  ['1518325176771674113', 'Auktion afsluttet (@bobby2106)'],
  ['1518295586112143451', 'Fejl angående auktion (@bobby2106)'],
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
  let out = `# Feedback-tråde 2026-06-21 aften — nye siden 2026-06-21-sweep (cutoff 1518285801010626621)\n\n`;
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
  fs.writeFileSync(path.join(process.cwd(),'scripts','discord','.new-threads-2026-06-21-evening.md'), out);
  console.error(`DONE threads=${THREADS.length} bytes=${out.length}`);
}
main().catch((e)=>{console.error('ERROR:',e.message);process.exit(1);});

#!/usr/bin/env node
/**
 * Dump full content of the NEW feedback threads created 2026-06-20..2026-06-21,
 * all newer than cutoff thread 1517540295007277056 (2026-06-19 14:43).
 * Token from env; never printed. Output: scripts/discord/.new-threads-2026-06-21.md
 */
import fs from 'node:fs';
import path from 'node:path';
const API = 'https://discord.com/api/v10';
const THREADS = [
  ['1518285801010626621', 'Sortering under auktions siden (@cybersimon)'],
  ['1518278317961379850', 'Fejl i skader (@bobby2106)'],
  ['1518264210998693888', 'Ryttere uden stats (@jeppek)'],
  ['1518261092818747533', 'Rytteroverblikket skal kunne vise alder (@bobby2106)'],
  ['1518260174534480004', 'Ryttertyper (@bobby2106)'],
  ['1518258763738644541', 'Transferlisten bredere (@jeppek)'],
  ['1518258590643654807', 'Etape resultater - filtrer paa hold (@bobby2106)'],
  ['1518258228771684585', 'Etaperesultater - top 10 klassement+ungdom (@bobby2106)'],
  ['1518257724696170566', 'Bjergtroeje og pointtroeje (@bobby2106)'],
  ['1518254948859645993', 'Skal fikses inden start (@bobby2106)'],
  ['1517805710140768296', 'Andre managers holdside bredere (@bobby2106)'],
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
  let out = `# Feedback-tråde 2026-06-20..21 — nye siden 2026-06-19-evening-sweep\n\n`;
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
  fs.writeFileSync(path.join(process.cwd(),'scripts','discord','.new-threads-2026-06-21.md'), out);
  console.error(`DONE threads=${THREADS.length} bytes=${out.length}`);
}
main().catch((e)=>{console.error('ERROR:',e.message);process.exit(1);});

#!/usr/bin/env node
/**
 * Dump full content of NEW feedback threads (since batch 9, 2026-06-03).
 * Token from DISCORD_TOKEN/DISCORD_BOT_TOKEN env; never printed.
 * Output: scripts/discord/.new-threads.md
 */
import fs from 'node:fs';
import path from 'node:path';
const API = 'https://discord.com/api/v10';
const THREADS = [
  ['1512504377917833346', 'Forkert hold?'],
  ['1512448285124722749', 'Feedback Bestyrelse'],
  ['1512432688265564242', 'Byttehandel med rytter på auktion'],
  ['1512431876395237597', 'Advarsel med trupstørrelse'],
  ['1512395255058665634', 'Podier i ranglisten'],
  ['1512392284325412904', 'Fejl i rytterdatabase'],
  ['1512117590607134771', 'Autobudfunktion'],
  ['1512022257986310174', 'Værdisortering Liga->Hold->Trup broken'],
  ['1511982828462542918', 'Sortering på auktioner'],
  ['1511832852512247881', 'Sortering i auktion efter tid'],
  ['1511803871062655048', 'Fremtidig indtægt'],
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
  let out = `# New thread dump (since batch 9)\n\n`;
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
  fs.mkdirSync(path.join(process.cwd(),'scripts','discord'),{recursive:true});
  fs.writeFileSync(path.join(process.cwd(),'scripts','discord','.new-threads.md'), out);
  console.error(`DONE threads=${THREADS.length} bytes=${out.length}`);
}
main().catch((e)=>{console.error('ERROR:',e.message);process.exit(1);});

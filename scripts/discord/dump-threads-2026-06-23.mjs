#!/usr/bin/env node
/**
 * Dump full content of NEW feedback threads created since cutoff thread
 * 1518705388545900566 (2026-06-22 19:53). 10 threads, newest-first list.
 * Token from env; never printed. Output: scripts/discord/.new-threads-2026-06-23.md
 */
import fs from 'node:fs';
import path from 'node:path';
const API = 'https://discord.com/api/v10';
const THREADS = [
  ['1518740959020580955', 'Lukkede rytterauktion ikke gjort ordenligt (@cybersimon)'],
  ['1518738582670545069', 'Kommende kalender (@jeppek)'],
  ['1518734443706187786', 'Elendige ai holdnavne (@bobby2106)'],
  ['1518729450232086641', 'Transferhistorik (@jeppek)'],
  ['1518727362118942721', 'Tilbage funktionen i browseren under auktioner (@cybersimon)'],
  ['1518724858287099944', 'Sponsor deadline (@bobby2106)'],
  ['1518721239273963700', 'Forlængelse af ryttere med kontrakt over 2 sæsoner (@jeppek)'],
  ['1518719118172225616', 'Pension (@bobby2106)'],
  ['1518715659326849165', 'Fortsat brug af rigtige løbsnavne (@jeppek)'],
  ['1518712486902366391', 'Rytterprofil - bedste evne (@jeppek)'],
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
  let out = `# Feedback-tråde 2026-06-23 — nye siden cutoff 1518705388545900566 (2026-06-22 19:53)\n\n`;
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
  fs.writeFileSync(path.join(process.cwd(),'scripts','discord','.new-threads-2026-06-23.md'), out);
  console.error(`DONE threads=${THREADS.length} bytes=${out.length}`);
}
main().catch((e)=>{console.error('ERROR:',e.message);process.exit(1);});

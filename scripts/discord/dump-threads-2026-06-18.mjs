#!/usr/bin/env node
/**
 * Dump full content of NEW feedback threads since sweep 2026-06-10.
 * Token from DISCORD_TOKEN/DISCORD_BOT_TOKEN env; never printed.
 * Output: scripts/discord/.new-threads-2026-06-18.md
 */
import fs from 'node:fs';
import path from 'node:path';
const API = 'https://discord.com/api/v10';
const THREADS = [
  ['1517280989104312330', 'Der mangler status kollone'],
  ['1517277860858171445', 'Løbsresultater - Ruteprofiler'],
  ['1517277061163647088', 'Holdkonkurrence: Raceengine v_2'],
  ['1517271516947943676', 'Kontraktudløb'],
  ['1517271072708362361', 'Akademi ryttere man kan hente der er frie'],
  ['1517269419380703392', 'Akademi ryttere mangler ryttertyper'],
  ['1517268091371917433', 'Fejl i træning'],
  ['1517267239852707901', 'Fejl i speak'],
  ['1517266303348641822', 'Økonomi - Grafer'],
  ['1517265893120409730', 'Besked i indbakken'],
  ['1517265833485926400', 'Rytter transfer ind'],
  ['1517265529822511226', 'Start trupper'],
  ['1517264213372960819', 'Potentiale synlighed'],
  ['1517261369248977037', 'Ønskeliste reset'],
  ['1517259076017328208', 'Bestyrelse dashboard'],
  ['1517258451133268088', 'Trænings feedback'],
  ['1517258406065344662', 'Træning'],
  ['1517258018733953054', 'Ungdoms intake'],
  ['1515130328925208801', 'Glemt password funktion sender ikke mail'],
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
  let out = `# New thread dump (since sweep 2026-06-10)\n\n`;
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
  fs.writeFileSync(path.join(process.cwd(),'scripts','discord','.new-threads-2026-06-18.md'), out);
  console.error(`DONE threads=${THREADS.length} bytes=${out.length}`);
}
main().catch((e)=>{console.error('ERROR:',e.message);process.exit(1);});

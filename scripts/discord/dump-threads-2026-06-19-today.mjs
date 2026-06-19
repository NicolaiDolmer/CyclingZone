#!/usr/bin/env node
/**
 * Dump full content of the 11 feedback threads created TODAY 2026-06-19 (@jeppek).
 * Token from env; never printed. Output: scripts/discord/.new-threads-2026-06-19-today.md
 */
import fs from 'node:fs';
import path from 'node:path';
const API = 'https://discord.com/api/v10';
const THREADS = [
  ['1517456336353361980', 'Træning - akademiryttere'],
  ['1517455122790350898', 'Træthed'],
  ['1517454563450290236', 'Træning (synlighed + fordeling)'],
  ['1517450911667191828', 'Daglig træning - Grupper'],
  ['1517450207560859689', 'Transferlisten (rækker)'],
  ['1517449382037815409', 'Evner - alle sider med stats'],
  ['1517447328372494387', 'Akademihold - rytter (klikbar)'],
  ['1517446694562693161', 'Akademihold (flyt op/ned)'],
  ['1517446186645327892', 'Frie ungdomsryttere (pris)'],
  ['1517445834134782003', 'Akademiryttere fra Intake (ryttertype)'],
  ['1517443218881515681', 'Transferhistorik (akademiryttere)'],
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
  let out = `# Dagens feedback-tråde 2026-06-19 (@jeppek)\n\n`;
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
  fs.writeFileSync(path.join(process.cwd(),'scripts','discord','.new-threads-2026-06-19-today.md'), out);
  console.error(`DONE threads=${THREADS.length} bytes=${out.length}`);
}
main().catch((e)=>{console.error('ERROR:',e.message);process.exit(1);});

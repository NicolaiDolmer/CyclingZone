#!/usr/bin/env node
/**
 * Dump full content of NEW feedback threads created since cutoff thread
 * 1518347996545155162 (2026-06-21 20:12). 21 threads, newest-first list.
 * Token from env; never printed. Output: scripts/discord/.new-threads-2026-06-22.md
 */
import fs from 'node:fs';
import path from 'node:path';
const API = 'https://discord.com/api/v10';
const THREADS = [
  ['1518705388545900566', 'Bestyrelse - ungdomsryttere (@jeppek)'],
  ['1518705052833808576', 'Bestyrelse - engelsk (@jeppek)'],
  ['1518704676881567984', 'Bestyrelse - forkert DNA i forhandling (@jeppek)'],
  ['1518700204335960085', 'AI-hold fjernes ikke (@jeppek)'],
  ['1518698498457866300', 'Fejl i beskeder fra botten (@bobby2106)'],
  ['1518697437752070165', 'Sortere efter sælger (@cybersimon)'],
  ['1518695518241554582', 'Dårlig historik /forkert historik (@bobby2106)'],
  ['1518694302036001090', 'Fyr rytter (@jeppek)'],
  ['1518691479021948980', 'Frie ungdomsryttere (@jeppek)'],
  ['1518690920554299573', 'Intake-ryttere (@jeppek)'],
  ['1518688114011541756', 'Akademi intake (@bobby2106)'],
  ['1518674930248712232', 'Alder - Rytterdatabase (@jeppek)'],
  ['1518666553422385192', 'QoL trupskærm (@stephoslash)'],
  ['1518659436472696962', 'Køb af rytter i akademiet (@bobby2106)'],
  ['1518648834257981551', 'Division (@jeppek)'],
  ['1518638017605144727', 'Træning (@jeppek)'],
  ['1518509472299876431', 'Skift af email (@bobby2106)'],
  ['1518507834575425598', 'Holdudtagelse (@bobby2106)'],
  ['1518395940338274476', 'Transfer af rytter på auktion (@jeppek)'],
  ['1518391567184957551', 'Akademi - rytter allerede hentet (@jeppek)'],
  ['1518352582374854656', 'Founder supporter - Rettelser, engelsk (@jeppek)'],
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
  let out = `# Feedback-tråde 2026-06-22 — nye siden cutoff 1518347996545155162 (2026-06-21 20:12)\n\n`;
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
  fs.writeFileSync(path.join(process.cwd(),'scripts','discord','.new-threads-2026-06-22.md'), out);
  console.error(`DONE threads=${THREADS.length} bytes=${out.length}`);
}
main().catch((e)=>{console.error('ERROR:',e.message);process.exit(1);});

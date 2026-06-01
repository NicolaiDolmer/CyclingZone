#!/usr/bin/env node
/**
 * Dump full message content (all replies + attachment URLs) for a fixed list of
 * Discord thread IDs, so we can triage them into GitHub issues with full context.
 * Token read from DISCORD_TOKEN/DISCORD_BOT_TOKEN env; never printed.
 *
 * Output: scripts/discord/.thread-dump.md
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const DISCORD_DIR = path.join(process.cwd(), 'scripts', 'discord');

// 19 candidates in the 2026-05-16 → 2026-05-30 window (not already filed).
const THREADS = [
  ['1510273771901026375', 'Præmiepenge'],
  ['1510273057355464885', 'Sejre tælles forkert på ranglisten'],
  ['1510271780814585936', 'Transfertilbud udenfor transfervinduet'],
  ['1510269165255135263', 'Rangliste fejl (endagsløb vs samlet sejr)'],
  ['1510268423119310848', 'De kommende løb er slet ikke de kommende'],
  ['1510268058420383824', 'Dashboard fejl - Løb opdateres ikke'],
  ['1510266246116151436', 'Budhistorik virker ikke'],
  ['1510263255757754660', 'Knapper i rytterranglisten virker ikke'],
  ['1510242164226134236', 'Hall of Fame - kan kun se sig selv'],
  ['1507246935625433138', 'Dobbelt rente på lån ved sæsonskift'],
  ['1507078529282605106', 'AI-ryttere ikke frie agenter ved filter'],
  ['1507075204008906822', 'Flash Auktion på egne ryttere'],
  ['1507072644862972057', 'Garanteret salg 24t under deadline day'],
  ['1506925075876548690', 'Sæsonskifte - oprykninger ikke slået fra'],
  ['1506780095275204608', 'Transferliste med mange actions'],
  ['1506222527591088198', 'Forvirrende historik'],
  ['1506046994051891210', 'Rytter til salg, der ikke er til salg'],
  ['1505629552020291675', 'Mistede overskrifter (dashboard)'],
  ['1505613603217084487', 'Skifte sprog menue (scroll)'],
];

function readToken() {
  return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null;
}

async function dapi(token, p) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) throw new Error(`${res.status} on ${p}`);
  return res.json();
}

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }

  let out = `# Thread dump — 19 candidates (2026-05-16 → 2026-05-30)\n\n`;
  for (const [id, label] of THREADS) {
    out += `\n---\n\n## ${label}\nthread: ${id}\n\n`;
    try {
      // messages come newest-first; reverse to chronological
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
    } catch (e) {
      out += `_(read error: ${e.message})_\n`;
    }
  }

  fs.mkdirSync(DISCORD_DIR, { recursive: true });
  fs.writeFileSync(path.join(DISCORD_DIR, '.thread-dump.md'), out);
  console.error(`DONE threads=${THREADS.length} bytes=${out.length}`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

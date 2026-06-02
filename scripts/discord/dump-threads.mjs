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

// 20 NEW candidates from .candidates.md (2026-06-03 triage batch).
const THREADS = [
  ['1511472183971676231', 'Etapesejre og bestyrelsen'],
  ['1511441112815108157', 'Auktionsiden - fører opdateres ikke ved overbud'],
  ['1511433829343166486', 'Forkert prognose under økonomifanen'],
  ['1511432981330526278', 'Økonomisiden - rework'],
  ['1511432800585388083', 'Fejl i forecast - konkurs truet'],
  ['1511432754359832800', 'Sæson Preview farve problem'],
  ['1511427545323802704', 'Transferhistorik - sortering + fortegn'],
  ['1511426864961552577', 'Transferlisten - genvej'],
  ['1511423873978208346', 'Rettelser til udleje af ryttere'],
  ['1511413819728072907', 'Sæson snapshot fejl - graf'],
  ['1510407394851557538', '3-årsplan - hvordan beregner man top i division'],
  ['1506925075876548690', 'Sæsonskifte - oprykninger ikke slået fra'],
  ['1505629552020291675', 'Mistede overskrifter (dashboard)'],
  ['1504223818036805642', 'Navnesøgning på ryttere - mellemrum'],
  ['1502731709366538482', 'Min managerprofil viser forkert managernavn'],
  ['1502277902841155594', 'Vil du hjælpe med at teste? - Auktioner'],
  ['1502258493418246154', 'Managernavn er ændret men viser hold/brugernavn'],
  ['1501675887530217522', 'Kan ikke lukke onboarding-tingen'],
  ['1501508000039436338', 'Fans - Merchandise - Omdømme - Løb/land'],
  ['1501502756077178911', 'Gældsloft'],
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

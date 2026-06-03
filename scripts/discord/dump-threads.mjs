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

// 17 NEW candidates from .candidates.md (2026-06-03 triage batch 9).
const THREADS = [
  ['1511748952079339520', 'Ift farver af attributes'],
  ['1511737196435214376', 'Rute/Etape-profil under løbsoversigt'],
  ['1511735787408855230', 'Rating - sortér ryttere efter rating'],
  ['1511734208199000164', 'achievements - progress mod mål'],
  ['1511732272871772190', 'Skjul/vis stats knap'],
  ['1511698543931293748', 'Mobil - generel bug (bjælke følger med)'],
  ['1511659383694819421', 'Dashboard forbedringer - customize'],
  ['1511657603183415316', 'Rytterranglisten filter - vælg hold'],
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

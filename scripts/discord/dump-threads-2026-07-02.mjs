#!/usr/bin/env node
/**
 * Sweep 2026-07-02. Dumper siden sidste FILEDE cutoff (.file-issues-2026-06-30.mjs).
 * Højeste filede feedback-tråd = 1521410630261932135 (Race kalender, 2026-06-30 07:02).
 * Chat-kanaler: siden 2026-06-30T07:30 (hvor 06-30-dumpet sluttede).
 *
 * Kanaler (gamle guild "Cycling Career"):
 *  1) #samlet-feedback-features-og-bugs (parent 1501501095325732925) — nye tråde
 *  2) #cycling-zone / general (1386713292491194458)
 *  3) #spørgsmål-og-svar (1387129538315554867)
 *  4) #patch-notes (1389612026632077353) — kun for kontekst (ejer-udmeldinger)
 *
 * Token fra env; aldrig printet. Output: scripts/discord/.new-threads-2026-07-02.md
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const GUILD = '474142653529849886';
const FEEDBACK_PARENT = '1501501095325732925';
const CUTOFF_THREAD = 1521410630261932135n; // højeste filede 2026-06-30 07:02
const SINCE_ISO = '2026-06-30T07:30:00';
const OTHER_CHANNELS = [
  ['1386713292491194458', '#cycling-zone (general)'],
  ['1387129538315554867', '#spørgsmål-og-svar'],
  ['1389612026632077353', '#patch-notes (kontekst)'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readToken() { return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null; }

async function dapi(token, p, { okEmpty = false } = {}) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    await sleep(Math.ceil((body.retry_after || 1) * 1000) + 250);
    return dapi(token, p, { okEmpty });
  }
  if (!res.ok) { if (okEmpty) return null; throw new Error(`${res.status} on ${p}`); }
  return res.json();
}

function fmtMsg(m) {
  const author = m.author?.bot ? `${m.author.username} [BOT]` : (m.author?.username || '?');
  const ts = (m.timestamp || '').slice(0, 16).replace('T', ' ');
  const content = (m.content || '').trim();
  let s = `**@${author}** (${ts}):\n${content || '_(ingen tekst)_'}\n`;
  for (const a of (m.attachments || [])) {
    s += `  [BILLEDE: ${a.filename} ${a.width || ''}x${a.height || ''}]\n`;
  }
  const embeds = (m.embeds || []).map((e) => [e.title, e.description].filter(Boolean).join(' — ')).filter(Boolean);
  for (const e of embeds) s += `  [EMBED: ${e.slice(0, 400)}]\n`;
  return s + '\n';
}

async function dumpThread(token, id, label) {
  let out = `\n---\n\n## ${label}\nthread: ${id}\n\n`;
  try {
    const msgs = (await dapi(token, `/channels/${id}/messages?limit=50`)).reverse();
    for (const m of msgs) out += fmtMsg(m);
  } catch (e) { out += `_(read error: ${e.message})_\n`; }
  return out;
}

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }

  const found = new Map();
  const active = await dapi(token, `/guilds/${GUILD}/threads/active`);
  for (const t of (active.threads || [])) {
    if (t.parent_id === FEEDBACK_PARENT && BigInt(t.id) > CUTOFF_THREAD) found.set(t.id, t.name);
  }
  const archived = await dapi(token, `/channels/${FEEDBACK_PARENT}/threads/archived/public?limit=50`, { okEmpty: true });
  if (archived) for (const t of (archived.threads || [])) {
    if (BigInt(t.id) > CUTOFF_THREAD) found.set(t.id, t.name);
  }

  const ids = [...found.keys()].sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1));
  let out = `# Discord-sweep 2026-07-02 — siden FILED cutoff ${CUTOFF_THREAD} (2026-06-30 07:02)\n\n`;
  out += `Nye feedback-tråde: ${ids.length}\n`;

  for (const id of ids) out += await dumpThread(token, id, `TRÅD: ${found.get(id)}`);

  for (const [chId, label] of OTHER_CHANNELS) {
    out += `\n---\n\n## KANAL: ${label} (siden ${SINCE_ISO})\n\n`;
    try {
      const msgs = (await dapi(token, `/channels/${chId}/messages?limit=100`)).reverse();
      const recent = msgs.filter((m) => (m.timestamp || '') >= SINCE_ISO);
      out += recent.length ? recent.map(fmtMsg).join('') : '_(ingen nye beskeder)_\n';
    } catch (e) { out += `_(read error: ${e.message})_\n`; }
  }

  const OUT = path.join(process.cwd(), 'scripts', 'discord', '.new-threads-2026-07-02.md');
  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`WROTE ${OUT} (${out.length} chars, ${ids.length} nye tråde)`);
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

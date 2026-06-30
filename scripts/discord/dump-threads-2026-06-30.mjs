#!/usr/bin/env node
/**
 * Sweep 2026-06-30. Dumper siden sidste FILEDE cutoff (.file-issues-2026-06-27.mjs).
 * Højeste filede feedback-tråd = 1520421548576604350 (2026-06-27 13:32).
 * Chat-kanaler: siden 2026-06-27T20:00 (hvor 06-27-PM-dumpet sluttede).
 *
 * Kanaler:
 *  1) #samlet-feedback-features-og-bugs (parent 1501501095325732925) — nye tråde
 *  2) #cycling-zone / general (1386713292491194458)
 *  3) #spørgsmål-og-svar (1387129538315554867)
 *  4) #patch-notes (1389612026632077353) — kun for kontekst (ejer-udmeldinger)
 *
 * Token fra env; aldrig printet. Output: scripts/discord/.new-threads-2026-06-30.md
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const GUILD = '474142653529849886';
const FEEDBACK_PARENT = '1501501095325732925';
const CUTOFF_THREAD = 1520421548576604350n; // højeste filede 2026-06-27 13:32
const SINCE_ISO = '2026-06-27T20:00:00';
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
  let out = `# Discord-sweep 2026-06-30 — siden FILED cutoff ${CUTOFF_THREAD} (2026-06-27 13:32)\n\n`;
  out += `## NYE feedback-tråde i #samlet-feedback-features-og-bugs (${ids.length})\n`;
  for (const id of ids) out += `- ${id} — ${found.get(id)}\n`;

  for (const id of ids) {
    out += await dumpThread(token, id, found.get(id));
    await sleep(300);
  }

  for (const [chId, chLabel] of OTHER_CHANNELS) {
    out += `\n\n=======================================================\n## ${chLabel} — beskeder siden ${SINCE_ISO}\n=======================================================\n\n`;
    try {
      const msgs = (await dapi(token, `/channels/${chId}/messages?limit=100`)).reverse();
      const recent = msgs.filter((m) => (m.timestamp || '') >= SINCE_ISO);
      if (!recent.length) out += '_(ingen nye beskeder i vinduet)_\n';
      for (const m of recent) out += fmtMsg(m);
    } catch (e) { out += `_(read error: ${e.message})_\n`; }
    await sleep(300);
  }

  const file = path.join(process.cwd(), 'scripts', 'discord', '.new-threads-2026-06-30.md');
  fs.writeFileSync(file, out, 'utf8');
  console.error(`DONE feedback_threads=${ids.length} bytes=${out.length}`);
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

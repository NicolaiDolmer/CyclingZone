#!/usr/bin/env node
/**
 * FINAL sweep af "Cycling Career" (gammel guild, 474142653529849886) før vi
 * udelukkende bruger "Cycling Zone"-guilden fremover.
 *
 * Bredere end de daglige delta-dumps:
 *  1) Lister ALLE kanaler i guilden (til at fange evt. ulæste kanaler).
 *  2) Dumper ALLE aktive + arkiverede tråde under feedback-parent
 *     (1501501095325732925) — ikke kun nye siden sidste cutoff, for at fange
 *     noget der aldrig blev filet.
 *  3) Dumper de faste kanaler (general/spørgsmål-og-svar/patch-notes) siden
 *     sidste dump (2026-07-02T00:00:00, konservativt før 07-02-sweepets vindue).
 *
 * Token fra env; aldrig printet. Output: scripts/discord/.final-sweep-2026-07-04.md
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const GUILD = '474142653529849886';
const FEEDBACK_PARENT = '1501501095325732925';
const SINCE_ISO = '2026-07-02T00:00:00';
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
    const msgs = (await dapi(token, `/channels/${id}/messages?limit=100`)).reverse();
    for (const m of msgs) out += fmtMsg(m);
  } catch (e) { out += `_(read error: ${e.message})_\n`; }
  return out;
}

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }

  let out = `# FINAL Discord-sweep 2026-07-04 — Cycling Career (${GUILD})\n\n`;

  // 1) Full channel list
  const channels = await dapi(token, `/guilds/${GUILD}/channels`);
  out += `## Alle kanaler i guilden (${channels.length})\n\n`;
  for (const c of channels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    out += `- \`${c.id}\` [type=${c.type}] ${c.name}${c.parent_id ? ` (parent=${c.parent_id})` : ''}\n`;
  }

  // 2) ALL threads (active + archived) under feedback parent
  const found = new Map();
  const active = await dapi(token, `/guilds/${GUILD}/threads/active`);
  for (const t of (active.threads || [])) {
    if (t.parent_id === FEEDBACK_PARENT) found.set(t.id, { name: t.name, archived: false });
  }
  let before;
  for (let page = 0; page < 10; page++) {
    const q = `/channels/${FEEDBACK_PARENT}/threads/archived/public?limit=100${before ? `&before=${before}` : ''}`;
    const archived = await dapi(token, q, { okEmpty: true });
    if (!archived || !(archived.threads || []).length) break;
    for (const t of archived.threads) found.set(t.id, { name: t.name, archived: true });
    if (!archived.has_more) break;
    before = archived.threads[archived.threads.length - 1].thread_metadata?.archive_timestamp;
    if (!before) break;
  }

  const ids = [...found.keys()].sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1));
  out += `\n\n## Alle feedback-tråde (aktive+arkiverede) under parent ${FEEDBACK_PARENT}: ${ids.length}\n`;

  for (const id of ids) {
    const meta = found.get(id);
    out += await dumpThread(token, id, `TRÅD${meta.archived ? ' [ARKIVERET]' : ' [AKTIV]'}: ${meta.name}`);
  }

  // 3) Other fixed channels since last dump
  for (const [chId, label] of OTHER_CHANNELS) {
    out += `\n---\n\n## KANAL: ${label} (siden ${SINCE_ISO})\n\n`;
    try {
      const msgs = (await dapi(token, `/channels/${chId}/messages?limit=100`)).reverse();
      const recent = msgs.filter((m) => (m.timestamp || '') >= SINCE_ISO);
      out += recent.length ? recent.map(fmtMsg).join('') : '_(ingen nye beskeder)_\n';
    } catch (e) { out += `_(read error: ${e.message})_\n`; }
  }

  const OUT = path.join(process.cwd(), 'scripts', 'discord', '.final-sweep-2026-07-04.md');
  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`WROTE ${OUT} (${out.length} chars, ${ids.length} tråde, ${channels.length} kanaler)`);
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

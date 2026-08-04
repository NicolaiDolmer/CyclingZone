#!/usr/bin/env node
/**
 * READ-ONLY sweep af "Cycling Zone"-guilden — 24t-vindue (ejer-anmodet 4/8 aften).
 * Bredere end sweep-daily.mjs: ALLE forum-kanaler (ikke kun feedback+bugs),
 * alle tekst-kanaler, plus tråde der hænger under tekst-kanaler.
 * Cutoff via SWEEP_SINCE env (ISO) — fallback 32 timer tilbage.
 * Rører IKKE .sweep-state.json (så den daglige automation ikke forstyrres).
 *
 * Token fra DISCORD_TOKEN/DISCORD_BOT_TOKEN env; printes aldrig.
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const GUILD = '1504615050831466669';
const DIR = path.join(process.cwd(), 'scripts', 'discord');

const now = new Date();
const OUT = path.join(DIR, `.sweep-2026-08-04-pm.md`);
const SINCE_ISO = process.env.SWEEP_SINCE || new Date(now.getTime() - 32 * 3600 * 1000).toISOString();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readToken() { return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null; }
function snowflakeTs(id) {
  return new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString();
}

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
  let s = `**@${author}** (${ts} UTC):\n${content || '_(ingen tekst)_'}\n`;
  for (const a of (m.attachments || [])) {
    s += `  [BILLEDE: ${a.filename} ${a.width || ''}x${a.height || ''} ${a.url}]\n`;
  }
  const embeds = (m.embeds || []).map((e) => [e.title, e.description].filter(Boolean).join(' — ')).filter(Boolean);
  for (const e of embeds) s += `  [EMBED: ${e.slice(0, 300)}]\n`;
  return s + '\n';
}

async function dumpThread(token, t, parentLabel) {
  const archived = t.thread_metadata?.archived ? ' [ARKIVERET]' : ' [AKTIV]';
  const created = snowflakeTs(t.id).slice(0, 16).replace('T', ' ');
  const isNew = snowflakeTs(t.id) >= SINCE_ISO;
  let out = `\n---\n\n## TRÅD${archived}${isNew ? ' [NY]' : ''}: ${t.name}\nparent: ${parentLabel} · thread: ${t.id} · created: ${created} UTC\n\n`;
  try {
    const msgs = (await dapi(token, `/channels/${t.id}/messages?limit=100`)).reverse();
    if (isNew) {
      for (const m of msgs) out += fmtMsg(m);
    } else {
      if (msgs[0]) out += `_(OP for kontekst)_\n` + fmtMsg(msgs[0]);
      const fresh = msgs.filter((m) => (m.timestamp || '') >= SINCE_ISO && m.id !== msgs[0]?.id);
      out += `_(nye beskeder siden cutoff: ${fresh.length})_\n\n`;
      for (const m of fresh) out += fmtMsg(m);
    }
  } catch (e) { out += `_(read error: ${e.message})_\n`; }
  return out;
}

async function collectThreads(token, channelId, activeThreads) {
  const found = new Map();
  for (const t of activeThreads) if (t.parent_id === channelId) found.set(t.id, t);
  let before;
  for (let page = 0; page < 15; page++) {
    const q = `/channels/${channelId}/threads/archived/public?limit=100${before ? `&before=${before}` : ''}`;
    const archived = await dapi(token, q, { okEmpty: true });
    await sleep(250);
    if (!archived || !(archived.threads || []).length) break;
    for (const t of archived.threads) found.set(t.id, t);
    if (!archived.has_more) break;
    before = archived.threads[archived.threads.length - 1].thread_metadata?.archive_timestamp;
    if (!before) break;
  }
  return [...found.values()];
}

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }

  const channels = await dapi(token, `/guilds/${GUILD}/channels`);
  const active = await dapi(token, `/guilds/${GUILD}/threads/active`);
  const activeThreads = active.threads || [];

  let out = `# Discord sweep 2026-08-04 PM — "Cycling Zone"\nSince: ${SINCE_ISO} · run: ${now.toISOString()}\n\n`;

  // type 15 = GUILD_FORUM, type 0 = GUILD_TEXT, type 5 = ANNOUNCEMENT
  const forums = channels.filter((c) => c.type === 15);
  const texts = channels.filter((c) => c.type === 0 || c.type === 5);

  out += `Kanal-inventar: ${forums.length} forums (${forums.map((c) => c.name).join(', ')}) · ${texts.length} tekst/announce\n`;

  for (const f of forums) {
    const all = await collectThreads(token, f.id, activeThreads);
    const relevant = all.filter((t) =>
      snowflakeTs(t.id) >= SINCE_ISO ||
      (t.last_message_id && snowflakeTs(t.last_message_id) >= SINCE_ISO));
    out += `\n\n# FORUM: #${f.name} (${f.id})\nThreads total: ${all.length} · aktivitet siden cutoff: ${relevant.length}\n`;
    for (const t of relevant.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))) {
      out += await dumpThread(token, t, `#${f.name}`);
      await sleep(250);
    }
  }

  out += `\n\n# TEKST-KANALER (beskeder siden cutoff)\n`;
  for (const c of texts) {
    let block = '';
    try {
      const msgs = (await dapi(token, `/channels/${c.id}/messages?limit=100`, { okEmpty: true })) || [];
      const recent = msgs.filter((m) => (m.timestamp || '') >= SINCE_ISO).reverse();
      block = recent.length ? recent.map(fmtMsg).join('') : '';
    } catch (e) { block = `_(read error: ${e.message})_\n`; }
    if (block) out += `\n### #${c.name}\n` + block;
    await sleep(250);
  }

  out += `\n\n# TRÅDE UNDER TEKST-KANALER (aktivitet siden cutoff)\n`;
  for (const c of texts) {
    const all = await collectThreads(token, c.id, activeThreads);
    const relevant = all.filter((t) =>
      snowflakeTs(t.id) >= SINCE_ISO ||
      (t.last_message_id && snowflakeTs(t.last_message_id) >= SINCE_ISO));
    for (const t of relevant) {
      out += await dumpThread(token, t, `#${c.name}`);
      await sleep(250);
    }
  }

  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`WROTE ${OUT} (${out.length} chars)`);
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

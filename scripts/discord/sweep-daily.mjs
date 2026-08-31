#!/usr/bin/env node
/**
 * READ-ONLY daglig sweep af "Cycling Zone"-guilden (#2758-automationen, ejer-go 3/8).
 * Cutoff = sidste kørsel fra .sweep-state.json (fallback: 26 timer tilbage).
 * Forum-tråde (#feedback-and-ideas, #bugs): OP + nye beskeder for tråde med aktivitet
 * siden cutoff. Tekst-kanaler: beskeder siden cutoff.
 *
 * Token fra DISCORD_TOKEN/DISCORD_BOT_TOKEN env; printes aldrig.
 * Output: scripts/discord/.sweep-daily-<YYYY-MM-DD>.md (gitignored via dot-prefix)
 * State:  scripts/discord/.sweep-state.json (opdateres kun ved succes)
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const GUILD = '1504615050831466669';
const DIR = path.join(process.cwd(), 'scripts', 'discord');
const STATE = path.join(DIR, '.sweep-state.json');

const now = new Date();
const today = now.toISOString().slice(0, 10);
const OUT = path.join(DIR, `.sweep-daily-${today}.md`);

function readSince() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (s.lastRunISO && !Number.isNaN(Date.parse(s.lastRunISO))) return s.lastRunISO;
  } catch { /* første kørsel */ }
  return new Date(now.getTime() - 26 * 3600 * 1000).toISOString();
}
const SINCE_ISO = readSince();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readToken() { return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null; }

// HH:MM i dansk lokaltid (Europe/Copenhagen), ikke UTC — bruges kun til den synlige kørsel-separator.
function nowHHmmCopenhagen(d) {
  return new Intl.DateTimeFormat('da-DK', {
    timeZone: 'Europe/Copenhagen',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

// To kørsler samme dag deler filnavn (.sweep-daily-<dato>.md). Findes filen allerede,
// APPENDES der med en tydelig separator i stedet for at overskrive (#3440 — 24t vindue tabt 6/8).
function writeSweepOutput(outPath, content, runTime) {
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
  const finalContent = existing
    ? `${existing}\n\n---\n\n## Kørsel ${nowHHmmCopenhagen(runTime)} (Europe/Copenhagen)\n\n${content}`
    : content;
  fs.writeFileSync(outPath, finalContent, 'utf8');
}

// Discord snowflake -> ISO timestamp
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
  for (const e of embeds) s += `  [EMBED: ${e.slice(0, 400)}]\n`;
  return s + '\n';
}

async function dumpThread(token, t) {
  const archived = t.thread_metadata?.archived ? ' [ARKIVERET]' : ' [AKTIV]';
  const created = snowflakeTs(t.id).slice(0, 16).replace('T', ' ');
  const isNew = snowflakeTs(t.id) >= SINCE_ISO;
  let out = `\n---\n\n## TRÅD${archived}${isNew ? ' [NY SIDEN CUTOFF]' : ''}: ${t.name}\nthread: ${t.id} · created: ${created} UTC\n\n`;
  try {
    const msgs = (await dapi(token, `/channels/${t.id}/messages?limit=100`)).reverse();
    if (isNew) {
      for (const m of msgs) out += fmtMsg(m);
    } else {
      if (msgs[0]) out += `_(OP for kontekst)_\n` + fmtMsg(msgs[0]);
      const fresh = msgs.filter((m) => (m.timestamp || '') >= SINCE_ISO && m.id !== msgs[0]?.id);
      out += `_(nye beskeder siden ${SINCE_ISO}: ${fresh.length})_\n\n`;
      for (const m of fresh) out += fmtMsg(m);
    }
  } catch (e) { out += `_(read error: ${e.message})_\n`; }
  return out;
}

async function dumpForum(token, channelId, label) {
  let out = `\n\n# FORUM: ${label} (${channelId})\n`;
  const found = new Map();
  const active = await dapi(token, `/guilds/${GUILD}/threads/active`);
  for (const t of (active.threads || [])) {
    if (t.parent_id === channelId) found.set(t.id, t);
  }
  let before;
  for (let page = 0; page < 15; page++) {
    const q = `/channels/${channelId}/threads/archived/public?limit=100${before ? `&before=${before}` : ''}`;
    const archived = await dapi(token, q, { okEmpty: true });
    await sleep(300);
    if (!archived || !(archived.threads || []).length) break;
    for (const t of archived.threads) found.set(t.id, t);
    if (!archived.has_more) break;
    before = archived.threads[archived.threads.length - 1].thread_metadata?.archive_timestamp;
    if (!before) break;
  }
  const all = [...found.values()];
  const relevant = all.filter((t) => {
    if (snowflakeTs(t.id) >= SINCE_ISO) return true;
    if (t.last_message_id && snowflakeTs(t.last_message_id) >= SINCE_ISO) return true;
    return false;
  });
  out += `Threads total: ${all.length} · med aktivitet siden ${SINCE_ISO}: ${relevant.length}\n`;
  const ids = relevant.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
  for (const t of ids) {
    out += await dumpThread(token, t);
    await sleep(300);
  }
  return out;
}

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }

  const channels = await dapi(token, `/guilds/${GUILD}/channels`);
  const byName = new Map(channels.map((c) => [c.name, c]));

  let out = `# Discord daglig sweep ${today} — "Cycling Zone" (${GUILD})\nSince: ${SINCE_ISO} (fra .sweep-state.json)\n\n`;

  const feedback = byName.get('feedback-and-ideas');
  const bugs = byName.get('bugs');
  if (feedback) out += await dumpForum(token, feedback.id, '#feedback-and-ideas');
  if (bugs) out += await dumpForum(token, bugs.id, '#bugs');

  const textChannels = channels.filter((c) => c.type === 0);
  out += `\n\n# Text channels (beskeder siden ${SINCE_ISO})\n`;
  for (const c of textChannels) {
    let block = '';
    try {
      const msgs = (await dapi(token, `/channels/${c.id}/messages?limit=100`, { okEmpty: true })) || [];
      const recent = msgs.filter((m) => (m.timestamp || '') >= SINCE_ISO).reverse();
      block = recent.length ? recent.map(fmtMsg).join('') : '';
    } catch (e) { block = `_(read error: ${e.message})_\n`; }
    if (block) out += `\n### #${c.name}\n` + block;
    await sleep(300);
  }

  writeSweepOutput(OUT, out, now);
  fs.writeFileSync(STATE, JSON.stringify({ lastRunISO: now.toISOString(), lastOutput: OUT }, null, 2), 'utf8');
  console.log(`WROTE ${OUT} (${out.length} chars) · next cutoff = ${now.toISOString()}`);
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

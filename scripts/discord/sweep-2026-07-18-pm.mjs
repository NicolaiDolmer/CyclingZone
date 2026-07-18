#!/usr/bin/env node
/**
 * READ-ONLY sweep of "Cycling Zone" guild — supplement til dagens tidligere
 * sweep (scripts/discord/.sweep-2026-07-18.md, dækker forums siden 2026-07-17
 * ~12:00 UTC, dumpet ca. kl. 14:00 lokal 2026-07-18).
 *
 * Denne kørsel supplerer med:
 *  - Forum-tråde (#feedback-and-ideas, #bugs): KUN aktivitet EFTER 2026-07-18T12:00Z
 *  - Tekstkanaler (general, questions-and-answers, dansk-snak, dansk-strategi,
 *    strategy-and-tips, team-showcase, transferlist): siden 2026-07-17T12:00Z
 *
 * Token fra DISCORD_TOKEN/DISCORD_BOT_TOKEN env; aldrig printet.
 * Output: scripts/discord/.sweep-2026-07-18-pm.md
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://discord.com/api/v10';
const GUILD = '1504615050831466669';
const SINCE_FORUM_ISO = '2026-07-18T12:00:00';
const SINCE_TEXT_ISO = '2026-07-17T12:00:00';
const OUT = path.join(process.cwd(), 'scripts', 'discord', '.sweep-2026-07-18-pm.md');

const FORUMS = [
  { id: '1505952827615481927', name: 'feedback-and-ideas' },
  { id: '1505952830811541585', name: 'bugs' },
];

const TEXT_CHANNELS = [
  { id: '1504952590486474805', name: 'general' },
  { id: '1521446924975083520', name: 'questions-and-answers' },
  { id: '1505478569969582182', name: 'dansk-snak' },
  { id: '1505478572486430754', name: 'dansk-strategi' },
  { id: '1504952591941898280', name: 'strategy-and-tips' },
  { id: '1504952593309499462', name: 'team-showcase' },
  { id: '1521058859060301896', name: 'transferlist' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readToken() { return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null; }

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

async function dumpThread(token, t, sinceIso) {
  const archived = t.thread_metadata?.archived ? ' [ARKIVERET]' : ' [AKTIV]';
  const created = snowflakeTs(t.id).slice(0, 16).replace('T', ' ');
  const isNew = snowflakeTs(t.id) >= sinceIso;
  let out = `\n---\n\n## TRÅD${archived}${isNew ? ' [NY SIDEN CUTOFF]' : ''}: ${t.name}\nthread: ${t.id} · created: ${created} UTC\n\n`;
  try {
    const msgs = (await dapi(token, `/channels/${t.id}/messages?limit=100`)).reverse();
    if (isNew) {
      for (const m of msgs) out += fmtMsg(m);
    } else {
      if (msgs[0]) out += `_(OP for kontekst)_\n` + fmtMsg(msgs[0]);
      const fresh = msgs.filter((m) => (m.timestamp || '') >= sinceIso && m.id !== msgs[0]?.id);
      out += `_(nye beskeder siden ${sinceIso}: ${fresh.length})_\n\n`;
      for (const m of fresh) out += fmtMsg(m);
    }
  } catch (e) { out += `_(read error: ${e.message})_\n`; }
  return out;
}

async function dumpForum(token, channelId, label, sinceIso) {
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
    if (snowflakeTs(t.id) >= sinceIso) return true;
    if (t.last_message_id && snowflakeTs(t.last_message_id) >= sinceIso) return true;
    return false;
  });
  out += `Threads total: ${all.length} · med aktivitet siden ${sinceIso}: ${relevant.length}\n`;
  const ids = relevant.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
  for (const t of ids) {
    out += await dumpThread(token, t, sinceIso);
    await sleep(300);
  }
  return out;
}

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }

  let out = `# Discord sweep 2026-07-18 PM — "Cycling Zone" (${GUILD})\n`;
  out += `Supplement til .sweep-2026-07-18.md (forums siden 2026-07-17T12:00Z, dumpet ~14:00 lokal).\n`;
  out += `Forums her: siden ${SINCE_FORUM_ISO}Z · Tekstkanaler her: siden ${SINCE_TEXT_ISO}Z\n\n`;

  for (const forum of FORUMS) {
    out += await dumpForum(token, forum.id, `#${forum.name}`, SINCE_FORUM_ISO);
  }

  out += `\n\n# Text channels (beskeder siden ${SINCE_TEXT_ISO})\n`;
  for (const c of TEXT_CHANNELS) {
    out += `\n### #${c.name}\n`;
    try {
      const msgs = (await dapi(token, `/channels/${c.id}/messages?limit=100`, { okEmpty: true })) || [];
      const recent = msgs.filter((m) => (m.timestamp || '') >= SINCE_TEXT_ISO).reverse();
      out += recent.length ? recent.map(fmtMsg).join('') : '_(ingen nye beskeder)_\n';
    } catch (e) { out += `_(read error: ${e.message})_\n`; }
    await sleep(300);
  }

  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`WROTE ${OUT} (${out.length} chars)`);
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

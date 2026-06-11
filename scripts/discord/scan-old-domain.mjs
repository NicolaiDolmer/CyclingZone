#!/usr/bin/env node
/**
 * Read-only sweep efter gamle domæne-referencer (cycling-zone.vercel.app) i
 * Discord-serveren: server-beskrivelse, kanal-topics og pinned messages.
 * Token fra DISCORD_TOKEN/DISCORD_BOT_TOKEN env (Infisical-injected); printes aldrig.
 * Output: kun kanalnavn + kort excerpt omkring match (ingen attachment-URLs,
 * ingen fulde message-dumps) så sanitize-hooken ikke trigges.
 *
 * Brug: infisical run --env=dev -- node scripts/discord/scan-old-domain.mjs
 * Refs: #1296 (domæne-flip).
 */
const GUILD = '474142653529849886';
const API = 'https://discord.com/api/v10';
const NEEDLE = 'cycling-zone.vercel.app';

const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN/DISCORD_BOT_TOKEN mangler i env (kør via infisical run).');
  process.exit(1);
}

async function dapi(p) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (res.status === 429) {
    const body = await res.json();
    await new Promise((r) => setTimeout(r, (body.retry_after ?? 1) * 1000 + 100));
    return dapi(p);
  }
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.json();
}

function excerpt(text) {
  const i = text.indexOf(NEEDLE);
  return text.slice(Math.max(0, i - 40), i + NEEDLE.length + 40).replace(/\s+/g, ' ');
}

const hits = [];

const guild = await dapi(`/guilds/${GUILD}`);
if ((guild.description || '').includes(NEEDLE)) {
  hits.push({ where: 'server-beskrivelse', excerpt: excerpt(guild.description) });
}

const channels = await dapi(`/guilds/${GUILD}/channels`);
const textLike = channels.filter((c) => [0, 5, 15].includes(c.type)); // text, announcement, forum

for (const c of channels) {
  if ((c.topic || '').includes(NEEDLE)) {
    hits.push({ where: `topic #${c.name}`, excerpt: excerpt(c.topic) });
  }
}

for (const c of textLike) {
  let pins = [];
  try {
    pins = await dapi(`/channels/${c.id}/pins`);
  } catch {
    continue; // mangler adgang til kanalen — skip
  }
  for (const m of pins) {
    if ((m.content || '').includes(NEEDLE)) {
      hits.push({ where: `pin i #${c.name} (msg ${m.id})`, excerpt: excerpt(m.content) });
    }
  }
}

console.log(`Scannede ${channels.length} kanaler (${textLike.length} text-like) + server-beskrivelse.`);
if (hits.length === 0) {
  console.log(`Ingen forekomster af ${NEEDLE} fundet i topics/pins/beskrivelse.`);
} else {
  console.log(`${hits.length} forekomst(er) af ${NEEDLE}:`);
  for (const h of hits) console.log(`  - ${h.where}: …${h.excerpt}…`);
}

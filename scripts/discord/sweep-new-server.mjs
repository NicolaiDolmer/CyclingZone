#!/usr/bin/env node
/**
 * READ-ONLY full-copy sweep of a single guild (default: new "Cycling Zone" server).
 * Dumps structure + full channel topics + full pin content + recent messages,
 * so player-facing copy can be audited against docs/TONE_OF_VOICE.md.
 *
 * Token from DISCORD_TOKEN/DISCORD_BOT_TOKEN env (Infisical) — never printed.
 * Attachment URLs are NOT printed (only filenames) per the sanitize-hook convention.
 *
 *   infisical run --env=dev -- node scripts/discord/sweep-new-server.mjs [guildId]
 *
 * Output: scripts/discord/.new-server-sweep.md
 */
import fs from "node:fs";
import path from "node:path";

const GUILD = process.argv[2] || "1504615050831466669"; // "Cycling Zone" (new)
const API = "https://discord.com/api/v10";
const OUT = path.join(process.cwd(), "scripts", "discord", ".new-server-sweep.md");
const MSG_LIMIT = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("NO_TOKEN");
  process.exit(3);
}

async function dapi(p, { okEmpty = false } = {}) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    await sleep(Math.ceil((body.retry_after || 1) * 1000) + 250);
    return dapi(p, { okEmpty });
  }
  if (!res.ok) {
    if (okEmpty) return null;
    throw new Error(`${res.status} on ${p}`);
  }
  return res.json();
}

function fmtMsg(m, cap = 1200) {
  const author = m.author?.bot ? `${m.author.username} [BOT]` : (m.author?.username || "?");
  const ts = (m.timestamp || "").slice(0, 16).replace("T", " ");
  const content = (m.content || "").trim().slice(0, cap);
  const att = (m.attachments || []).map((a) => a.filename).join(", ");
  const embeds = (m.embeds || [])
    .map((e) => [e.title, e.description].filter(Boolean).join(" — "))
    .filter(Boolean)
    .join(" | ");
  let s = `  - [${ts} UTC] **${author}**: ${content || "(intet tekstindhold)"}`;
  if (embeds) s += `\n      embed: ${embeds.slice(0, 600)}`;
  else if ((m.embeds || []).length) s += ` (${m.embeds.length} embed(s))`;
  if (att) s += ` (vedhæft: ${att})`;
  return s;
}

const guild = await dapi(`/guilds/${GUILD}`);
const channels = await dapi(`/guilds/${GUILD}/channels`);
const cats = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
const textChannels = channels.filter((c) => c.type === 0 || c.type === 5);

let out = `# "${guild.name}" full-copy sweep ${new Date().toISOString().slice(0, 10)} — READ-ONLY\n\n`;
out += `Guild: ${GUILD} · ${channels.length} channels/categories · ${textChannels.length} text/announcement channels\n\n`;

out += `## Structure (categories, channels, topics)\n\n`;
const byCat = new Map();
for (const c of channels.filter((ch) => ch.type !== 4).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
  const cat = cats.get(c.parent_id) || "(no category)";
  if (!byCat.has(cat)) byCat.set(cat, []);
  const typeLabel = { 0: "text", 2: "voice", 5: "announcement", 13: "stage", 15: "forum" }[c.type] ?? `type${c.type}`;
  let row = `- #${c.name} (${typeLabel})`;
  if (c.topic) row += `\n    topic: ${c.topic.replace(/\s+/g, " ").trim()}`;
  byCat.get(cat).push(row);
}
for (const [cat, rows] of byCat) out += `### ${cat}\n${rows.join("\n")}\n\n`;

out += `## Pinned messages (full content)\n\n`;
for (const c of textChannels) {
  const pins = await dapi(`/channels/${c.id}/pins`, { okEmpty: true });
  await sleep(350);
  if (!pins || pins.length === 0) continue;
  out += `### #${c.name} (${pins.length} pin(s))\n`;
  for (const m of pins) out += `${fmtMsg(m, 2000)}\n`;
  out += "\n";
}

out += `## Recent messages per text channel (last ${MSG_LIMIT}, newest first)\n\n`;
for (const c of textChannels) {
  const msgs = await dapi(`/channels/${c.id}/messages?limit=${MSG_LIMIT}`, { okEmpty: true });
  await sleep(350);
  out += `### #${c.name}\n`;
  if (!msgs || msgs.length === 0) { out += "(no messages / no access)\n\n"; continue; }
  for (const m of msgs) out += `${fmtMsg(m)}\n`;
  out += "\n";
}

fs.writeFileSync(OUT, out, "utf8");
console.log(`OK — wrote ${OUT} (${textChannels.length} text channels)`);

#!/usr/bin/env node
/**
 * Launch-prep sweep (#1180 pkt 7) — READ-ONLY.
 *
 * 1. Dumper server-struktur (kategorier/kanaler/topics).
 * 2. Dumper pinned messages pr. tekstkanal og flagger PCM-/rigtige-rytternavne-
 *    referencer (relaunch 20/6 = fiktive ryttere; pins må ikke pege på PCM-æraen).
 * 3. Læser seneste beskeder i webhook-kanalerne (general + transfer-history)
 *    for at verificere webhook-leverance EFTER #1289-re-pointet (11/6) uden at
 *    poste noget.
 *
 * Token fra DISCORD_TOKEN/DISCORD_BOT_TOKEN env (Infisical) — printes aldrig.
 * Attachment-URLs printes IKKE (kun filnavn) jf. sanitize-hook-konventionen.
 *
 * Output: scripts/discord/.pins-sweep-2026-06-12.md
 */
import fs from "node:fs";
import path from "node:path";

const GUILD = "474142653529849886";
const API = "https://discord.com/api/v10";
const OUT = path.join(process.cwd(), "scripts", "discord", ".pins-sweep-2026-06-12.md");

// Markører for PCM-æra-indhold i pins (relaunch = fiktive ryttere + eget værdisystem).
const PCM_MARKERS = /\bPCM\b|Pro Cycling Manager|UCI[- ]?points?|UCI[- ]?ranking/i;
// Kendte rigtige ryttere der har optrådt i spillets PCM-æra-kommunikation.
const REAL_RIDER_MARKERS = /Poga[cč]ar|Vingegaard|van der Poel|MvdP|Evenepoel|Roglic|Roglič|van Aert|Philipsen|Pedersen|Mads Pedersen|Girmay|Ayuso|Hindley|Carapaz|Landa|Mas\b|Kuss\b|Pidcock|Sagan|Cavendish|Alaphilippe|Wiggins|Froome|Contador/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readToken() {
  return process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || null;
}

async function dapi(token, p, { okEmpty = false } = {}) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const wait = Math.ceil((body.retry_after || 1) * 1000) + 250;
    await sleep(wait);
    return dapi(token, p, { okEmpty });
  }
  if (!res.ok) {
    if (okEmpty) return null;
    throw new Error(`${res.status} on ${p}`);
  }
  return res.json();
}

function fmtMsg(m) {
  const author = m.author?.bot ? `${m.author.username} [BOT]` : (m.author?.username || "?");
  const ts = (m.timestamp || "").slice(0, 16).replace("T", " ");
  const content = (m.content || "").replace(/\s+/g, " ").slice(0, 400);
  const att = (m.attachments || []).map((a) => a.filename).join(", ");
  const embeds = (m.embeds || []).length;
  return `  - [${ts} UTC] **${author}**: ${content || "(intet tekstindhold)"}${embeds ? ` (${embeds} embed(s))` : ""}${att ? ` (vedhæft: ${att})` : ""}`;
}

async function main() {
  const token = readToken();
  if (!token) { console.error("NO_TOKEN"); process.exit(3); }

  const channels = await dapi(token, `/guilds/${GUILD}/channels`);
  const cats = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  const textChannels = channels.filter((c) => c.type === 0 || c.type === 5 || c.type === 15);

  let out = `# Discord pins-/struktur-sweep ${new Date().toISOString().slice(0, 10)} (#1180 pkt 7) — READ-ONLY\n\n`;

  // 1. Struktur
  out += `## Server-struktur (${channels.length} kanaler/kategorier)\n\n`;
  const byCat = new Map();
  for (const c of channels.filter((ch) => ch.type !== 4).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const cat = cats.get(c.parent_id) || "(ingen kategori)";
    if (!byCat.has(cat)) byCat.set(cat, []);
    const typeLabel = { 0: "text", 2: "voice", 5: "announcement", 13: "stage", 15: "forum" }[c.type] ?? `type${c.type}`;
    byCat.get(cat).push(`- #${c.name} (${typeLabel})${c.topic ? ` — topic: ${c.topic.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
  }
  for (const [cat, rows] of byCat) out += `### ${cat}\n${rows.join("\n")}\n\n`;

  // 2. Pins pr. tekstkanal + PCM-/rytter-markører
  out += `## Pinned messages (PCM-/rigtige-rytter-markører flagget)\n\n`;
  const flagged = [];
  for (const c of textChannels) {
    if (c.type === 15) continue; // forum: pins ligger i tråde, dækkes ikke her
    const pins = await dapi(token, `/channels/${c.id}/pins`, { okEmpty: true });
    await sleep(350);
    if (!pins || pins.length === 0) continue;
    out += `### #${c.name} (${pins.length} pin(s))\n`;
    for (const m of pins) {
      const text = `${m.content || ""} ${(m.embeds || []).map((e) => `${e.title || ""} ${e.description || ""}`).join(" ")}`;
      const hits = [];
      if (PCM_MARKERS.test(text)) hits.push("PCM/UCI");
      if (REAL_RIDER_MARKERS.test(text)) hits.push("RIGTIG-RYTTER");
      if (hits.length) flagged.push({ channel: c.name, hits, preview: text.replace(/\s+/g, " ").slice(0, 200) });
      out += `${fmtMsg(m)}${hits.length ? `  ⚠️ **[${hits.join(" + ")}]**` : ""}\n`;
    }
    out += "\n";
  }
  out += `### Flag-opsummering\n${flagged.length === 0 ? "Ingen PCM-/rigtige-rytter-referencer fundet i pins.\n" : flagged.map((f) => `- #${f.channel}: [${f.hits.join(" + ")}] ${f.preview}`).join("\n") + "\n"}\n`;

  // 3. Webhook-leverance: seneste beskeder i general + transfer-history (read-only)
  out += `## Webhook-leverance (seneste 10 beskeder, read-only — ingen test-post)\n\n`;
  const hookChannels = textChannels.filter((c) => /general|transfer.?history|transfers?$/i.test(c.name));
  for (const c of hookChannels) {
    const msgs = await dapi(token, `/channels/${c.id}/messages?limit=10`, { okEmpty: true });
    await sleep(350);
    out += `### #${c.name}\n`;
    if (!msgs || msgs.length === 0) { out += "(ingen beskeder/ingen adgang)\n\n"; continue; }
    const hookMsgs = msgs.filter((m) => m.webhook_id || m.author?.bot);
    out += `Seneste besked: ${msgs[0].timestamp?.slice(0, 16)} UTC · webhook-/bot-beskeder i de seneste 10: ${hookMsgs.length}\n`;
    for (const m of msgs.slice(0, 5)) out += `${fmtMsg(m)}${m.webhook_id ? " [WEBHOOK]" : ""}\n`;
    out += "\n";
  }

  fs.writeFileSync(OUT, out, "utf8");
  console.log(`OK — skrev ${OUT} (${flagged.length} flaggede pins, ${textChannels.length} tekstkanaler scannet)`);
}

main().catch((e) => { console.error("FEJL:", e.message); process.exit(1); });

#!/usr/bin/env node
/**
 * #1180 pkt 7 (del 2) — READ-ONLY webhook-leverance-tjek.
 * Læser seneste beskeder i de aktive spil-kanaler og rapporterer seneste
 * webhook-/bot-leverance pr. kanal (ingen test-post). Token printes aldrig.
 * Output: append til scripts/discord/.pins-sweep-2026-06-12.md
 */
import fs from "node:fs";
import path from "node:path";

const GUILD = "474142653529849886";
const API = "https://discord.com/api/v10";
const OUT = path.join(process.cwd(), "scripts", "discord", ".pins-sweep-2026-06-12.md");
const TARGETS = /^(cycling-zone|resultater|transferhistorik|transferlisten|auktioner|patch-notes|exportede-resultater|samlet-feedback-features-og-bugs)$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!token) { console.error("NO_TOKEN"); process.exit(3); }

async function dapi(p) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (res.status === 429) { const b = await res.json().catch(() => ({})); await sleep((b.retry_after || 1) * 1000 + 250); return dapi(p); }
  if (!res.ok) return null;
  return res.json();
}

const channels = await dapi(`/guilds/${GUILD}/channels`);
let out = "\n## Webhook-leverance del 2 — aktive spil-kanaler (seneste 15 beskeder pr. kanal)\n\n";
for (const c of channels.filter((ch) => ch.type === 0 && TARGETS.test(ch.name))) {
  const msgs = await dapi(`/channels/${c.id}/messages?limit=15`);
  await sleep(350);
  out += `### #${c.name}\n`;
  if (!msgs?.length) { out += "(ingen beskeder/ingen adgang)\n\n"; continue; }
  const hook = msgs.find((m) => m.webhook_id);
  const bot = msgs.find((m) => m.author?.bot);
  out += `- Seneste besked: ${msgs[0].timestamp?.slice(0, 16)} UTC (${msgs[0].webhook_id ? "WEBHOOK" : msgs[0].author?.bot ? "BOT" : msgs[0].author?.username})\n`;
  out += `- Seneste WEBHOOK-besked i de 15: ${hook ? `${hook.timestamp?.slice(0, 16)} UTC — "${(hook.content || hook.embeds?.[0]?.title || "(embed)").toString().replace(/\s+/g, " ").slice(0, 120)}"` : "ingen"}\n`;
  out += `- Seneste BOT-besked i de 15: ${bot ? `${bot.timestamp?.slice(0, 16)} UTC (${bot.author.username})` : "ingen"}\n\n`;
}
fs.appendFileSync(OUT, out, "utf8");
console.log("OK — appendede webhook-del-2 til .pins-sweep-2026-06-12.md");

#!/usr/bin/env node
/**
 * Apply ToV mechanical fixes to the 4 curated pins on the new "Cycling Zone"
 * server. Fetches each pin's CURRENT content and applies only 3 deterministic
 * string replacements, then PATCHes the (bot-authored) message. No re-typing,
 * so mentions / emoji / markdown are preserved byte-for-byte.
 *
 *   --apply   actually PATCH (default is dry-run preview)
 *
 * Token from DISCORD_TOKEN/DISCORD_BOT_TOKEN env (Infisical) — never printed.
 */
const GUILD = "1504615050831466669"; // Cycling Zone (new)
const API = "https://discord.com/api/v10";
const APPLY = process.argv.includes("--apply");
const TARGETS = ["rules", "start-here", "dansk-regler", "dansk-snak"];

const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!token) { console.error("NO_TOKEN"); process.exit(3); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { Authorization: `Bot ${token}` };

async function dapi(p, opts = {}) {
  const res = await fetch(`${API}${p}`, { headers: H, ...opts });
  if (res.status === 429) {
    const b = await res.json().catch(() => ({}));
    await sleep(Math.ceil((b.retry_after || 1) * 1000) + 250);
    return dapi(p, opts);
  }
  return res;
}

function applyFixes(s) {
  let out = s;
  const log = [];
  const before = out;
  out = out.split("CyclingZone").join("Cycling Zone");
  if (out !== before) log.push(`CyclingZone -> Cycling Zone (${(before.match(/CyclingZone/g) || []).length}x)`);
  const b2 = out;
  out = out.split("—").join("·").split("–").join("·"); // em/en dash -> middot
  if (out !== b2) log.push(`em/en-dash -> middot`);
  const b3 = out;
  out = out.split("https://cycling-zone.vercel.app").join("https://cyclingzone.org");
  if (out !== b3) log.push(`vercel.app URL -> cyclingzone.org (${(b3.match(/https:\/\/cycling-zone\.vercel\.app/g) || []).length}x)`);
  return { out, log };
}

const channels = await dapi(`/guilds/${GUILD}/channels`).then((r) => r.json());
const byName = new Map(channels.map((c) => [c.name, c]));

console.log(APPLY ? "MODE: APPLY (live edits)\n" : "MODE: DRY-RUN (no edits)\n");

for (const name of TARGETS) {
  const ch = byName.get(name);
  if (!ch) { console.log(`#${name}: NOT FOUND\n`); continue; }
  const pins = await dapi(`/channels/${ch.id}/pins`).then((r) => r.json());
  await sleep(300);
  const pin = (pins || []).find((m) => m.author?.bot);
  if (!pin) { console.log(`#${name}: no bot-authored pin\n`); continue; }

  const { out, log } = applyFixes(pin.content || "");
  if (log.length === 0) { console.log(`#${name}: already clean, skip\n`); continue; }

  const firstLineBefore = (pin.content || "").split("\n")[0];
  const firstLineAfter = out.split("\n")[0];
  console.log(`#${name} (msg ${pin.id})`);
  console.log(`  changes: ${log.join(" | ")}`);
  console.log(`  heading:  "${firstLineBefore}"  ->  "${firstLineAfter}"`);

  if (APPLY) {
    const res = await dapi(`/channels/${ch.id}/messages/${pin.id}`, {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ content: out }),
    });
    console.log(`  PATCH -> ${res.status} ${res.ok ? "OK" : await res.text()}`);
    await sleep(500);
  }
  console.log("");
}

console.log(APPLY ? "Done (applied)." : "Dry-run only. Re-run with --apply to edit.");

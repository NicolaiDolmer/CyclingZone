#!/usr/bin/env node
/**
 * Cycling Zone — Discord bot-token health-check (forward-guard, #748)
 *
 * Authenticates against Discord's REST API with DISCORD_BOT_TOKEN and reports
 * ONLY the HTTP status + bot username. The token value is NEVER printed.
 *
 * Why this exists: 2026-06-03 alle person-rettede DMs (overbud, auktion vundet,
 * transfertilbud) fejlede stille med `openDm 401: Unauthorized` fordi Railways
 * DISCORD_BOT_TOKEN var roteret/ude af sync. Fejlen blev kun logget som
 * console.error → ingen alarm. Denne check fanger token-drift med det samme.
 *
 * Usage:
 *   railway run -- node scripts/check-discord-bot-token.mjs   # prod-env injiceret
 *   node scripts/check-discord-bot-token.mjs                  # lokal .env
 *
 * Exit: 0 = token virker, 1 = token mangler/ugyldig (CI/doctor kan gate på dette).
 */

// Production-backenden læser KUN DISCORD_BOT_TOKEN. Scripts/MCP accepterer
// DISCORD_TOKEN som fallback — vi tjekker begge så diagnostikken matcher hver
// konsument, og rapporterer hvilket navn der faktisk var sat.
const tokenName = process.env.DISCORD_BOT_TOKEN ? "DISCORD_BOT_TOKEN"
  : process.env.DISCORD_TOKEN ? "DISCORD_TOKEN"
  : null;
const token = tokenName ? process.env[tokenName] : null;

if (!token) {
  console.error("[bot-token-check] FAIL: hverken DISCORD_BOT_TOKEN eller DISCORD_TOKEN sat i env");
  process.exit(1);
}
console.error(`[bot-token-check] navn fundet: ${tokenName}`);

try {
  const res = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[bot-token-check] FAIL: ${res.status} — ${text.slice(0, 120)}`);
    // Struktur-diagnostik (afslører ALDRIG værdien) — fanger paste-kontaminering:
    // gyldigt bot-token = 3 base64-segmenter adskilt af '.', ingen whitespace/quotes,
    // intet 'Bot '-præfiks (det tilføjer vi selv i Authorization-headeren).
    const diag = {
      length: token.length,
      dotSegments: token.split(".").length,
      startsWithBot: /^bot\s/i.test(token),
      hasWhitespace: /\s/.test(token),
      hasQuotes: /["']/.test(token),
      trimmedDiffers: token.trim() !== token,
    };
    console.error(`[bot-token-check] struktur:`, JSON.stringify(diag));
    process.exit(1);
  }
  const me = await res.json();
  console.log(`[bot-token-check] OK: token gyldigt — bot = ${me.username}#${me.discriminator ?? ""} (id ${me.id})`);
  process.exit(0);
} catch (err) {
  console.error(`[bot-token-check] FAIL: netværks-/runtime-fejl — ${err.message}`);
  process.exit(1);
}

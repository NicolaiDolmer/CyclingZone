#!/usr/bin/env node
/**
 * READ-ONLY: list the guilds the bot is a member of (id + name).
 * Closes the "no list-guilds tool" gap noted in docs/DISCORD_MCP_SETUP.md.
 * Token read from DISCORD_TOKEN/DISCORD_BOT_TOKEN env (Infisical) — never printed.
 *
 *   infisical run --env=dev -- node scripts/discord/list-guilds.mjs
 */
const API = "https://discord.com/api/v10";
const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("NO_TOKEN");
  process.exit(3);
}

const res = await fetch(`${API}/users/@me/guilds`, {
  headers: { Authorization: `Bot ${token}` },
});
if (!res.ok) {
  console.error(`${res.status} on /users/@me/guilds: ${await res.text()}`);
  process.exit(1);
}

const guilds = await res.json();
for (const g of guilds) {
  console.log(`${g.id}  ${g.name}${g.owner ? "  [bot-owner]" : ""}`);
}
console.log(`\n${guilds.length} guild(s)`);

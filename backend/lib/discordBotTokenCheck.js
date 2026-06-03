/**
 * Daily Discord bot-token safety-net.
 * ===================================
 * Person-rettede DMs (overbud, auktion vundet, transfertilbud) sendes via
 * Discord bot-token. Token kan rotere eller komme ud af sync uden at nogen
 * opdager det (2026-06-03: ALLE DMs fejlede tavst med `openDm 401` fordi
 * Railways DISCORD_BOT_TOKEN var ugyldig — fejlen blev kun logget som
 * console.error, ingen alarm). Denne read-only monitor authenticater mod
 * Discord (`GET /users/@me`) og alerter via Sentry + webhook hvis token
 * mangler eller afvises — så drift fanges med det samme.
 *
 * Alert-kanalen er en webhook (URL-baseret), som virker selv om bot-token er
 * dødt — så alarmen kommer altid igennem.
 */

const DISCORD_API = "https://discord.com/api/v10";

export async function processDiscordBotTokenCheck({
  botToken,
  fetchFn = fetch,
  sendWebhookFn,
  getDefaultWebhookFn,
  captureExceptionFn,
  now = new Date(),
} = {}) {
  let status = null;
  let problem = null;

  if (!botToken) {
    problem = "DISCORD_BOT_TOKEN/DISCORD_TOKEN er ikke sat på serveren";
  } else {
    try {
      const res = await fetchFn(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      status = res.status;
      if (!res.ok) {
        problem = `Discord afviste bot-token (HTTP ${res.status}) — sandsynligvis roteret/ugyldigt.`;
      }
    } catch (err) {
      problem = `Kunne ikke nå Discord for token-validering: ${err.message}`;
    }
  }

  if (!problem) {
    return { alerted: false, status };
  }

  const url = getDefaultWebhookFn ? await getDefaultWebhookFn() : null;
  if (url && sendWebhookFn) {
    await sendWebhookFn(url, {
      embeds: [
        {
          title: "🚨 Discord bot-token ugyldig",
          description: `${problem}\nPerson-rettede DMs (overbud, auktion vundet, transfertilbud) leveres ikke. Synk et gyldigt token til Railway DISCORD_BOT_TOKEN.`,
          color: 0xe74c3c,
          timestamp: now.toISOString(),
        },
      ],
    });
  }

  if (captureExceptionFn) {
    captureExceptionFn(new Error(`Discord bot-token check failed: ${problem}`), {
      tags: { cron: "discord-bot-token-check" },
      extra: { status },
    });
  }

  return { alerted: true, status };
}

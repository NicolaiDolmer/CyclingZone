import test from "node:test";
import assert from "node:assert/strict";

import { processDiscordBotTokenCheck } from "./discordBotTokenCheck.js";

function makeDeps({ fetchFn } = {}) {
  const webhookCalls = [];
  const captures = [];
  return {
    fetchFn,
    sendWebhookFn: async (url, payload) => webhookCalls.push({ url, payload }),
    getDefaultWebhookFn: async () => "https://discord.com/api/webhooks/abc/def",
    captureExceptionFn: (err, ctx) => captures.push({ err, ctx }),
    now: new Date("2026-06-03T12:00:00Z"),
    _webhookCalls: webhookCalls,
    _captures: captures,
  };
}

test("gyldigt token (200): ingen alert, ingen capture/webhook", async () => {
  const deps = makeDeps({ fetchFn: async () => ({ ok: true, status: 200 }) });
  const result = await processDiscordBotTokenCheck({ botToken: "valid", ...deps });
  assert.equal(result.alerted, false);
  assert.equal(result.status, 200);
  assert.equal(deps._webhookCalls.length, 0);
  assert.equal(deps._captures.length, 0);
});

test("401 Unauthorized: alert + Sentry-capture + webhook", async () => {
  const deps = makeDeps({ fetchFn: async () => ({ ok: false, status: 401 }) });
  const result = await processDiscordBotTokenCheck({ botToken: "stale", ...deps });
  assert.equal(result.alerted, true);
  assert.equal(result.status, 401);
  assert.equal(deps._webhookCalls.length, 1);
  assert.match(deps._webhookCalls[0].payload.embeds[0].title, /bot-token ugyldig/i);
  assert.equal(deps._captures.length, 1);
  assert.equal(deps._captures[0].ctx.tags.cron, "discord-bot-token-check");
  assert.equal(deps._captures[0].ctx.extra.status, 401);
});

test("429 rate-limit: alert med korrekt diagnose (IP-rate-limit, IKKE token-fejl) (#1115)", async () => {
  const deps = makeDeps({ fetchFn: async () => ({ ok: false, status: 429 }) });
  const result = await processDiscordBotTokenCheck({ botToken: "valid-but-ratelimited", ...deps });
  assert.equal(result.alerted, true);
  assert.equal(result.status, 429);
  assert.equal(deps._webhookCalls.length, 1);
  const embed = deps._webhookCalls[0].payload.embeds[0];
  // 9/6-regressionen: 429 blev rapporteret som "roteret/ugyldigt" og sendte
  // fejlsøgningen mod token-rotation. Alarmen skal nu skelne.
  assert.match(embed.title, /rate-limiter/i);
  assert.doesNotMatch(embed.title, /ugyldig/i);
  assert.doesNotMatch(deps._captures[0].err.message, /roteret\/ugyldigt/i);
  assert.equal(deps._captures[0].ctx.extra.status, 429);
});

test("manglende token: alert uden netværksopkald", async () => {
  let fetchCalled = false;
  const deps = makeDeps({ fetchFn: async () => { fetchCalled = true; return { ok: true, status: 200 }; } });
  const result = await processDiscordBotTokenCheck({ botToken: null, ...deps });
  assert.equal(result.alerted, true);
  assert.equal(fetchCalled, false);
  assert.equal(deps._captures.length, 1);
});

test("netværksfejl mod Discord: alert (fail-loud, ikke fail-silent)", async () => {
  const deps = makeDeps({ fetchFn: async () => { throw new Error("ECONNRESET"); } });
  const result = await processDiscordBotTokenCheck({ botToken: "x", ...deps });
  assert.equal(result.alerted, true);
  assert.equal(deps._captures.length, 1);
  assert.match(deps._captures[0].err.message, /ECONNRESET/);
});

test("ingen webhook konfigureret: capture sker stadig, ingen webhook-kald", async () => {
  const deps = makeDeps({ fetchFn: async () => ({ ok: false, status: 401 }) });
  deps.getDefaultWebhookFn = async () => null;
  const result = await processDiscordBotTokenCheck({ botToken: "stale", ...deps });
  assert.equal(result.alerted, true);
  assert.equal(deps._webhookCalls.length, 0);
  assert.equal(deps._captures.length, 1);
});

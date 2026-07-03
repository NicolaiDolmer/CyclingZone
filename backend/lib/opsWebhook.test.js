import test from "node:test";
import assert from "node:assert/strict";

import {
  getOpsMention,
  getOpsWebhookUrl,
  withOpsMention,
  makeSendOpsWebhook,
} from "./opsWebhook.js";

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return (async () => {
    try {
      return await fn();
    } finally {
      for (const k of Object.keys(vars)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  })();
}

test("getOpsMention — usat → null; sat (m. whitespace) → trimmet", async () => {
  await withEnv({ DISCORD_OPS_MENTION: undefined }, () => {
    assert.equal(getOpsMention(), null);
  });
  await withEnv({ DISCORD_OPS_MENTION: "  <@123>  " }, () => {
    assert.equal(getOpsMention(), "<@123>");
  });
  await withEnv({ DISCORD_OPS_MENTION: "   " }, () => {
    assert.equal(getOpsMention(), null);
  });
});

test("getOpsWebhookUrl — eksplicit ops-URL vinder over default", async () => {
  await withEnv({ DISCORD_OPS_WEBHOOK_URL: "https://discord.example/ops" }, async () => {
    const url = await getOpsWebhookUrl(async () => "https://discord.example/default");
    assert.equal(url, "https://discord.example/ops");
  });
});

test("getOpsWebhookUrl — usat → graceful fallback til default", async () => {
  await withEnv({ DISCORD_OPS_WEBHOOK_URL: undefined }, async () => {
    const url = await getOpsWebhookUrl(async () => "https://discord.example/default");
    assert.equal(url, "https://discord.example/default");
  });
});

test("getOpsWebhookUrl — usat + ingen default-fn → null", async () => {
  await withEnv({ DISCORD_OPS_WEBHOOK_URL: undefined }, async () => {
    assert.equal(await getOpsWebhookUrl(), null);
    assert.equal(await getOpsWebhookUrl(async () => null), null);
  });
});

test("withOpsMention — ingen mention → payload uændret (samme reference-form)", () => {
  const payload = { embeds: [{ title: "x" }] };
  assert.deepEqual(withOpsMention(payload, null), payload);
});

test("withOpsMention — mention sat → content + allowed_mentions prepended, embeds bevaret", () => {
  const payload = { embeds: [{ title: "x" }] };
  const out = withOpsMention(payload, "<@123>");
  assert.equal(out.content, "<@123>");
  assert.deepEqual(out.allowed_mentions, { parse: ["users"] });
  assert.deepEqual(out.embeds, payload.embeds);
});

test("makeSendOpsWebhook — injicerer mention på send-tid", async () => {
  const calls = [];
  const send = makeSendOpsWebhook(
    (url, payload) => { calls.push({ url, payload }); },
    () => "<@999>"
  );
  send("https://discord.example/ops", { embeds: [{ title: "alarm" }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://discord.example/ops");
  assert.equal(calls[0].payload.content, "<@999>");
  assert.deepEqual(calls[0].payload.allowed_mentions, { parse: ["users"] });
});

test("makeSendOpsWebhook — ingen mention → payload sendes uændret", async () => {
  const calls = [];
  const send = makeSendOpsWebhook(
    (url, payload) => { calls.push({ url, payload }); },
    () => null
  );
  send("https://discord.example/ops", { embeds: [{ title: "alarm" }] });
  assert.equal(calls[0].payload.content, undefined);
  assert.equal(calls[0].payload.allowed_mentions, undefined);
});

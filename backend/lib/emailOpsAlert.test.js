import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmailFailureCollector,
  summarizeLines,
  buildPermanentFailureEmbed,
  buildRetryDeadEmbed,
  postOpsEmbed,
  postPermanentFailureAlert,
} from "./emailOpsAlert.js";

const NOW = new Date("2026-09-08T06:00:00Z");

test("summarizeLines klipper lange lister og siger hvor mange der mangler", () => {
  const lines = Array.from({ length: 12 }, (_, i) => `linje ${i}`);
  const out = summarizeLines(lines, 3);
  assert.equal(out.split("\n").length, 4);
  assert.ok(out.endsWith("... og 9 mere"));
  assert.equal(summarizeLines(["a", "b"], 3), "a\nb", "kort liste roeres ikke");
});

test("tom opsamler sender ingen besked", async () => {
  const posts = [];
  const sent = await postPermanentFailureAlert({
    collector: createEmailFailureCollector(),
    sweep: "email-welcome",
    now: NOW,
    sendWebhookFn: async (...args) => posts.push(args),
    getOpsWebhookFn: async () => "https://discord.example/ops",
  });
  assert.equal(sent, false);
  assert.equal(posts.length, 0);
});

test("mange fejl i én koersel giver PRAECIS én besked", async () => {
  const collector = createEmailFailureCollector();
  for (let i = 0; i < 25; i++) {
    collector.permanent.push({ dedupeKey: `welcome:user-${i}`, reason: "config-error", error: "invalid address" });
  }
  const posts = [];
  const sent = await postPermanentFailureAlert({
    collector,
    sweep: "email-welcome",
    now: NOW,
    sendWebhookFn: async (url, payload) => posts.push({ url, payload }),
    getOpsWebhookFn: async () => "https://discord.example/ops",
  });

  assert.equal(sent, true);
  assert.equal(posts.length, 1, "én besked pr. koersel, ikke én pr. mail");
  assert.ok(posts[0].payload.embeds[0].title.includes("25"));
});

test("uden ops-webhook sker der ingenting (ingen kast) - kanalen kan vaere uprovisioneret", async () => {
  const collector = createEmailFailureCollector();
  collector.permanent.push({ dedupeKey: "day1:user-1", reason: "config-error", error: "x" });

  assert.equal(
    await postPermanentFailureAlert({ collector, sweep: "email-day1", now: NOW, sendWebhookFn: null, getOpsWebhookFn: null }),
    false
  );
  assert.equal(
    await postPermanentFailureAlert({
      collector, sweep: "email-day1", now: NOW,
      sendWebhookFn: async () => {}, getOpsWebhookFn: async () => null,
    }),
    false
  );
});

test("postOpsEmbed styrer @mention pr. kald", async () => {
  const posts = [];
  const wiring = {
    sendWebhookFn: async (url, payload) => posts.push(payload),
    getOpsWebhookFn: async () => "https://discord.example/ops",
  };
  const payload = { embeds: [{ title: "test" }] };

  process.env.DISCORD_OPS_MENTION = "123456789012345678";
  await postOpsEmbed({ payload, mention: true, ...wiring });
  await postOpsEmbed({ payload, mention: false, ...wiring });
  delete process.env.DISCORD_OPS_MENTION;

  assert.equal(posts[0].content, "<@123456789012345678>");
  assert.equal(posts[1].content, undefined);
});

test("dead-embedet naevner antal, aarsag og forsoeg", () => {
  const embed = buildRetryDeadEmbed({
    deadRows: [{ dedupeKey: "digest:user-1:2026-W37", reason: "resend-5xx", attempts: 8 }],
    now: NOW,
  });
  assert.ok(embed.embeds[0].title.includes("1 mail(s) opgivet"));
  assert.ok(embed.embeds[0].fields[0].value.includes("8 forsoeg"));
});

test("permanent-embedet navngiver sweepen", () => {
  const embed = buildPermanentFailureEmbed({
    sweep: "email-race-digest",
    failures: [{ dedupeKey: "digest:user-1:2026-W37", reason: "config-error", error: "bad address" }],
    now: NOW,
  });
  assert.ok(embed.embeds[0].description.includes("email-race-digest"));
});

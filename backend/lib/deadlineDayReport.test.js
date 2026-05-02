import test from "node:test";
import assert from "node:assert/strict";

import {
  WARNING_STEPS,
  buildWarningPayload,
  computeFinalWhistleReport,
  formatFinalWhistleEmbed,
  getDueWarningSteps,
  processDeadlineDayCron,
} from "./deadlineDayReport.js";

const HOUR = 60 * 60 * 1000;

test("getDueWarningSteps returns steps whose threshold has passed", () => {
  const closesAt = new Date("2026-05-10T20:00:00Z");
  const just24h = new Date(closesAt.getTime() - 24 * HOUR);
  const between2hAnd24h = new Date(closesAt.getTime() - 5 * HOUR);
  const inside30min = new Date(closesAt.getTime() - 10 * 60 * 1000);

  assert.deepEqual(
    getDueWarningSteps(closesAt.toISOString(), just24h).map(s => s.key),
    ["24h"]
  );
  assert.deepEqual(
    getDueWarningSteps(closesAt.toISOString(), between2hAnd24h).map(s => s.key),
    ["24h"]
  );
  assert.deepEqual(
    getDueWarningSteps(closesAt.toISOString(), inside30min).map(s => s.key).sort(),
    ["24h", "2h", "30min"].sort()
  );
});

test("getDueWarningSteps returns nothing once the window has closed", () => {
  const closesAt = new Date("2026-05-10T20:00:00Z");
  const after = new Date(closesAt.getTime() + 60 * 1000);
  assert.deepEqual(getDueWarningSteps(closesAt.toISOString(), after), []);
});

test("buildWarningPayload returns deadline_day_warning type", () => {
  const closesAt = new Date("2026-05-10T20:00:00Z").toISOString();
  for (const step of WARNING_STEPS) {
    const payload = buildWarningPayload(step, closesAt);
    assert.equal(payload.type, "deadline_day_warning");
    assert.equal(payload.title, step.title);
    assert.match(payload.message, /transfervinduet/i);
  }
});

test("computeFinalWhistleReport finds biggest deal across kinds", () => {
  const report = computeFinalWhistleReport({
    auctionDeals: [
      { amount: 800_000, riderName: "A. Rider", sellerName: "S1", buyerName: "B1", sellerTeamId: 1 },
    ],
    transferDeals: [
      { amount: 1_500_000, riderName: "B. Rider", sellerName: "S2", buyerName: "B2", sellerTeamId: 2 },
    ],
    bids: [],
    panicTeamIds: new Set(),
  });
  assert.equal(report.biggestDeal.kind, "transfer");
  assert.equal(report.biggestDeal.amount, 1_500_000);
  assert.equal(report.totalDeals, 2);
  assert.equal(report.totalSpent, 2_300_000);
});

test("computeFinalWhistleReport finds most active manager and panic deals", () => {
  const report = computeFinalWhistleReport({
    auctionDeals: [
      { amount: 100, riderName: "A", sellerName: "S1", buyerName: "B", sellerTeamId: 1 },
    ],
    transferDeals: [
      { amount: 200, riderName: "C", sellerName: "S2", buyerName: "B", sellerTeamId: 2 },
    ],
    bids: [
      { teamName: "Hold A" },
      { teamName: "Hold A" },
      { teamName: "Hold B" },
    ],
    panicTeamIds: new Set([2]),
  });
  assert.deepEqual(report.mostActiveManager, { teamName: "Hold A", bidCount: 2 });
  assert.equal(report.panicCount, 1);
  assert.equal(report.panicSamples[0].riderName, "C");
});

test("computeFinalWhistleReport handles empty input", () => {
  const report = computeFinalWhistleReport({});
  assert.equal(report.totalDeals, 0);
  assert.equal(report.totalSpent, 0);
  assert.equal(report.biggestDeal, null);
  assert.equal(report.mostActiveManager, null);
  assert.equal(report.panicCount, 0);
  assert.deepEqual(report.panicSamples, []);
});

test("formatFinalWhistleEmbed produces a valid Discord payload", () => {
  const payload = formatFinalWhistleEmbed({
    report: {
      totalDeals: 5,
      totalSpent: 3_000_000,
      biggestDeal: { kind: "transfer", amount: 1_500_000, riderName: "X", buyerName: "B", sellerName: "S", sellerTeamId: 1 },
      mostActiveManager: { teamName: "T", bidCount: 7 },
      panicCount: 1,
      panicSamples: [{ kind: "auction", amount: 50_000, riderName: "P", buyerName: "B", sellerName: "S", sellerTeamId: 1 }],
    },
    seasonNumber: 7,
    closedAt: "2026-05-10T20:00:00Z",
  });
  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Sæson 7/);
  const fieldNames = payload.embeds[0].fields.map(f => f.name);
  assert.ok(fieldNames.includes("Handler i alt"));
  assert.ok(fieldNames.some(n => n.includes("Største handel")));
  assert.ok(fieldNames.some(n => n.includes("Mest aktive manager")));
  assert.ok(fieldNames.some(n => n.includes("Panikhandler")));
});

// ── processDeadlineDayCron — orchestration tests ─────────────────────────────

function emptyQueryBuilder() {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    gte() { return builder; },
    lte() { return builder; },
    in() { return Promise.resolve({ data: [], error: null }); },
    not() { return Promise.resolve({ data: [], error: null }); },
    then(resolve) { resolve({ data: [], error: null }); },
  };
  return builder;
}

function transferWindowsTable({ window, claimedRows }) {
  return {
    select() {
      return {
        order: () => ({
          limit: () => ({
            single: () => Promise.resolve({ data: window, error: null }),
          }),
        }),
      };
    },
    update() {
      return {
        eq() { return this; },
        is() { return this; },
        select: () => Promise.resolve({ data: claimedRows, error: null }),
      };
    },
  };
}

test("processDeadlineDayCron sends warnings for due steps when window is open", async () => {
  const closesAt = new Date(Date.now() + 25 * 60 * 1000).toISOString(); // 25 min before close → 24h+2h+30min all due
  const supabase = {
    from(table) {
      if (table === "transfer_windows") {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({
                single: () => Promise.resolve({
                  data: { id: "w1", season_id: "s1", status: "open", closes_at: closesAt, created_at: new Date(Date.now() - HOUR).toISOString(), final_whistle_sent_at: null },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "teams") {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          not() { return Promise.resolve({ data: [{ id: "t1" }, { id: "t2" }], error: null }); },
        };
        return builder;
      }
      return { select: () => ({}) };
    },
  };

  const notified = [];
  const result = await processDeadlineDayCron({
    supabase,
    notifyTeamOwnerFn: async (args) => { notified.push(args); return { delivered: true }; },
    sendDiscordWebhookFn: async () => {},
    getDefaultWebhookFn: async () => null,
    now: new Date(),
  });

  assert.equal(result.whistleSent, false);
  // 3 steps × 2 teams = 6 calls
  assert.equal(notified.length, 6);
  assert.ok(notified.every(n => n.type === "deadline_day_warning"));
  assert.ok(notified.every(n => n.relatedId === "w1"));
});

test("processDeadlineDayCron skips warnings when window is closed and fires Final Whistle", async () => {
  const closedWindow = {
    id: "w1",
    season_id: "s1",
    status: "closed",
    closes_at: new Date(Date.now() - HOUR).toISOString(),
    created_at: new Date(Date.now() - 25 * HOUR).toISOString(),
    final_whistle_sent_at: null,
  };
  const supabase = {
    from(table) {
      if (table === "transfer_windows") {
        return transferWindowsTable({ window: closedWindow, claimedRows: [{ id: "w1", season_id: "s1" }] });
      }
      if (table === "seasons") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { season_number: 7 }, error: null }),
            }),
          }),
        };
      }
      return emptyQueryBuilder();
    },
  };

  const sentEmbeds = [];
  const result = await processDeadlineDayCron({
    supabase,
    notifyTeamOwnerFn: async () => { throw new Error("should not be called when window is closed"); },
    sendDiscordWebhookFn: async (url, payload) => { sentEmbeds.push({ url, payload }); },
    getDefaultWebhookFn: async () => "https://discord.test/webhook",
    now: new Date(),
  });

  assert.equal(result.whistleSent, true);
  assert.equal(sentEmbeds.length, 1);
  assert.match(sentEmbeds[0].payload.embeds[0].title, /Final Whistle/);
});

test("processDeadlineDayCron skips Final Whistle when already claimed", async () => {
  const closedWindow = {
    id: "w1",
    season_id: "s1",
    status: "closed",
    closes_at: new Date(Date.now() - HOUR).toISOString(),
    created_at: new Date(Date.now() - 25 * HOUR).toISOString(),
    final_whistle_sent_at: null,
  };
  const supabase = {
    from(table) {
      if (table === "transfer_windows") {
        return transferWindowsTable({ window: closedWindow, claimedRows: [] });
      }
      return emptyQueryBuilder();
    },
  };

  let sentCount = 0;
  const result = await processDeadlineDayCron({
    supabase,
    notifyTeamOwnerFn: async () => ({ delivered: true }),
    sendDiscordWebhookFn: async () => { sentCount += 1; },
    getDefaultWebhookFn: async () => "https://discord.test/webhook",
    now: new Date(),
  });

  assert.equal(result.whistleSent, false);
  assert.equal(sentCount, 0);
});

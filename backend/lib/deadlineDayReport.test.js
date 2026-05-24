import test from "node:test";
import assert from "node:assert/strict";

import {
  WARNING_STEPS,
  buildWarningPayload,
  computeFinalWhistleReport,
  fireAutoCloseIfDue,
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

test("computeFinalWhistleReport returnerer separat biggestAuction og biggestTransfer", () => {
  const report = computeFinalWhistleReport({
    auctionDeals: [
      { amount: 800_000, riderName: "A. Rider", sellerName: "S1", buyerName: "B1", sellerTeamId: 1 },
      { amount: 200_000, riderName: "Small", sellerName: "fri pulje", buyerName: "B1", sellerTeamId: null },
    ],
    transferDeals: [
      { amount: 1_500_000, riderName: "B. Rider", sellerName: "S2", buyerName: "B2", sellerTeamId: 2 },
    ],
    bids: [],
    panicTeamIds: new Set(),
  });
  assert.equal(report.biggestAuction.amount, 800_000);
  assert.equal(report.biggestAuction.riderName, "A. Rider");
  assert.equal(report.biggestTransfer.amount, 1_500_000);
  assert.equal(report.totalDeals, 3);
  assert.equal(report.totalAuctions, 2);
  assert.equal(report.totalTransfers, 1);
  assert.equal(report.totalSpent, 2_500_000);
});

test("computeFinalWhistleReport: biggestAuction kan være ai-pool deal (sellerTeamId=null)", () => {
  const report = computeFinalWhistleReport({
    auctionDeals: [
      { amount: 500_000, riderName: "Pool Rider", sellerName: "fri pulje", buyerName: "B1", sellerTeamId: null },
    ],
    transferDeals: [],
    bids: [],
    panicTeamIds: new Set(),
  });
  assert.equal(report.biggestAuction.amount, 500_000);
  assert.equal(report.biggestAuction.sellerTeamId, null);
  assert.equal(report.biggestTransfer, null);
  assert.equal(report.totalAuctions, 1);
  assert.equal(report.totalTransfers, 0);
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
  assert.equal(report.totalAuctions, 0);
  assert.equal(report.totalTransfers, 0);
  assert.equal(report.totalSpent, 0);
  assert.equal(report.biggestAuction, null);
  assert.equal(report.biggestTransfer, null);
  assert.equal(report.mostActiveManager, null);
  assert.equal(report.panicCount, 0);
  assert.deepEqual(report.panicSamples, []);
});

test("formatFinalWhistleEmbed produces a valid Discord payload med separate auction+transfer felter", () => {
  const payload = formatFinalWhistleEmbed({
    report: {
      totalDeals: 5,
      totalAuctions: 4,
      totalTransfers: 1,
      totalSpent: 3_000_000,
      biggestAuction: { kind: "auction", amount: 800_000, riderName: "A", buyerName: "B1", sellerName: "S1", sellerTeamId: 1 },
      biggestTransfer: { kind: "transfer", amount: 1_500_000, riderName: "X", buyerName: "B", sellerName: "S", sellerTeamId: 2 },
      mostActiveManager: { teamName: "T", bidCount: 7 },
      panicCount: 1,
      panicSamples: [{ kind: "auction", amount: 50_000, riderName: "P", buyerName: "B", sellerName: "S", sellerTeamId: 1 }],
    },
    seasonNumber: 7,
    closedAt: "2026-05-10T20:00:00Z",
  });
  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Sæson 7/);
  const fields = payload.embeds[0].fields;
  const fieldNames = fields.map(f => f.name);
  const handler = fields.find(f => f.name === "Handler i alt");
  assert.match(handler.value, /5 \(4 auktioner · 1 transfers\)/);
  assert.ok(fieldNames.some(n => n.includes("Største auktion")));
  assert.ok(fieldNames.some(n => n.includes("Største transfer")));
  assert.ok(fieldNames.some(n => n.includes("Mest aktive manager")));
  assert.ok(fieldNames.some(n => n.includes("Panikhandler")));
});

test("formatFinalWhistleEmbed: ai-pool auktion vises som 'fri pulje' (ingen seller-navn)", () => {
  const payload = formatFinalWhistleEmbed({
    report: {
      totalDeals: 1,
      totalAuctions: 1,
      totalTransfers: 0,
      totalSpent: 500_000,
      biggestAuction: { kind: "auction", amount: 500_000, riderName: "Pool Hero", buyerName: "Team A", sellerName: "–", sellerTeamId: null },
      biggestTransfer: null,
      mostActiveManager: null,
      panicCount: 0,
      panicSamples: [],
    },
    seasonNumber: 0,
    closedAt: "2026-05-21T21:00:00Z",
  });
  const auctionField = payload.embeds[0].fields.find(f => f.name.includes("Største auktion"));
  assert.match(auctionField.value, /fri pulje/);
  assert.match(auctionField.value, /Pool Hero/);
  // Transfer-felt findes ikke når der ikke er nogen transfer
  assert.equal(payload.embeds[0].fields.find(f => f.name.includes("Største transfer")), undefined);
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

test("processDeadlineDayCron: per-team try/catch isolerer fejl så øvrige teams stadig får warnings (Refs #608)", async () => {
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
          not() { return Promise.resolve({ data: [{ id: "t1" }, { id: "t2" }, { id: "t3" }, { id: "t4" }, { id: "t5" }], error: null }); },
        };
        return builder;
      }
      return { select: () => ({}) };
    },
  };

  const notified = [];
  const result = await processDeadlineDayCron({
    supabase,
    notifyTeamOwnerFn: async (args) => {
      if (args.teamId === "t3") {
        throw new Error("simulated transient failure for t3");
      }
      notified.push(args);
      return { delivered: true };
    },
    sendDiscordWebhookFn: async () => {},
    getDefaultWebhookFn: async () => null,
    now: new Date(),
  });

  // 3 steps × 5 teams = 15 attempts. 1 failing team × 3 steps = 3 errors. 4 successful teams × 3 steps = 12 delivered.
  assert.equal(result.warnings, 12, "teams t1, t2, t4, t5 fik warning for hvert af 3 steps");
  assert.equal(result.errors, 3, "team t3 fejlede på alle 3 steps men isolerede ikke de andre");
  assert.equal(notified.length, 12);
  assert.ok(!notified.some(n => n.teamId === "t3"), "team t3 må ikke have leveret warning");
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

// ── fireAutoCloseIfDue — pure auto-close tests ────────────────────────────────

function autoCloseSupabase({ updateResult = { data: [{ id: "w1" }], error: null }, capturePayload }) {
  return {
    from(table) {
      assert.equal(table, "transfer_windows");
      return {
        update(payload) {
          if (capturePayload) capturePayload(payload);
          return {
            eq() { return this; },
            select: () => Promise.resolve(updateResult),
          };
        },
      };
    },
  };
}

test("fireAutoCloseIfDue: no-op when window status is not open", async () => {
  const supabase = autoCloseSupabase({});
  const result = await fireAutoCloseIfDue({
    supabase,
    window: { id: "w1", status: "closed", closes_at: new Date(Date.now() - HOUR).toISOString() },
    now: new Date(),
  });
  assert.equal(result.autoClosed, false);
});

test("fireAutoCloseIfDue: no-op when closes_at is in the future", async () => {
  const supabase = autoCloseSupabase({});
  const result = await fireAutoCloseIfDue({
    supabase,
    window: { id: "w1", status: "open", closes_at: new Date(Date.now() + HOUR).toISOString() },
    now: new Date(),
  });
  assert.equal(result.autoClosed, false);
});

test("fireAutoCloseIfDue: no-op when closes_at is null", async () => {
  const supabase = autoCloseSupabase({});
  const result = await fireAutoCloseIfDue({
    supabase,
    window: { id: "w1", status: "open", closes_at: null },
    now: new Date(),
  });
  assert.equal(result.autoClosed, false);
});

test("fireAutoCloseIfDue: flips status to closed when closes_at has passed", async () => {
  let captured = null;
  const supabase = autoCloseSupabase({ capturePayload: (p) => { captured = p; } });
  const now = new Date();
  const result = await fireAutoCloseIfDue({
    supabase,
    window: { id: "w1", status: "open", closes_at: new Date(now.getTime() - HOUR).toISOString() },
    now,
  });
  assert.equal(result.autoClosed, true);
  assert.equal(result.windowId, "w1");
  assert.equal(captured.status, "closed");
  assert.equal(captured.closed_at, now.toISOString());
});

test("fireAutoCloseIfDue: returns autoClosed=false when atomic claim returns empty (race-safe)", async () => {
  const supabase = autoCloseSupabase({ updateResult: { data: [], error: null } });
  const result = await fireAutoCloseIfDue({
    supabase,
    window: { id: "w1", status: "open", closes_at: new Date(Date.now() - HOUR).toISOString() },
    now: new Date(),
  });
  assert.equal(result.autoClosed, false);
});

test("processDeadlineDayCron: auto-closes window AND fires Final Whistle in same tick when closes_at passed", async () => {
  const closesAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
  let statusFlipped = false;
  const supabase = {
    from(table) {
      if (table === "transfer_windows") {
        return {
          select() {
            return {
              order: () => ({
                limit: () => ({
                  single: () => Promise.resolve({
                    data: { id: "w1", season_id: "s1", status: "open", closes_at: closesAt, created_at: new Date(Date.now() - 25 * HOUR).toISOString(), final_whistle_sent_at: null },
                    error: null,
                  }),
                }),
              }),
            };
          },
          update(payload) {
            if (payload.status === "closed") statusFlipped = true;
            return {
              eq() { return this; },
              is() { return this; },
              select: () => Promise.resolve({ data: [{ id: "w1", season_id: "s1" }], error: null }),
            };
          },
        };
      }
      if (table === "seasons") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { season_number: 0 }, error: null }) }) }) };
      }
      return emptyQueryBuilder();
    },
  };

  const sentEmbeds = [];
  const result = await processDeadlineDayCron({
    supabase,
    notifyTeamOwnerFn: async () => ({ delivered: true }),
    sendDiscordWebhookFn: async (url, payload) => { sentEmbeds.push(payload); },
    getDefaultWebhookFn: async () => "https://discord.test/webhook",
    now: new Date(),
  });

  assert.equal(result.autoClosed, true);
  assert.equal(result.whistleSent, true);
  assert.equal(statusFlipped, true);
  assert.equal(sentEmbeds.length, 1);
});

test("processDeadlineDayCron: racing-window (closes_at=null + closed_at=null) springes helt over (regression: sæson-loop 2026-05-21)", async () => {
  // Racing-vindue: nyfødt fra transitionToNextSeason med status='closed' men ingen
  // deadline-historik. Cron'en MÅ IKKE claime final_whistle_sent_at på det, ellers
  // matcher auto-transition cron'en det 5 min senere og fyrer endnu en transition.
  const racingWindow = {
    id: "racing",
    season_id: "s2",
    status: "closed",
    closes_at: null,
    closed_at: null,
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    final_whistle_sent_at: null,
  };
  let updateAttempted = false;
  const supabase = {
    from(table) {
      if (table === "transfer_windows") {
        return {
          select: () => ({
            order: () => ({
              limit: () => ({
                single: () => Promise.resolve({ data: racingWindow, error: null }),
              }),
            }),
          }),
          update() {
            updateAttempted = true;
            return { eq() { return this; }, is() { return this; }, select: () => Promise.resolve({ data: [], error: null }) };
          },
        };
      }
      return emptyQueryBuilder();
    },
  };

  let webhookSent = false;
  const result = await processDeadlineDayCron({
    supabase,
    notifyTeamOwnerFn: async () => { throw new Error("must not notify on racing-window"); },
    sendDiscordWebhookFn: async () => { webhookSent = true; },
    getDefaultWebhookFn: async () => "https://discord.test/webhook",
    now: new Date(),
  });

  assert.equal(result.whistleSent, false);
  assert.equal(result.warnings, 0);
  assert.equal(result.autoClosed, false);
  assert.equal(updateAttempted, false, "racing-window må aldrig opdateres af deadline-cron");
  assert.equal(webhookSent, false);
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

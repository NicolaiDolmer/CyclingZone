import test from "node:test";
import assert from "node:assert/strict";

import { processDailySeasonCountCheck } from "./dailySeasonCountCheck.js";

function createMockSupabase({ adminLogRows = [] } = {}) {
  return {
    from(table) {
      assert.equal(table, "admin_log");
      let filters = {};
      let orderBy = null;
      const builder = {
        select(_cols, _opts) { return builder; },
        eq(col, val) { filters[col] = val; return builder; },
        gte(col, val) { filters[`__gte_${col}`] = val; return builder; },
        order(col, opts) { orderBy = { col, asc: opts?.ascending ?? true }; return builder; },
        then(resolve) {
          const filtered = adminLogRows.filter((row) => {
            for (const [k, v] of Object.entries(filters)) {
              if (k.startsWith("__gte_")) {
                const realCol = k.slice("__gte_".length);
                if (!(row[realCol] >= v)) return false;
              } else if (row[k] !== v) {
                return false;
              }
            }
            return true;
          });
          const sorted = orderBy
            ? [...filtered].sort((a, b) => {
                const av = a[orderBy.col]; const bv = b[orderBy.col];
                if (av === bv) return 0;
                return orderBy.asc ? (av > bv ? 1 : -1) : (av > bv ? -1 : 1);
              })
            : filtered;
          return resolve({ data: sorted, error: null, count: sorted.length });
        },
      };
      return builder;
    },
  };
}

test("processDailySeasonCountCheck — 0 transitions: ingen alert", async () => {
  const supabase = createMockSupabase({ adminLogRows: [] });
  const result = await processDailySeasonCountCheck({
    supabase,
    now: new Date("2026-05-22T12:00:00Z"),
    sendWebhookFn: async () => { throw new Error("må ikke kaldes"); },
    getDefaultWebhookFn: async () => "https://discord.example/webhook",
    captureExceptionFn: () => { throw new Error("må ikke kaldes"); },
  });
  assert.equal(result.transitionCount, 0);
  assert.equal(result.alerted, false);
});

test("processDailySeasonCountCheck — 1 transition: ingen alert (normal)", async () => {
  const supabase = createMockSupabase({
    adminLogRows: [{
      id: "log-1",
      action_type: "season_transition",
      created_at: "2026-05-22T08:00:00Z",
      meta: { from_season_number: 1, to_season_number: 2 },
    }],
  });
  const result = await processDailySeasonCountCheck({
    supabase,
    now: new Date("2026-05-22T12:00:00Z"),
    sendWebhookFn: async () => { throw new Error("må ikke kaldes"); },
    getDefaultWebhookFn: async () => "https://discord.example/webhook",
    captureExceptionFn: () => { throw new Error("må ikke kaldes"); },
  });
  assert.equal(result.transitionCount, 1);
  assert.equal(result.alerted, false);
});

test("processDailySeasonCountCheck — 2+ transitions: alert til Discord + Sentry", async () => {
  const webhookCalls = [];
  const sentryCalls = [];
  const supabase = createMockSupabase({
    adminLogRows: [
      { id: "log-1", action_type: "season_transition", created_at: "2026-05-22T01:00:00Z",
        meta: { from_season_number: 1, to_season_number: 2 } },
      { id: "log-2", action_type: "season_transition", created_at: "2026-05-22T01:10:00Z",
        meta: { from_season_number: 2, to_season_number: 3 } },
      { id: "log-3", action_type: "season_transition", created_at: "2026-05-22T01:20:00Z",
        meta: { from_season_number: 3, to_season_number: 4 } },
    ],
  });
  const result = await processDailySeasonCountCheck({
    supabase,
    now: new Date("2026-05-22T12:00:00Z"),
    sendWebhookFn: async (url, payload) => { webhookCalls.push({ url, payload }); },
    getDefaultWebhookFn: async () => "https://discord.example/webhook",
    captureExceptionFn: (err, ctx) => { sentryCalls.push({ err, ctx }); },
  });
  assert.equal(result.transitionCount, 3);
  assert.equal(result.alerted, true);
  assert.equal(webhookCalls.length, 1);
  assert.equal(webhookCalls[0].url, "https://discord.example/webhook");
  assert.match(webhookCalls[0].payload.embeds[0].title, /Unusual season-transition rate/);
  assert.match(webhookCalls[0].payload.embeds[0].description, /3 sæson-transitions/);
  assert.equal(sentryCalls.length, 1);
  assert.deepEqual(sentryCalls[0].ctx.tags, { cron: "daily-season-count-check" });
});

test("processDailySeasonCountCheck — alert udelades hvis ingen webhook konfigureret (men Sentry stadig fyres)", async () => {
  const sentryCalls = [];
  const supabase = createMockSupabase({
    adminLogRows: [
      { id: "log-1", action_type: "season_transition", created_at: "2026-05-22T01:00:00Z", meta: {} },
      { id: "log-2", action_type: "season_transition", created_at: "2026-05-22T01:10:00Z", meta: {} },
    ],
  });
  const result = await processDailySeasonCountCheck({
    supabase,
    now: new Date("2026-05-22T12:00:00Z"),
    sendWebhookFn: async () => { throw new Error("må ikke kaldes uden URL"); },
    getDefaultWebhookFn: async () => null,
    captureExceptionFn: (err, ctx) => { sentryCalls.push({ err, ctx }); },
  });
  assert.equal(result.alerted, true);
  assert.equal(sentryCalls.length, 1);
});

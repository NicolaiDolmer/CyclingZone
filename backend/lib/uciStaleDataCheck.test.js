import test from "node:test";
import assert from "node:assert/strict";

import { processUciStaleDataCheck, UCI_STALE_THRESHOLD_DAYS } from "./uciStaleDataCheck.js";

function createMockSupabase({ historyRows = [], error = null } = {}) {
  return {
    from(table) {
      assert.equal(table, "rider_uci_history");
      let orderBy = null;
      let limitCount = null;
      const builder = {
        select(cols) {
          assert.equal(cols, "synced_at");
          return builder;
        },
        order(col, opts) {
          orderBy = { col, asc: opts?.ascending ?? true };
          return builder;
        },
        limit(count) {
          limitCount = count;
          return builder;
        },
        then(resolve) {
          if (error) return resolve({ data: null, error });
          let rows = [...historyRows];
          if (orderBy) {
            rows.sort((a, b) => {
              const av = a[orderBy.col];
              const bv = b[orderBy.col];
              if (av === bv) return 0;
              return orderBy.asc ? (av > bv ? 1 : -1) : av > bv ? -1 : 1;
            });
          }
          if (limitCount !== null) rows = rows.slice(0, limitCount);
          return resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
}

test("processUciStaleDataCheck — fresh latest synced_at: ingen alert", async () => {
  const supabase = createMockSupabase({
    historyRows: [{ synced_at: "2026-05-22T12:00:00Z" }],
  });
  const result = await processUciStaleDataCheck({
    supabase,
    now: new Date("2026-05-28T12:00:00Z"),
    sendWebhookFn: async () => {
      throw new Error("må ikke kaldes");
    },
    getDefaultWebhookFn: async () => "https://discord.example/webhook",
    captureExceptionFn: () => {
      throw new Error("må ikke kaldes");
    },
  });

  assert.equal(result.alerted, false);
  assert.equal(result.latestSyncedAt, "2026-05-22T12:00:00Z");
  assert.equal(Math.round(result.ageDays), 6);
});

test("processUciStaleDataCheck — exactly threshold age is still OK", async () => {
  const supabase = createMockSupabase({
    historyRows: [{ synced_at: "2026-05-20T12:00:00Z" }],
  });
  const result = await processUciStaleDataCheck({
    supabase,
    now: new Date("2026-05-28T12:00:00Z"),
    sendWebhookFn: async () => {
      throw new Error("må ikke kaldes");
    },
    getDefaultWebhookFn: async () => "https://discord.example/webhook",
    captureExceptionFn: () => {
      throw new Error("må ikke kaldes");
    },
  });

  assert.equal(result.alerted, false);
  assert.equal(result.ageDays, UCI_STALE_THRESHOLD_DAYS);
});

test("processUciStaleDataCheck — older than threshold alerts Discord + Sentry", async () => {
  const webhookCalls = [];
  const sentryCalls = [];
  const supabase = createMockSupabase({
    historyRows: [{ synced_at: "2026-05-19T11:59:59Z" }, { synced_at: "2026-05-10T12:00:00Z" }],
  });
  const result = await processUciStaleDataCheck({
    supabase,
    now: new Date("2026-05-28T12:00:00Z"),
    sendWebhookFn: async (url, payload) => {
      webhookCalls.push({ url, payload });
    },
    getDefaultWebhookFn: async () => "https://discord.example/webhook",
    captureExceptionFn: (err, ctx) => {
      sentryCalls.push({ err, ctx });
    },
  });

  assert.equal(result.alerted, true);
  assert.equal(result.latestSyncedAt, "2026-05-19T11:59:59Z");
  assert.equal(webhookCalls.length, 1);
  assert.match(webhookCalls[0].payload.embeds[0].title, /UCI data stale/);
  assert.match(webhookCalls[0].payload.embeds[0].description, /Forventet friskere end 8 dage/);
  assert.equal(sentryCalls.length, 1);
  assert.deepEqual(sentryCalls[0].ctx.tags, { cron: "uci-stale-data-check" });
  assert.equal(sentryCalls[0].ctx.extra.latestSyncedAt, "2026-05-19T11:59:59Z");
});

test("processUciStaleDataCheck — no history rows alerts without crashing when webhook is missing", async () => {
  const sentryCalls = [];
  const supabase = createMockSupabase({ historyRows: [] });
  const result = await processUciStaleDataCheck({
    supabase,
    now: new Date("2026-05-28T12:00:00Z"),
    sendWebhookFn: async () => {
      throw new Error("må ikke kaldes uden URL");
    },
    getDefaultWebhookFn: async () => null,
    captureExceptionFn: (err, ctx) => {
      sentryCalls.push({ err, ctx });
    },
  });

  assert.equal(result.alerted, true);
  assert.equal(result.latestSyncedAt, null);
  assert.equal(result.ageDays, null);
  assert.equal(sentryCalls.length, 1);
  assert.match(sentryCalls[0].err.message, /ingen synced_at-rækker/);
});

test("processUciStaleDataCheck — query error is surfaced to trackedTick", async () => {
  const supabase = createMockSupabase({ error: { message: "permission denied" } });
  await assert.rejects(
    () => processUciStaleDataCheck({ supabase }),
    /rider_uci_history query failed: permission denied/
  );
});

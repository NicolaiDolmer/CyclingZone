import test from "node:test";
import assert from "node:assert/strict";

import {
  enqueueDm,
  processDmOutboxDrain,
  nextAttemptDelayMs,
  MAX_OUTBOX_ATTEMPTS,
} from "./discordDmOutbox.js";

// ── Supabase-mock (chainable, registrerer writes) ────────────────────────────

function makeSupabaseMock({ pendingRows = [], insertError = null, selectError = null } = {}) {
  const writes = { inserts: [], updates: [], deletes: [] };
  const supabase = {
    from(table) {
      assert.equal(table, "discord_dm_outbox");
      return {
        insert(row) {
          writes.inserts.push(row);
          return Promise.resolve({ error: insertError });
        },
        select() {
          const builder = {
            eq: () => builder,
            lte: () => builder,
            order: () => builder,
            limit: () =>
              Promise.resolve(
                selectError ? { data: null, error: selectError } : { data: pendingRows, error: null }
              ),
          };
          return builder;
        },
        update(values) {
          return {
            eq: (col, id) => {
              writes.updates.push({ id, values });
              return Promise.resolve({ error: null });
            },
          };
        },
        delete() {
          return {
            eq: (col, id) => {
              writes.deletes.push(id);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { supabase, writes };
}

const NOW = new Date("2026-06-10T12:00:00Z");

// ── nextAttemptDelayMs ───────────────────────────────────────────────────────

test("nextAttemptDelayMs — eksponentiel backoff, sidste værdi genbruges", () => {
  assert.equal(nextAttemptDelayMs(1), 5 * 60 * 1000);
  assert.equal(nextAttemptDelayMs(2), 15 * 60 * 1000);
  assert.equal(nextAttemptDelayMs(3), 60 * 60 * 1000);
  // Ud over skemaet → genbrug sidste (8h)
  assert.equal(nextAttemptDelayMs(99), 8 * 60 * 60 * 1000);
  // Defensivt: 0/negativ → første trin
  assert.equal(nextAttemptDelayMs(0), 5 * 60 * 1000);
});

// ── enqueueDm ────────────────────────────────────────────────────────────────

test("enqueueDm — insert med pending-status, attempts=1 og backoff-tidspunkt", async () => {
  const { supabase, writes } = makeSupabaseMock();
  const result = await enqueueDm({
    supabase,
    discordId: "u1",
    payload: { embeds: [] },
    lastStatus: 429,
    lastError: "openDm 429: rate limited",
    now: NOW,
  });
  assert.equal(result.enqueued, true);
  assert.equal(writes.inserts.length, 1);
  const row = writes.inserts[0];
  assert.equal(row.discord_id, "u1");
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.equal(row.last_status, 429);
  assert.equal(row.next_attempt_at, new Date(NOW.getTime() + 5 * 60 * 1000).toISOString());
});

test("enqueueDm — insert-fejl kaster IKKE, men captures (outbox må ikke selv fejle tavst)", async () => {
  const { supabase } = makeSupabaseMock({ insertError: { message: "permission denied" } });
  const captures = [];
  const result = await enqueueDm({
    supabase,
    discordId: "u1",
    payload: {},
    captureExceptionFn: (err) => captures.push(err),
    now: NOW,
  });
  assert.equal(result.enqueued, false);
  assert.equal(captures.length, 1);
  assert.match(captures[0].message, /permission denied/);
});

// ── processDmOutboxDrain ─────────────────────────────────────────────────────

function makeDrainDeps() {
  const webhookCalls = [];
  const captures = [];
  return {
    sendWebhookFn: async (url, payload) => webhookCalls.push({ url, payload }),
    getDefaultWebhookFn: async () => "https://discord.com/api/webhooks/abc/def",
    captureExceptionFn: (err, ctx) => captures.push({ err, ctx }),
    now: NOW,
    _webhookCalls: webhookCalls,
    _captures: captures,
  };
}

test("drain — tom outbox: ingenting sker", async () => {
  const { supabase } = makeSupabaseMock({ pendingRows: [] });
  const deps = makeDrainDeps();
  const result = await processDmOutboxDrain({
    supabase,
    deliverFn: async () => ({ ok: true }),
    ...deps,
  });
  assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0 });
  assert.equal(deps._webhookCalls.length, 0);
});

test("drain — succesfuld levering sletter rækken", async () => {
  const { supabase, writes } = makeSupabaseMock({
    pendingRows: [{ id: "r1", discord_id: "u1", payload: { a: 1 }, attempts: 1 }],
  });
  const deps = makeDrainDeps();
  const delivered = [];
  const result = await processDmOutboxDrain({
    supabase,
    deliverFn: async ({ discordId, payload }) => {
      delivered.push({ discordId, payload });
      return { ok: true, status: 200 };
    },
    ...deps,
  });
  assert.equal(result.sent, 1);
  assert.deepEqual(writes.deletes, ["r1"]);
  assert.deepEqual(delivered, [{ discordId: "u1", payload: { a: 1 } }]);
  assert.equal(deps._webhookCalls.length, 0);
});

test("drain — retryable fejl replanlægger med backoff og bumper attempts", async () => {
  const { supabase, writes } = makeSupabaseMock({
    pendingRows: [{ id: "r1", discord_id: "u1", payload: {}, attempts: 2 }],
  });
  const deps = makeDrainDeps();
  const result = await processDmOutboxDrain({
    supabase,
    deliverFn: async () => ({
      ok: false,
      status: 429,
      failure: { kind: "retryable", reason: "rate-limited" },
      error: "openDm 429: rate limited",
    }),
    ...deps,
  });
  assert.equal(result.rescheduled, 1);
  assert.equal(result.dead, 0);
  assert.equal(writes.updates.length, 1);
  const update = writes.updates[0].values;
  assert.equal(update.attempts, 3);
  assert.equal(update.last_status, 429);
  // attempts=3 → +1h
  assert.equal(update.next_attempt_at, new Date(NOW.getTime() + 60 * 60 * 1000).toISOString());
  assert.equal(deps._webhookCalls.length, 0);
});

test("drain — permanent fejl markerer dead + ÉN aggregeret alarm (webhook + Sentry)", async () => {
  const { supabase, writes } = makeSupabaseMock({
    pendingRows: [
      { id: "r1", discord_id: "u1", payload: {}, attempts: 1 },
      { id: "r2", discord_id: "u2", payload: {}, attempts: 1 },
    ],
  });
  const deps = makeDrainDeps();
  const result = await processDmOutboxDrain({
    supabase,
    deliverFn: async () => ({
      ok: false,
      status: 401,
      failure: { kind: "permanent", reason: "token-invalid" },
      error: "openDm 401: Unauthorized",
    }),
    ...deps,
  });
  assert.equal(result.dead, 2);
  assert.equal(writes.updates.length, 2);
  assert.equal(writes.updates[0].values.status, "dead");
  assert.equal(writes.updates[0].values.dead_at, NOW.toISOString());
  // Forward-guard: præcis ÉN webhook + ÉN capture pr. drain-run, ikke pr. række
  assert.equal(deps._webhookCalls.length, 1);
  assert.match(deps._webhookCalls[0].payload.embeds[0].title, /DM/i);
  assert.equal(deps._captures.length, 1);
  assert.equal(deps._captures[0].ctx.tags.component, "discord-dm-outbox");
});

test("drain — opbrugte attempts markerer dead selv ved retryable fejl", async () => {
  const { supabase, writes } = makeSupabaseMock({
    pendingRows: [
      { id: "r1", discord_id: "u1", payload: {}, attempts: MAX_OUTBOX_ATTEMPTS - 1 },
    ],
  });
  const deps = makeDrainDeps();
  const result = await processDmOutboxDrain({
    supabase,
    deliverFn: async () => ({
      ok: false,
      status: 429,
      failure: { kind: "retryable", reason: "rate-limited" },
      error: "openDm 429",
    }),
    ...deps,
  });
  assert.equal(result.dead, 1);
  assert.equal(result.rescheduled, 0);
  assert.equal(writes.updates[0].values.status, "dead");
  assert.equal(deps._webhookCalls.length, 1);
});

test("drain — select-fejl captures og returnerer tomt (cron må ikke crashe)", async () => {
  const { supabase } = makeSupabaseMock({ selectError: { message: "connection refused" } });
  const deps = makeDrainDeps();
  const result = await processDmOutboxDrain({
    supabase,
    deliverFn: async () => ({ ok: true }),
    ...deps,
  });
  assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0 });
  assert.equal(deps._captures.length, 1);
  assert.match(deps._captures[0].err.message, /connection refused/);
});

test("drain — ingen webhook konfigureret: Sentry-capture sker stadig ved dead", async () => {
  const { supabase } = makeSupabaseMock({
    pendingRows: [{ id: "r1", discord_id: "u1", payload: {}, attempts: 1 }],
  });
  const deps = makeDrainDeps();
  deps.getDefaultWebhookFn = async () => null;
  await processDmOutboxDrain({
    supabase,
    deliverFn: async () => ({
      ok: false,
      status: 400,
      failure: { kind: "permanent", reason: "bad-request" },
      error: "openDm 400",
    }),
    ...deps,
  });
  assert.equal(deps._webhookCalls.length, 0);
  assert.equal(deps._captures.length, 1);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  enqueueWebhook,
  processWebhookOutboxDrain,
  nextAttemptDelayMs,
  MAX_OUTBOX_ATTEMPTS,
} from "./discordWebhookOutbox.js";

// ── Supabase-mock (chainable, registrerer writes) ────────────────────────────
// Spejler discordDmOutbox.test.js — samme kontrakt, anden tabel.

function makeSupabaseMock({ pendingRows = [], insertError = null, selectError = null } = {}) {
  const writes = { inserts: [], updates: [], deletes: [] };
  const supabase = {
    from(table) {
      assert.equal(table, "discord_webhook_outbox");
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

const NOW = new Date("2026-08-10T12:00:00Z");
const WEBHOOK = "https://discord.com/api/webhooks/1/auctions";

// ── nextAttemptDelayMs ───────────────────────────────────────────────────────

test("nextAttemptDelayMs — eksponentiel backoff, sidste værdi genbruges", () => {
  assert.equal(nextAttemptDelayMs(1), 5 * 60 * 1000);
  assert.equal(nextAttemptDelayMs(2), 15 * 60 * 1000);
  assert.equal(nextAttemptDelayMs(3), 60 * 60 * 1000);
  assert.equal(nextAttemptDelayMs(99), 8 * 60 * 60 * 1000);
  assert.equal(nextAttemptDelayMs(0), 5 * 60 * 1000);
});

// Kerne-kravet fra #3545: horisonten skal måles i TIMER, ikke sekunder — et
// Discord-5xx-udfald varer minutter, og de ~3 sek inline-retry kunne pr.
// konstruktion ikke overleve det.
test("samlet retry-horisont dækker et flertimers Discord-udfald", () => {
  let total = 0;
  for (let attempt = 1; attempt < MAX_OUTBOX_ATTEMPTS; attempt++) {
    total += nextAttemptDelayMs(attempt);
  }
  assert.ok(
    total >= 24 * 60 * 60 * 1000,
    `forventede ≥24t samlet horisont, fik ${Math.round(total / 3600000)}t`
  );
});

// ── enqueueWebhook ───────────────────────────────────────────────────────────

test("enqueueWebhook — insert med pending-status, attempts=1 og backoff-tidspunkt", async () => {
  const { supabase, writes } = makeSupabaseMock();
  const result = await enqueueWebhook({
    supabase,
    webhookUrl: WEBHOOK,
    payload: { embeds: [{ title: "New Auction" }] },
    lastStatus: 503,
    lastError: "503: service unavailable",
    now: NOW,
  });

  assert.equal(result.enqueued, true);
  assert.equal(writes.inserts.length, 1);
  const row = writes.inserts[0];
  assert.equal(row.webhook_url, WEBHOOK);
  assert.deepEqual(row.payload, { embeds: [{ title: "New Auction" }] });
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.equal(row.last_status, 503);
  assert.equal(row.next_attempt_at, new Date(NOW.getTime() + 5 * 60 * 1000).toISOString());
});

test("enqueueWebhook — insert-fejl kaster IKKE, men captures (outbox må ikke selv fejle tavst)", async () => {
  const { supabase } = makeSupabaseMock({ insertError: { message: "permission denied" } });
  const captures = [];
  const result = await enqueueWebhook({
    supabase,
    webhookUrl: WEBHOOK,
    payload: {},
    captureExceptionFn: (err) => captures.push(err),
    now: NOW,
  });
  assert.equal(result.enqueued, false);
  assert.equal(captures.length, 1);
  assert.match(captures[0].message, /permission denied/);
});

test("enqueueWebhook — uden supabase-klient returneres enqueued:false uden at kaste", async () => {
  const result = await enqueueWebhook({ supabase: null, webhookUrl: WEBHOOK, payload: {}, now: NOW });
  assert.equal(result.enqueued, false);
});

// ── processWebhookOutboxDrain ────────────────────────────────────────────────

function makeDrainDeps() {
  const webhookCalls = [];
  const captures = [];
  return {
    sendWebhookFn: async (url, payload) => webhookCalls.push({ url, payload }),
    getAlarmWebhookFn: async () => "https://discord.com/api/webhooks/ops/alarm",
    captureExceptionFn: (err, ctx) => captures.push({ err, ctx }),
    now: NOW,
    _webhookCalls: webhookCalls,
    _captures: captures,
  };
}

test("drain — tom outbox: ingen leverings-forsøg, ingen alarm", async () => {
  const { supabase } = makeSupabaseMock({ pendingRows: [] });
  const deps = makeDrainDeps();
  const result = await processWebhookOutboxDrain({
    supabase,
    deliverFn: async () => assert.fail("deliverFn må ikke kaldes uden pending-rækker"),
    ...deps,
  });
  assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0 });
  assert.equal(deps._captures.length, 0);
});

// Selve #3545-genopretningen: beskeden der blev tabt 7/8 bliver leveret nu.
test("drain — succesfuld genlevering sletter rækken (auktions-annonceringen når frem)", async () => {
  const { supabase, writes } = makeSupabaseMock({
    pendingRows: [{ id: "row-1", webhook_url: WEBHOOK, payload: { embeds: [{ title: "New Auction" }] }, attempts: 1 }],
  });
  const deps = makeDrainDeps();
  const delivered = [];

  const result = await processWebhookOutboxDrain({
    supabase,
    deliverFn: async ({ webhookUrl, payload }) => {
      delivered.push({ webhookUrl, payload });
      return { ok: true, status: 204 };
    },
    ...deps,
  });

  assert.deepEqual(result, { processed: 1, sent: 1, rescheduled: 0, dead: 0 });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].webhookUrl, WEBHOOK);
  assert.deepEqual(delivered[0].payload, { embeds: [{ title: "New Auction" }] });
  assert.deepEqual(writes.deletes, ["row-1"]);
  assert.equal(writes.updates.length, 0);
  assert.equal(deps._captures.length, 0, "en vellykket genlevering må ikke alarmere");
});

test("drain — fortsat 5xx replanlægges med voksende backoff, IKKE dead", async () => {
  const { supabase, writes } = makeSupabaseMock({
    pendingRows: [{ id: "row-1", webhook_url: WEBHOOK, payload: {}, attempts: 2 }],
  });
  const deps = makeDrainDeps();

  const result = await processWebhookOutboxDrain({
    supabase,
    deliverFn: async () => ({
      ok: false,
      status: 503,
      failure: { kind: "retryable", reason: "discord-5xx" },
      error: "503: service unavailable",
    }),
    ...deps,
  });

  assert.deepEqual(result, { processed: 1, sent: 0, rescheduled: 1, dead: 0 });
  assert.equal(writes.updates.length, 1);
  const { values } = writes.updates[0];
  assert.equal(values.attempts, 3);
  assert.equal(values.last_status, 503);
  assert.equal(values.status, undefined, "må ikke markeres dead endnu");
  assert.equal(
    values.next_attempt_at,
    new Date(NOW.getTime() + nextAttemptDelayMs(3)).toISOString()
  );
  assert.equal(deps._captures.length, 0, "må først alarmere når beskeden REELT er tabt");
});

// #2395-klassen: et slettet/fejlkonfigureret webhook er permanent — der er
// ingen mening i at bruge 27 timer på at prøve igen.
test("drain — permanent fejl (dødt webhook) dør med det samme, uanset attempts", async () => {
  const { supabase, writes } = makeSupabaseMock({
    pendingRows: [{ id: "row-1", webhook_url: WEBHOOK, payload: {}, attempts: 1 }],
  });
  const deps = makeDrainDeps();

  const result = await processWebhookOutboxDrain({
    supabase,
    deliverFn: async () => ({
      ok: false,
      status: 404,
      failure: { kind: "permanent", reason: "config-error" },
      error: "404: Unknown Webhook",
    }),
    ...deps,
  });

  assert.deepEqual(result, { processed: 1, sent: 0, rescheduled: 0, dead: 1 });
  assert.equal(writes.updates[0].values.status, "dead");
  assert.equal(writes.updates[0].values.dead_at, NOW.toISOString());
  assert.equal(deps._captures.length, 1);
  assert.equal(deps._webhookCalls.length, 1, "dead → ops-alarm");
});

test("drain — opbrugte forsøg → dead + ÉN aggregeret alarm for hele runden", async () => {
  const { supabase, writes } = makeSupabaseMock({
    pendingRows: [
      { id: "row-1", webhook_url: WEBHOOK, payload: {}, attempts: MAX_OUTBOX_ATTEMPTS - 1 },
      { id: "row-2", webhook_url: WEBHOOK, payload: {}, attempts: MAX_OUTBOX_ATTEMPTS - 1 },
    ],
  });
  const deps = makeDrainDeps();

  const result = await processWebhookOutboxDrain({
    supabase,
    deliverFn: async () => ({
      ok: false,
      status: 500,
      failure: { kind: "retryable", reason: "discord-5xx" },
      error: "500: internal",
    }),
    ...deps,
  });

  assert.deepEqual(result, { processed: 2, sent: 0, rescheduled: 0, dead: 2 });
  assert.equal(writes.updates.filter((u) => u.values.status === "dead").length, 2);
  assert.equal(deps._webhookCalls.length, 1, "én samlet alarm pr. drain-run, ikke én pr. række");
  assert.equal(deps._captures.length, 1);
  assert.match(deps._captures[0].err.message, /2 besked\(er\) markeret dead/);
});

test("drain — select-fejl captures og returnerer nul-resultat i stedet for at kaste", async () => {
  const { supabase } = makeSupabaseMock({ selectError: { message: "connection reset" } });
  const deps = makeDrainDeps();

  const result = await processWebhookOutboxDrain({
    supabase,
    deliverFn: async () => assert.fail("deliverFn må ikke kaldes når select fejler"),
    ...deps,
  });

  assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0 });
  assert.equal(deps._captures.length, 1);
  assert.match(deps._captures[0].err.message, /drain-select fejlede/);
});

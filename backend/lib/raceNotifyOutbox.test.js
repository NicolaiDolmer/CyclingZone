import test from "node:test";
import assert from "node:assert/strict";

import {
  channelKeyForWebhookUrl,
  deliverRaceResultNotify,
  enqueueRaceNotify,
  isMissingTableError,
  leaseStillHeld,
  nextAttemptDelayMs,
  processRaceNotifyOutboxDrain,
  LEASE_MS,
  MAX_NOTIFY_ATTEMPTS,
  RACE_NOTIFY_OUTBOX_TABLE,
  RACE_RESULT_MESSAGE_TYPE,
} from "./raceNotifyOutbox.js";

// ─── In-memory Supabase-stub ─────────────────────────────────────────────────
// Rigere end discordWebhookOutbox.test.js's stub, og med vilje: #3624's kontrakt
// handler om RAEKKEFOELGE og SAMTIDIGHED (unik noegle, betinget claim, lease), og
// den kan ikke bevises mod en stub der bare returnerer et fast array. Denne
// holder rigtige raekker og genevaluerer hver update's filtre paa kalde-
// tidspunktet — praecis den egenskab i Postgres (WHERE genevalueres efter
// raekke-laasen) som claim'en hviler paa.

function makeStore({ rows = [], errors = {} } = {}) {
  const state = { rows: rows.map((r) => ({ ...r })), calls: { upserts: 0, updates: 0, deletes: 0 } };

  const matches = (row, filters) =>
    filters.every(({ op, col, value }) => {
      const v = row[col];
      if (op === "eq") return v === value;
      if (op === "lt") return v != null && v < value;
      if (op === "lte") return v != null && v <= value;
      if (op === "in") return value.includes(v);
      return true;
    });

  const supabase = {
    from(table) {
      assert.equal(table, RACE_NOTIFY_OUTBOX_TABLE);
      return {
        upsert(row, opts) {
          state.calls.upserts++;
          if (errors.upsert) return chainSelect(() => ({ data: null, error: errors.upsert }));
          const keyCols = String(opts?.onConflict ?? "").split(",").map((c) => c.trim());
          const existing = state.rows.find((r) => keyCols.every((c) => r[c] === row[c]));
          if (existing) {
            // ignoreDuplicates → ON CONFLICT DO NOTHING: intet skrevet, intet returneret.
            return chainSelect(() => ({ data: [], error: null }));
          }
          const inserted = { id: `row-${state.rows.length + 1}`, ...row };
          state.rows.push(inserted);
          return chainSelect(() => ({ data: [{ id: inserted.id }], error: null }));
        },
        select(_cols) {
          const filters = [];
          const builder = {
            eq: (col, value) => (filters.push({ op: "eq", col, value }), builder),
            in: (col, value) => (filters.push({ op: "in", col, value }), builder),
            lte: (col, value) => (filters.push({ op: "lte", col, value }), builder),
            order: () => builder,
            limit: () => {
              if (errors.select) return Promise.resolve({ data: null, error: errors.select });
              const hits = state.rows
                .filter((r) => matches(r, filters))
                .sort((a, b) => String(a.next_attempt_at).localeCompare(String(b.next_attempt_at)))
                .map((r) => ({ ...r }));
              return Promise.resolve({ data: hits, error: null });
            },
          };
          return builder;
        },
        update(values) {
          const filters = [];
          const apply = () => {
            state.calls.updates++;
            if (errors.update) return { data: null, error: errors.update };
            const hits = state.rows.filter((r) => matches(r, filters));
            for (const row of hits) Object.assign(row, values);
            return { data: hits.map((r) => ({ id: r.id })), error: null };
          };
          const builder = {
            eq: (col, value) => (filters.push({ op: "eq", col, value }), builder),
            lte: (col, value) => (filters.push({ op: "lte", col, value }), builder),
            select: () => Promise.resolve(apply()),
            then: (resolve, reject) => Promise.resolve(apply()).then(resolve, reject),
          };
          return builder;
        },
        delete() {
          const filters = [];
          const builder = {
            eq: (col, value) => (filters.push({ op: "eq", col, value }), builder),
            lt: (col, value) => (filters.push({ op: "lt", col, value }), builder),
            select: () => {
              state.calls.deletes++;
              const hits = state.rows.filter((r) => matches(r, filters));
              state.rows = state.rows.filter((r) => !hits.includes(r));
              return Promise.resolve({ data: hits.map((r) => ({ id: r.id })), error: null });
            },
          };
          return builder;
        },
      };
    },
  };

  function chainSelect(fn) {
    return { select: () => Promise.resolve(fn()) };
  }

  return { supabase, state };
}

const NOW = new Date("2026-09-18T12:00:00.000Z");
const RACE_ID = "11111111-1111-1111-1111-111111111111";
const URL_A = "https://discord.com/api/webhooks/1/gruppe";
const URL_B = "https://discord.com/api/webhooks/2/tier";
const PAYLOAD = { embeds: [{ title: "Resultat" }] };

const okDelivery = () => Promise.resolve({ ok: true, status: 204 });
const retryableDelivery = () =>
  Promise.resolve({ ok: false, status: 500, failure: { kind: "retryable", reason: "discord-5xx" }, error: "500: boom" });
const permanentDelivery = () =>
  Promise.resolve({ ok: false, status: 404, failure: { kind: "permanent", reason: "config-error" }, error: "404: gone" });

// ── Backoff + noegle ─────────────────────────────────────────────────────────

test("nextAttemptDelayMs — stigende backoff, sidste vaerdi genbruges", () => {
  assert.equal(nextAttemptDelayMs(1), 60 * 1000);
  assert.equal(nextAttemptDelayMs(2), 5 * 60 * 1000);
  assert.equal(nextAttemptDelayMs(5), 60 * 60 * 1000);
  assert.equal(nextAttemptDelayMs(99), 60 * 60 * 1000);
  assert.equal(nextAttemptDelayMs(0), 60 * 1000);
});

// Horisonten er BEVIDST kortere end #3545's ~27 timer: et loebsresultat der
// lander seks timer senere er stoej. Laases her, saa en fremtidig "goer den
// bare laengere"-aendring skal tage stilling.
test("retry-horisonten er under to timer", () => {
  let total = 0;
  for (let a = 1; a < MAX_NOTIFY_ATTEMPTS; a++) total += nextAttemptDelayMs(a);
  assert.ok(total <= 2 * 60 * 60 * 1000, `horisont ${total} ms`);
  assert.ok(total >= 60 * 60 * 1000, `horisont ${total} ms`);
});

test("channelKeyForWebhookUrl — stabil hash, og URL'ens token indgaar ikke i noeglen", () => {
  const key = channelKeyForWebhookUrl(URL_A);
  assert.equal(key, channelKeyForWebhookUrl(URL_A));
  assert.notEqual(key, channelKeyForWebhookUrl(URL_B));
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.ok(!key.includes("gruppe"));
});

test("leaseStillHeld — tid, ikke tekst; manglende/uparselig vaerdi = udloebet", () => {
  // Postgres' format vs. JS'. En streng-sammenligning ville sige "+00:00" < "…Z"
  // og dermed erklaere en aktiv lease udloebet.
  assert.equal(leaseStillHeld("2026-09-18T12:04:00+00:00", NOW), true);
  assert.equal(leaseStillHeld("2026-09-18T11:58:00+00:00", NOW), false);
  assert.equal(leaseStillHeld("2026-09-18T12:04:00.000Z", NOW), true);
  assert.equal(leaseStillHeld(null, NOW), false);
  assert.equal(leaseStillHeld("ikke en dato", NOW), false);
});

test("isMissingTableError — 42P01/PGRST205 og tekst-varianten", () => {
  assert.equal(isMissingTableError({ code: "42P01" }), true);
  assert.equal(isMissingTableError({ code: "PGRST205" }), true);
  assert.equal(isMissingTableError({ message: `relation "public.${RACE_NOTIFY_OUTBOX_TABLE}" does not exist` }), true);
  assert.equal(isMissingTableError({ code: "23505", message: "duplicate key" }), false);
  assert.equal(isMissingTableError(null), false);
});

// ── Punkt 2: unik noegle pr. (loeb, beskedtype, kanal) ───────────────────────

test("enqueueRaceNotify — foerste aflevering skriver én pending-raekke", async () => {
  const { supabase, state } = makeStore();
  const result = await enqueueRaceNotify({ supabase, raceId: RACE_ID, webhookUrl: URL_A, payload: PAYLOAD, now: NOW });

  assert.deepEqual(result, { enqueued: true, duplicate: false, missingTable: false });
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].status, "pending");
  assert.equal(state.rows[0].attempts, 0);
  assert.equal(state.rows[0].message_type, RACE_RESULT_MESSAGE_TYPE);
  assert.equal(state.rows[0].channel_key, channelKeyForWebhookUrl(URL_A));
});

test("enqueueRaceNotify — genkoersel af afslutningen giver INGEN dublet", async () => {
  const { supabase, state } = makeStore();
  const first = await enqueueRaceNotify({ supabase, raceId: RACE_ID, webhookUrl: URL_A, payload: PAYLOAD, now: NOW });
  const second = await enqueueRaceNotify({ supabase, raceId: RACE_ID, webhookUrl: URL_A, payload: PAYLOAD, now: NOW });

  assert.equal(first.duplicate, false);
  // Dublet = succes for kalderen: beskeden ER i koen, den skal ikke sendes igen.
  assert.deepEqual(second, { enqueued: true, duplicate: true, missingTable: false });
  assert.equal(state.rows.length, 1);
});

test("enqueueRaceNotify — samme loeb, to kanaler = to raekker", async () => {
  const { supabase, state } = makeStore();
  await enqueueRaceNotify({ supabase, raceId: RACE_ID, webhookUrl: URL_A, payload: PAYLOAD, now: NOW });
  await enqueueRaceNotify({ supabase, raceId: RACE_ID, webhookUrl: URL_B, payload: PAYLOAD, now: NOW });
  assert.equal(state.rows.length, 2);
});

test("enqueueRaceNotify — en dublet maa ALDRIG kunne nulstille en allerede sendt raekke", async () => {
  const { supabase, state } = makeStore();
  await enqueueRaceNotify({ supabase, raceId: RACE_ID, webhookUrl: URL_A, payload: PAYLOAD, now: NOW });
  state.rows[0].status = "sent";
  state.rows[0].sent_at = NOW.toISOString();

  await enqueueRaceNotify({ supabase, raceId: RACE_ID, webhookUrl: URL_A, payload: PAYLOAD, now: NOW });

  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].status, "sent", "en genkoersel skal ikke kunne gen-sende en leveret besked");
});

test("enqueueRaceNotify — manglende tabel rapporteres uden Sentry-stoej", async () => {
  const captured = [];
  const { supabase } = makeStore({ errors: { upsert: { code: "42P01", message: "relation does not exist" } } });
  const result = await enqueueRaceNotify({
    supabase,
    raceId: RACE_ID,
    webhookUrl: URL_A,
    payload: PAYLOAD,
    captureExceptionFn: (e) => captured.push(e),
    now: NOW,
  });
  assert.deepEqual(result, { enqueued: false, duplicate: false, missingTable: true });
  assert.equal(captured.length, 0, "migrations-vinduet maa ikke give ét Sentry-event pr. loeb");
});

// ── Flag OFF = bit-identisk ─────────────────────────────────────────────────

test("deliverRaceResultNotify — flag OFF sender synkront pr. URL, i raekkefoelge", async () => {
  const sent = [];
  const result = await deliverRaceResultNotify({
    urls: [URL_A, URL_B],
    payload: PAYLOAD,
    raceId: RACE_ID,
    queueEnabled: false,
    enqueueFn: () => assert.fail("koen maa ikke roeres naar flaget er off"),
    sendFn: async (url, payload) => sent.push({ url, payload }),
  });

  assert.deepEqual(sent, [
    { url: URL_A, payload: PAYLOAD },
    { url: URL_B, payload: PAYLOAD },
  ]);
  assert.deepEqual(result, { queued: 0, duplicates: 0, sentInline: 2 });
});

test("deliverRaceResultNotify — flag ON roerer slet ikke Discord i afviklingen", async () => {
  const enqueued = [];
  const result = await deliverRaceResultNotify({
    urls: [URL_A, URL_B],
    payload: PAYLOAD,
    raceId: RACE_ID,
    queueEnabled: true,
    enqueueFn: async (args) => (enqueued.push(args), { enqueued: true, duplicate: false }),
    sendFn: () => assert.fail("afviklingen maa ikke sende naar koen har taget imod"),
  });

  assert.equal(enqueued.length, 2);
  assert.equal(enqueued[0].raceId, RACE_ID);
  assert.equal(enqueued[0].messageType, RACE_RESULT_MESSAGE_TYPE);
  assert.deepEqual(result, { queued: 2, duplicates: 0, sentInline: 0 });
});

// Flag ON maa aldrig vaere DAARLIGERE end flag OFF: tager koen ikke imod
// (manglende migration, defekt tabel), sendes beskeden som foer.
test("deliverRaceResultNotify — enqueue-fejl falder tilbage til synkron afsendelse", async () => {
  const sent = [];
  const result = await deliverRaceResultNotify({
    urls: [URL_A, URL_B],
    payload: PAYLOAD,
    raceId: RACE_ID,
    queueEnabled: true,
    enqueueFn: async ({ webhookUrl }) =>
      webhookUrl === URL_A ? { enqueued: false, missingTable: true } : { enqueued: true, duplicate: false },
    sendFn: async (url, payload) => sent.push({ url, payload }),
  });

  assert.deepEqual(sent, [{ url: URL_A, payload: PAYLOAD }]);
  assert.deepEqual(result, { queued: 1, duplicates: 0, sentInline: 1 });
});

// ── Drain: levering, lease, retry ───────────────────────────────────────────

function pendingRow(overrides = {}) {
  return {
    id: "row-1",
    race_id: RACE_ID,
    message_type: RACE_RESULT_MESSAGE_TYPE,
    channel_key: channelKeyForWebhookUrl(URL_A),
    webhook_url: URL_A,
    payload: PAYLOAD,
    status: "pending",
    attempts: 0,
    next_attempt_at: "2026-09-18T11:59:00.000Z",
    lease_expires_at: null,
    ...overrides,
  };
}

test("drain — leveret raekke markeres sent og forsoeges ikke igen", async () => {
  const { supabase, state } = makeStore({ rows: [pendingRow()] });
  const first = await processRaceNotifyOutboxDrain({ supabase, deliverFn: okDelivery, now: NOW });

  assert.equal(first.sent, 1);
  assert.equal(state.rows[0].status, "sent");
  assert.equal(state.rows[0].attempts, 1);
  assert.equal(state.rows[0].lease_expires_at, null);

  const second = await processRaceNotifyOutboxDrain({
    supabase,
    deliverFn: () => assert.fail("en sendt raekke maa aldrig leveres igen"),
    now: new Date(NOW.getTime() + 60_000),
  });
  assert.equal(second.processed, 0);
});

test("drain — claim saetter lease, saa en igangvaerende raekke ikke tages af naeste tick", async () => {
  const { supabase, state } = makeStore({ rows: [pendingRow()] });
  await processRaceNotifyOutboxDrain({
    supabase,
    deliverFn: async () => {
      // Midt i leveringen: raekken staar i sending med en lease i fremtiden.
      assert.equal(state.rows[0].status, "sending");
      assert.equal(state.rows[0].lease_expires_at, new Date(NOW.getTime() + LEASE_MS).toISOString());
      return { ok: true, status: 204 };
    },
    now: NOW,
  });
});

test("drain — to samtidige tick leverer beskeden PRAECIS én gang", async () => {
  const { supabase } = makeStore({ rows: [pendingRow()] });
  let deliveries = 0;
  const deliverFn = async () => {
    deliveries++;
    // Giv den anden drain luft til at naa sin claim mens denne "sender".
    await new Promise((r) => setImmediate(r));
    return { ok: true, status: 204 };
  };

  const [a, b] = await Promise.all([
    processRaceNotifyOutboxDrain({ supabase, deliverFn, now: NOW }),
    processRaceNotifyOutboxDrain({ supabase, deliverFn, now: NOW }),
  ]);

  assert.equal(deliveries, 1, "kun ét tick maa vinde claim'en");
  assert.equal(a.sent + b.sent, 1);
  assert.equal(a.skipped + b.skipped, 1);
});

test("drain — en raekke der haenger i sending tages igen naar leasen er udloebet", async () => {
  const stuck = pendingRow({
    status: "sending",
    attempts: 1,
    lease_expires_at: "2026-09-18T11:58:00.000Z", // udloebet
  });
  const { supabase, state } = makeStore({ rows: [stuck] });

  const result = await processRaceNotifyOutboxDrain({ supabase, deliverFn: okDelivery, now: NOW });
  assert.equal(result.sent, 1);
  assert.equal(state.rows[0].status, "sent");
  assert.equal(state.rows[0].attempts, 2);
});

// Tidsstemplet kommer fra PostgREST i Postgres' eget format (+00:00, ingen
// millisekunder). En streng-sammenligning mod nowIso ("…T12:00:00.000Z") ville
// laese en AKTIV lease som udloebet — og saa var leasen ingen mutex.
test("drain — en lease der stadig loeber roeres ikke (Postgres-tidsformat)", async () => {
  const leased = pendingRow({
    status: "sending",
    attempts: 1,
    lease_expires_at: "2026-09-18T12:04:00+00:00", // i fremtiden
  });
  const { supabase, state } = makeStore({ rows: [leased] });

  const result = await processRaceNotifyOutboxDrain({
    supabase,
    deliverFn: () => assert.fail("en aktiv lease maa ikke brydes"),
    now: NOW,
  });
  assert.equal(result.skipped, 1);
  assert.equal(result.sent, 0);
  assert.equal(state.rows[0].status, "sending");
});

test("drain — retryable fejl replanlaegges med backoff, ikke opgives", async () => {
  const { supabase, state } = makeStore({ rows: [pendingRow()] });
  const result = await processRaceNotifyOutboxDrain({ supabase, deliverFn: retryableDelivery, now: NOW });

  assert.equal(result.rescheduled, 1);
  assert.equal(result.failed, 0);
  assert.equal(state.rows[0].status, "pending");
  assert.equal(state.rows[0].attempts, 1);
  assert.equal(state.rows[0].next_attempt_at, new Date(NOW.getTime() + nextAttemptDelayMs(1)).toISOString());
  assert.equal(state.rows[0].lease_expires_at, null);
});

test("drain — permanent fejl (doedt webhook) opgives med det samme + Sentry", async () => {
  const captured = [];
  const { supabase, state } = makeStore({ rows: [pendingRow()] });
  const result = await processRaceNotifyOutboxDrain({
    supabase,
    deliverFn: permanentDelivery,
    captureExceptionFn: (e) => captured.push(e),
    now: NOW,
  });

  assert.equal(result.failed, 1);
  assert.equal(state.rows[0].status, "failed");
  assert.equal(state.rows[0].last_status, 404);
  assert.equal(captured.length, 1);
  assert.match(captured[0].message, /opgivet/);
});

test("drain — retry loeber toer efter MAX_NOTIFY_ATTEMPTS og ender failed", async () => {
  const { supabase, state } = makeStore({ rows: [pendingRow({ attempts: MAX_NOTIFY_ATTEMPTS - 1 })] });
  const result = await processRaceNotifyOutboxDrain({ supabase, deliverFn: retryableDelivery, now: NOW });

  assert.equal(result.failed, 1);
  assert.equal(state.rows[0].status, "failed");
  assert.equal(state.rows[0].attempts, MAX_NOTIFY_ATTEMPTS);
});

test("drain — en raekke der endnu ikke er forfalden roeres ikke", async () => {
  const { supabase } = makeStore({ rows: [pendingRow({ next_attempt_at: "2026-09-18T12:05:00.000Z" })] });
  const result = await processRaceNotifyOutboxDrain({
    supabase,
    deliverFn: () => assert.fail("backoff'en skal respekteres"),
    now: NOW,
  });
  assert.equal(result.processed, 0);
});

// En Discord-fejl er nu pr. konstruktion afskaaret fra afviklingen. Den maa
// heller ikke kunne tage resten af batchen med sig.
test("drain — et kast fra leveringen stopper hverken tikket eller de oevrige raekker", async () => {
  const rowB = pendingRow({
    id: "row-2",
    channel_key: channelKeyForWebhookUrl(URL_B),
    webhook_url: URL_B,
    next_attempt_at: "2026-09-18T11:59:30.000Z",
  });
  const { supabase, state } = makeStore({ rows: [pendingRow(), rowB] });

  const result = await processRaceNotifyOutboxDrain({
    supabase,
    deliverFn: ({ webhookUrl }) => {
      if (webhookUrl === URL_A) return Promise.reject(new Error("socket hang up"));
      return okDelivery();
    },
    now: NOW,
  });

  assert.equal(result.sent, 1, "den anden besked skal stadig ud");
  assert.equal(result.rescheduled, 1, "den kastende raekke behandles som retryable");
  assert.equal(state.rows.find((r) => r.id === "row-1").status, "pending");
  assert.equal(state.rows.find((r) => r.id === "row-1").last_error, "socket hang up");
  assert.equal(state.rows.find((r) => r.id === "row-2").status, "sent");
});

test("drain — manglende tabel er tavs (migrations-vinduet)", async () => {
  const captured = [];
  const { supabase } = makeStore({ errors: { select: { code: "PGRST205", message: "could not find the table" } } });
  const result = await processRaceNotifyOutboxDrain({
    supabase,
    deliverFn: okDelivery,
    captureExceptionFn: (e) => captured.push(e),
    now: NOW,
  });
  assert.equal(result.processed, 0);
  assert.equal(captured.length, 0);
});

test("drain — leverede raekker ryddes efter retentionen, ikke foer", async () => {
  const fresh = pendingRow({ id: "row-1", status: "sent", sent_at: "2026-09-18T11:00:00.000Z" });
  const old = pendingRow({
    id: "row-2",
    status: "sent",
    channel_key: channelKeyForWebhookUrl(URL_B),
    sent_at: "2026-07-01T11:00:00.000Z",
  });
  const { supabase, state } = makeStore({ rows: [fresh, old] });

  const result = await processRaceNotifyOutboxDrain({ supabase, deliverFn: okDelivery, now: NOW });
  assert.equal(result.purged, 1);
  assert.deepEqual(state.rows.map((r) => r.id), ["row-1"]);
});

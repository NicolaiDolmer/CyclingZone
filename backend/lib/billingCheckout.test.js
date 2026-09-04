import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutHandler, CHECKOUT_PAUSED, CURRENT_TERMS_VERSION } from "./billingCheckout.js";

function fakeClient() {
  const calls = [];
  return {
    calls,
    ensureCustomer: async (a) => { calls.push(["ensureCustomer", a]); return { uuid: "cus_1" }; },
    createCheckoutSession: async (a) => { calls.push(["checkout", a]); return "https://app.alunta.com/checkout/xyz"; },
  };
}

// #2813/#2816/#4646: fake supabase der fanger accept-log-upserts + player_events-
// inserts på subscriptions, og lader tests injicere en eksisterende
// subscriptions-række (dobbeltkøb-guarden, #2816) via `existingSub`.
function fakeSupabase({ existingSub = null } = {}) {
  const upserts = [];
  const inserts = [];
  return {
    upserts,
    inserts,
    from(table) {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: () => Promise.resolve({ data: table === "subscriptions" ? existingSub : null, error: null }) };
            },
          };
        },
        upsert(row, opts) {
          upserts.push({ table, row, opts });
          return Promise.resolve({ error: null });
        },
        insert(row) {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

// #4074: plan-id'er nestet pr. valuta x interval, som PLAN_IDS i billingCheckout.js.
function planIdsFixture() {
  return {
    DKK: { monthly: "plan-dkk-m", semiannual: "plan-dkk-s" },
    EUR: { monthly: "plan-eur-m", semiannual: "plan-eur-s" },
  };
}

// Gyldig body inkl. #2813-accept — udgangspunkt for de fleste tests.
function acceptedBody(extra = {}) {
  return { interval: "monthly", terms_accepted: true, terms_version: CURRENT_TERMS_VERSION, ...extra };
}

function res() {
  return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

// #2813 (ejer-beslutning 2/9, "åbn nu, ret bagefter"): default-tilstanden er
// nu åben. Selve pause-mekanikken (paused: true) testes stadig eksplicit
// herunder, så nødbremsen forbliver bevist virkende.
test("checkout: åbent som default → ensureCustomer + checkout_url uden eksplicit paused", async () => {
  assert.equal(CHECKOUT_PAUSED, false);
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.checkout_url, "https://app.alunta.com/checkout/xyz");
  assert.equal(client.calls.length, 2);
});

test("checkout: paused=true (eksplicit) → 503 checkout_paused, ingen Alunta-kald", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: true, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 503);
  assert.equal(r.body.errorCode, "checkout_paused");
  assert.equal(client.calls.length, 0);
});

test("checkout: kendt interval + accept (DKK monthly, default currency) → ensureCustomer + checkout_url", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const req = { team: { id: "team-1", name: "L" }, user: { email: "a@b.dk" }, body: acceptedBody() };
  const r = res();
  await handler(req, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.checkout_url, "https://app.alunta.com/checkout/xyz");
  assert.deepEqual(client.calls[0][1], { externalCustomerId: "team-1", name: "L", email: "a@b.dk" });
  assert.equal(client.calls[1][1].planId, "plan-dkk-m");
});

test("checkout: semiannual interval (DKK) → plan-dkk-s", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody({ interval: "semiannual" }) }, r);
  assert.equal(r.code, 200);
  assert.equal(client.calls[1][1].planId, "plan-dkk-s");
});

// #4074: eksplicit currency: "DKK" i body → samme plan som default (bagudkompatibelt).
test("checkout: eksplicit currency DKK → plan-dkk-m", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody({ currency: "DKK" }) }, r);
  assert.equal(r.code, 200);
  assert.equal(client.calls[1][1].planId, "plan-dkk-m");
});

// #4074: internationale spillere (spilsprog != dansk) → EUR, valgt af klienten.
test("checkout: currency EUR + monthly → plan-eur-m", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody({ currency: "EUR" }) }, r);
  assert.equal(r.code, 200);
  assert.equal(client.calls[1][1].planId, "plan-eur-m");
});

test("checkout: currency EUR + semiannual → plan-eur-s", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody({ currency: "EUR", interval: "semiannual" }) }, r);
  assert.equal(r.code, 200);
  assert.equal(client.calls[1][1].planId, "plan-eur-s");
});

// #4074: ukendt valuta → 400 unknown_currency, ingen Alunta-kald.
test("checkout: ukendt currency → 400 unknown_currency, ingen Alunta-kald", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody({ currency: "USD" }) }, r);
  assert.equal(r.code, 400);
  assert.equal(r.body.errorCode, "unknown_currency");
  assert.equal(client.calls.length, 0);
});

test("checkout: ukendt interval → 400 unknown_interval", async () => {
  const handler = createCheckoutHandler({ client: fakeClient(), paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody({ interval: "weekly" }) }, r);
  assert.equal(r.code, 400);
  assert.equal(r.body.errorCode, "unknown_interval");
});

// #4074: gyldig currency + kendt interval, men intet plan-id konfigureret for
// netop den kombination (fx EUR-nøglen ikke sat i Railway endnu) → plan_unavailable.
test("checkout: manglende plan-id for kombinationen → 400 plan_unavailable", async () => {
  const handler = createCheckoutHandler({
    client: fakeClient(),
    paused: false,
    planIds: { DKK: { monthly: "plan-dkk-m" }, EUR: {} },
    appBaseUrl: "https://cz",
  });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody({ currency: "EUR" }) }, r);
  assert.equal(r.code, 400);
  assert.equal(r.body.errorCode, "plan_unavailable");
});

test("checkout: intet team → 400", async () => {
  const handler = createCheckoutHandler({ client: fakeClient(), paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: null, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 400);
});

// #2813: manglende accept afvises FØR noget Alunta-kald.
test("checkout: terms_accepted mangler → 400 terms_not_accepted, ingen Alunta-kald", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: { interval: "monthly", terms_version: CURRENT_TERMS_VERSION } }, r);
  assert.equal(r.code, 400);
  assert.equal(r.body.errorCode, "terms_not_accepted");
  assert.equal(client.calls.length, 0);
});

// #2813: forældet vilkårs-version afvises — klienten skal reloade og re-accepte.
test("checkout: terms_version mismatch → 400 terms_version_mismatch", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody({ terms_version: "2020-01-01" }) }, r);
  assert.equal(r.code, 400);
  assert.equal(r.body.errorCode, "terms_version_mismatch");
  assert.equal(client.calls.length, 0);
});

// #2813: accepten logges på subscriptions-rækken FØR checkout-sessionen oprettes.
test("checkout: accept-log upsertes på subscriptions med version + tidspunkt", async () => {
  const client = fakeClient();
  const supabase = fakeSupabase();
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "team-9", name: "T" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 200);
  assert.equal(supabase.upserts.length, 1);
  const u = supabase.upserts[0];
  assert.equal(u.table, "subscriptions");
  assert.equal(u.row.team_id, "team-9");
  assert.equal(u.row.terms_version, CURRENT_TERMS_VERSION);
  assert.ok(u.row.terms_accepted_at);
  assert.deepEqual(u.opts, { onConflict: "team_id" });
});

// #2813: kan accept-loggen ikke skrives, gennemføres checkout IKKE (beviset må
// aldrig mangle for en gennemført betaling).
test("checkout: fejlende accept-log → 502, ingen checkout-session", async () => {
  const client = fakeClient();
  const supabase = {
    from: () => ({ upsert: () => Promise.resolve({ error: { message: "db nede" } }) }),
  };
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 502);
  assert.equal(client.calls.length, 0);
});

test("checkout: Alunta-fejl → 502", async () => {
  const client = { ensureCustomer: async () => { throw new Error("boom"); }, createCheckoutSession: async () => "x" };
  const handler = createCheckoutHandler({ client, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 502);
});

// ── #2816: dobbeltkøb-guard ───────────────────────────────────────────────────

test("checkout: eksisterende ACTIVE subscription MED alunta_subscription_id → 409 already_subscribed, ingen Alunta-kald", async () => {
  const client = fakeClient();
  const supabase = fakeSupabase({ existingSub: { status: "active", alunta_subscription_id: "sub-existing" } });
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: { DKK: { monthly: "m" } }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 409);
  assert.equal(r.body.errorCode, "already_subscribed");
  assert.equal(client.calls.length, 0);
  assert.equal(supabase.upserts.length, 0); // accept-loggen skrives IKKE for et allerede-abonneret hold
});

test("checkout: eksisterende PAST_DUE subscription MED alunta_subscription_id → 409 already_subscribed", async () => {
  const client = fakeClient();
  const supabase = fakeSupabase({ existingSub: { status: "past_due", alunta_subscription_id: "sub-existing" } });
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: { DKK: { monthly: "m" } }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 409);
  assert.equal(r.body.errorCode, "already_subscribed");
  assert.equal(client.calls.length, 0);
});

test("checkout: eksisterende CANCELLED subscription → IKKE blokeret (kan genkøbe)", async () => {
  const client = fakeClient();
  const supabase = fakeSupabase({ existingSub: { status: "cancelled", alunta_subscription_id: "sub-old" } });
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: { DKK: { monthly: "m" } }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 200);
  assert.equal(client.calls.length, 2);
});

test("checkout: eksisterende active-agtig række UDEN alunta_subscription_id (kun terms-accept, ikke betalt) → IKKE blokeret", async () => {
  const client = fakeClient();
  const supabase = fakeSupabase({ existingSub: { status: "inactive", alunta_subscription_id: null } });
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: { DKK: { monthly: "m" } }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 200);
  assert.equal(client.calls.length, 2);
});

test("checkout: dobbeltkøb-tjekket fejler (DB-fejl) → fail-open, checkout fortsætter, fejlen alarmeres ikke som 502", async () => {
  const client = fakeClient();
  const supabase = {
    from: (table) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "db nede" } }) }) }),
      upsert: () => Promise.resolve({ error: null }),
      insert: () => Promise.resolve({ error: null }),
      _table: table,
    }),
  };
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: { DKK: { monthly: "m" } }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 200);
  assert.equal(client.calls.length, 2);
});

// ── #4646: checkout_started player_events-funnel-event ───────────────────────

test("checkout: vellykket køb skriver player_events 'checkout_started' med interval + currency (DKK, default)", async () => {
  const client = fakeClient();
  const supabase = fakeSupabase();
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: { DKK: { monthly: "m", semiannual: "s" } }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "team-9" }, user: { id: "user-1" }, body: acceptedBody({ interval: "semiannual" }) }, r);
  assert.equal(r.code, 200);
  // Fire-and-forget, ikke awaited af handleren — vent én microtask-runde af.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supabase.inserts.length, 1);
  const ev = supabase.inserts[0];
  assert.equal(ev.table, "player_events");
  assert.equal(ev.row.team_id, "team-9");
  assert.equal(ev.row.user_id, "user-1");
  assert.equal(ev.row.event_name, "checkout_started");
  assert.deepEqual(ev.row.event_data, { interval: "semiannual", currency: "DKK" });
});

// #4074: bonus — checkout_started bar tidligere altid currency:null; nu den
// faktisk valgte valuta, så funnelen kan splitte DKK/EUR.
test("checkout: vellykket EUR-køb skriver player_events 'checkout_started' med currency:EUR", async () => {
  const client = fakeClient();
  const supabase = fakeSupabase();
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: planIdsFixture(), appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "team-9" }, user: { id: "user-1" }, body: acceptedBody({ currency: "EUR", interval: "monthly" }) }, r);
  assert.equal(r.code, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supabase.inserts.length, 1);
  const ev = supabase.inserts[0];
  assert.deepEqual(ev.row.event_data, { interval: "monthly", currency: "EUR" });
});

test("checkout: intet req.user.id → springer player_events-skrivning stille over, køb gennemføres stadig", async () => {
  const client = fakeClient();
  const supabase = fakeSupabase();
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: { DKK: { monthly: "m" } }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supabase.inserts.length, 0);
});

test("checkout: player_events-insert der fejler paavirker IKKE checkout-svaret (fire-and-forget)", async () => {
  const client = fakeClient();
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      upsert: () => Promise.resolve({ error: null }),
      insert: () => Promise.resolve({ error: { message: "player_events nede" } }),
    }),
  };
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: { DKK: { monthly: "m" } }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: { id: "u1" }, body: acceptedBody() }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.checkout_url, "https://app.alunta.com/checkout/xyz");
});

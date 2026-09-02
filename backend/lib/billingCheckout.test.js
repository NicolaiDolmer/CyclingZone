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

// #2813: fake supabase der fanger accept-log-upserts på subscriptions.
function fakeSupabase() {
  const upserts = [];
  return {
    upserts,
    from(table) {
      return {
        upsert(row, opts) {
          upserts.push({ table, row, opts });
          return Promise.resolve({ error: null });
        },
      };
    },
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
  const handler = createCheckoutHandler({ client, planIds: { monthly: "plan-m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.checkout_url, "https://app.alunta.com/checkout/xyz");
  assert.equal(client.calls.length, 2);
});

test("checkout: paused=true (eksplicit) → 503 checkout_paused, ingen Alunta-kald", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: true, planIds: { monthly: "plan-m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 503);
  assert.equal(r.body.errorCode, "checkout_paused");
  assert.equal(client.calls.length, 0);
});

test("checkout: kendt interval + accept → ensureCustomer + checkout_url", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: { monthly: "plan-m", semiannual: "plan-s" }, appBaseUrl: "https://cz" });
  const req = { team: { id: "team-1", name: "L" }, user: { email: "a@b.dk" }, body: acceptedBody() };
  const r = res();
  await handler(req, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.checkout_url, "https://app.alunta.com/checkout/xyz");
  assert.deepEqual(client.calls[0][1], { externalCustomerId: "team-1", name: "L", email: "a@b.dk" });
  assert.equal(client.calls[1][1].planId, "plan-m");
});

test("checkout: semiannual interval → plan-s", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: { monthly: "plan-m", semiannual: "plan-s" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody({ interval: "semiannual" }) }, r);
  assert.equal(r.code, 200);
  assert.equal(client.calls[1][1].planId, "plan-s");
});

test("checkout: ukendt interval → 400", async () => {
  const handler = createCheckoutHandler({ client: fakeClient(), paused: false, planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody({ interval: "weekly" }) }, r);
  assert.equal(r.code, 400);
});

test("checkout: intet team → 400", async () => {
  const handler = createCheckoutHandler({ client: fakeClient(), paused: false, planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: null, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 400);
});

// #2813: manglende accept afvises FØR noget Alunta-kald.
test("checkout: terms_accepted mangler → 400 terms_not_accepted, ingen Alunta-kald", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: { interval: "monthly", terms_version: CURRENT_TERMS_VERSION } }, r);
  assert.equal(r.code, 400);
  assert.equal(r.body.errorCode, "terms_not_accepted");
  assert.equal(client.calls.length, 0);
});

// #2813: forældet vilkårs-version afvises — klienten skal reloade og re-accepte.
test("checkout: terms_version mismatch → 400 terms_version_mismatch", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, paused: false, planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
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
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
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
  const handler = createCheckoutHandler({ client, supabase, paused: false, planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 502);
  assert.equal(client.calls.length, 0);
});

test("checkout: Alunta-fejl → 502", async () => {
  const client = { ensureCustomer: async () => { throw new Error("boom"); }, createCheckoutSession: async () => "x" };
  const handler = createCheckoutHandler({ client, paused: false, planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: acceptedBody() }, r);
  assert.equal(r.code, 502);
});

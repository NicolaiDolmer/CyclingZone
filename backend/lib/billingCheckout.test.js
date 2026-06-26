import test from "node:test";
import assert from "node:assert/strict";
import { createCheckoutHandler } from "./billingCheckout.js";

function fakeClient() {
  const calls = [];
  return {
    calls,
    ensureCustomer: async (a) => { calls.push(["ensureCustomer", a]); return { uuid: "cus_1" }; },
    createCheckoutSession: async (a) => { calls.push(["checkout", a]); return "https://app.alunta.com/checkout/xyz"; },
  };
}

function res() {
  return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test("checkout: kendt interval → ensureCustomer + checkout_url", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, planIds: { monthly: "plan-m", semiannual: "plan-s" }, appBaseUrl: "https://cz" });
  const req = { team: { id: "team-1", name: "L" }, user: { email: "a@b.dk" }, body: { interval: "monthly" } };
  const r = res();
  await handler(req, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.checkout_url, "https://app.alunta.com/checkout/xyz");
  assert.deepEqual(client.calls[0][1], { externalCustomerId: "team-1", name: "L", email: "a@b.dk" });
  assert.equal(client.calls[1][1].planId, "plan-m");
});

test("checkout: semiannual interval → plan-s", async () => {
  const client = fakeClient();
  const handler = createCheckoutHandler({ client, planIds: { monthly: "plan-m", semiannual: "plan-s" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: { interval: "semiannual" } }, r);
  assert.equal(r.code, 200);
  assert.equal(client.calls[1][1].planId, "plan-s");
});

test("checkout: ukendt interval → 400", async () => {
  const handler = createCheckoutHandler({ client: fakeClient(), planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: { interval: "weekly" } }, r);
  assert.equal(r.code, 400);
});

test("checkout: intet team → 400", async () => {
  const handler = createCheckoutHandler({ client: fakeClient(), planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: null, user: {}, body: { interval: "monthly" } }, r);
  assert.equal(r.code, 400);
});

test("checkout: Alunta-fejl → 502", async () => {
  const client = { ensureCustomer: async () => { throw new Error("boom"); }, createCheckoutSession: async () => "x" };
  const handler = createCheckoutHandler({ client, planIds: { monthly: "m" }, appBaseUrl: "https://cz" });
  const r = res();
  await handler({ team: { id: "t" }, user: {}, body: { interval: "monthly" } }, r);
  assert.equal(r.code, 502);
});

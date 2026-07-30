import test from "node:test";
import assert from "node:assert/strict";
import { createPortalHandler } from "./billingPortal.js";

// #2813: fake supabase med konfigurerbar subscription-række.
function fakeSupabase(sub, error = null) {
  return {
    from(table) {
      assert.equal(table, "subscriptions");
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: () => Promise.resolve({ data: sub, error }),
      };
    },
  };
}

function fakeClient() {
  const calls = [];
  return {
    calls,
    createPortalLink: async (a) => { calls.push(a); return "https://app.alunta.com/portal/cz/verify/1"; },
  };
}

function res() {
  return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test("portal: subscription med customer-uuid → auto-login-link", async () => {
  const client = fakeClient();
  const handler = createPortalHandler({ client, supabase: fakeSupabase({ alunta_customer_id: "cus-123" }) });
  const r = res();
  await handler({ team: { id: "t1" } }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.portal_url, "https://app.alunta.com/portal/cz/verify/1");
  assert.deepEqual(client.calls[0], { customerUuid: "cus-123" });
});

// Gamle/ufuldstændige rækker (fx accept-log uden gennemført køb) har ingen
// customer-uuid → fallback til portalens login-side (magic link).
test("portal: subscription uden customer-uuid → login-side-fallback", async () => {
  const client = fakeClient();
  const handler = createPortalHandler({ client, supabase: fakeSupabase({ alunta_customer_id: null }) });
  const r = res();
  await handler({ team: { id: "t1" } }, r);
  assert.equal(r.code, 200);
  assert.deepEqual(client.calls[0], { customerUuid: undefined });
});

test("portal: ingen subscription → 404 no_subscription, intet Alunta-kald", async () => {
  const client = fakeClient();
  const handler = createPortalHandler({ client, supabase: fakeSupabase(null) });
  const r = res();
  await handler({ team: { id: "t1" } }, r);
  assert.equal(r.code, 404);
  assert.equal(r.body.errorCode, "no_subscription");
  assert.equal(client.calls.length, 0);
});

test("portal: intet team → 400", async () => {
  const handler = createPortalHandler({ client: fakeClient(), supabase: fakeSupabase(null) });
  const r = res();
  await handler({ team: null }, r);
  assert.equal(r.code, 400);
});

test("portal: Alunta-fejl → 502", async () => {
  const client = { createPortalLink: async () => { throw new Error("boom"); } };
  const handler = createPortalHandler({ client, supabase: fakeSupabase({ alunta_customer_id: "c" }) });
  const r = res();
  await handler({ team: { id: "t1" } }, r);
  assert.equal(r.code, 502);
});


import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { createCheckoutHandler, CURRENT_TERMS_VERSION } from "./billingCheckout.js";
import { handleAluntaWebhook } from "./aluntaWebhook.js";

const campaign = { utm_source: "facebook", utm_medium: "paid", utm_campaign: "first-touch", utm_content: "creative-a" };
const uid = "fixture-account";
const tid = "fixture-team";

async function checkout(kind, { consent = null, attribution = campaign, lookupError = false, captureError = false } = {}) {
  const inserts = [];
  const captures = [];
  const upserts = [];
  const reads = [];
  const stored = {
    subscriptions: kind === "checkout_completed" ? { is_founder: true, status: "inactive" } : null,
    teams: { user_id: uid },
    users: { consent_preferences: consent },
    signup_attribution: attribution,
  };
  const supabase = {
    from(table) {
      return {
        select(columns) {
          reads.push({ table, columns });
          return { eq: () => ({ maybeSingle: async () => {
            if (table === "signup_attribution" && lookupError) throw new Error("lookup failed");
            return { data: stored[table] ?? null, error: null };
          } }) };
        },
        upsert: async (row) => { upserts.push(row); return { error: null }; },
        insert: async (row) => { inserts.push(row); return { error: null }; },
      };
    },
  };
  const captureCheckoutEventFn = async (event) => {
    captures.push(event);
    if (captureError) throw new Error("mirror failed");
    return true;
  };
  const res = {
    code: 0,
    status(code) { this.code = code; return this; },
    sendStatus(code) { this.code = code; },
    json() {},
  };
  if (kind === "checkout_started") {
    const handler = createCheckoutHandler({
      client: { ensureCustomer: async () => {}, createCheckoutSession: async () => "https://example.test/checkout" },
      supabase, paused: false, planIds: { DKK: { monthly: "fixture-plan" } }, captureCheckoutEventFn,
    });
    await handler({
      team: { id: tid }, user: { id: uid, email: "fixture@example.test" },
      body: { interval: "monthly", terms_accepted: true, terms_version: CURRENT_TERMS_VERSION, utm_campaign: "current-visit" },
    }, res);
    await setImmediate();
  } else {
    const secret = "fixture-webhook-secret";
    const body = Buffer.from(JSON.stringify({
      event: "checkout.completed", timestamp: "2026-11-23T10:00:00Z",
      data: { external_customer_id: tid, uuid: "fixture-checkout", plan_interval: "monthly", currency: "DKK" },
    }));
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    await handleAluntaWebhook({
      req: { body, get: () => signature }, res, supabase, secret, captureCheckoutEventFn,
      captureExceptionFn: () => {},
    });
  }
  assert.equal(res.code, 200);
  assert.equal(inserts.length, 1);
  if (kind === "checkout_completed") assert.equal(upserts[0].status, "active");
  return { data: inserts[0].event_data, captures, reads };
}

for (const kind of ["checkout_started", "checkout_completed"]) {
  test(kind + " uses the account's first touch in Postgres and PostHog", async () => {
    const { data, captures } = await checkout(kind, {
      attribution: { ...campaign, referrer: "https://example.test/?email=fixture", fbclid: "fixture-click" },
    });
    for (const [key, value] of Object.entries(campaign)) assert.equal(data[key], value);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].event, kind);
    assert.equal(captures[0].distinctId, uid);
    for (const [key, value] of Object.entries(campaign)) assert.equal(captures[0].properties[key], value);
    assert.deepEqual(captures[0].properties.$set_once, campaign);
    for (const key of ["referrer", "fbclid", "email", "team_id"]) {
      assert.equal(Object.hasOwn(captures[0].properties, key), false);
    }
  });

  test(kind + " honours a refusal and a failed lookup without breaking billing", async () => {
    const denied = await checkout(kind, { consent: { analytics: false } });
    assert.ok(!denied.reads.some(({ table }) => table === "signup_attribution"));
    assert.equal(Object.hasOwn(denied.data, "utm_campaign"), false);
    assert.equal(denied.captures.length, 0);
    const failed = await checkout(kind, { lookupError: true });
    assert.equal(Object.hasOwn(failed.data, "utm_campaign"), false);
    assert.equal(failed.captures.length, 0);
  });
}

test("checkout ignores unsafe or missing UTM values and tolerates a failed mirror", async () => {
  const { data, captures } = await checkout("checkout_completed", {
    attribution: { utm_source: "facebook", utm_campaign: "first-touch", utm_content: "fixture@example.test" },
    captureError: true,
  });
  assert.equal(data.utm_campaign, "first-touch");
  assert.equal(Object.hasOwn(data, "utm_medium"), false);
  assert.equal(Object.hasOwn(data, "utm_content"), false);
  assert.deepEqual(captures[0].properties.$set_once, { utm_source: "facebook", utm_campaign: "first-touch" });
});

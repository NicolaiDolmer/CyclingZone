import test from "node:test";
import assert from "node:assert/strict";
import { createAluntaClient } from "./alunta.js";

function fakeFetch(captured) {
  return async (url, opts) => {
    captured.url = url;
    captured.opts = opts;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ checkout_url: "https://app.alunta.com/checkout/abc", uuid: "cus_1" }),
    };
  };
}

test("createCheckoutSession POSTer external_customer_id + plan_id og returnerer checkout_url", async () => {
  const captured = {};
  const client = createAluntaClient({ token: "t", baseUrl: "https://app.alunta.com/api/v1", fetchImpl: fakeFetch(captured) });
  const url = await client.createCheckoutSession({ externalCustomerId: "team-1", planId: "plan-9", successUrl: "https://cz/ok", backUrl: "https://cz/pro" });
  assert.equal(url, "https://app.alunta.com/checkout/abc");
  assert.equal(captured.url, "https://app.alunta.com/api/v1/checkout-sessions");
  assert.equal(captured.opts.method, "POST");
  assert.match(captured.opts.headers.Authorization, /^Bearer t$/);
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.external_customer_id, "team-1");
  assert.equal(body.plan_id, "plan-9");
});

test("ensureCustomer POSTer name + external_customer_id", async () => {
  const captured = {};
  const client = createAluntaClient({ token: "t", baseUrl: "https://app.alunta.com/api/v1", fetchImpl: fakeFetch(captured) });
  await client.ensureCustomer({ externalCustomerId: "team-1", name: "Lorraine", email: "a@b.dk" });
  assert.equal(captured.url, "https://app.alunta.com/api/v1/customers");
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.external_customer_id, "team-1");
  assert.equal(body.name, "Lorraine");
});

test("non-2xx kaster med status + body", async () => {
  const client = createAluntaClient({ token: "t", baseUrl: "https://x/api/v1", fetchImpl: async () => ({ ok: false, status: 422, text: async () => "bad" }) });
  await assert.rejects(() => client.ensureCustomer({ externalCustomerId: "t", name: "n" }), /422.*bad/);
});

test("ensureCustomer er idempotent: 422 'already exists' returnerer null i stedet for at kaste", async () => {
  const dupBody = JSON.stringify({
    message: "A customer with this external_customer_id already exists. Existing customer UUID: fed7910b-327d-4f0a-a6c3-21206d342749",
    errors: { external_customer_id: ["A customer with this external_customer_id already exists."] },
  });
  const client = createAluntaClient({ token: "t", baseUrl: "https://x/api/v1", fetchImpl: async () => ({ ok: false, status: 422, text: async () => dupBody }) });
  const result = await client.ensureCustomer({ externalCustomerId: "team-1", name: "n" });
  assert.equal(result, null);
});

test("ensureCustomer: andre 422-fejl (validation) kaster stadig", async () => {
  const valBody = JSON.stringify({ message: "The email field must be a valid email address.", errors: { email: ["invalid"] } });
  const client = createAluntaClient({ token: "t", baseUrl: "https://x/api/v1", fetchImpl: async () => ({ ok: false, status: 422, text: async () => valBody }) });
  await assert.rejects(() => client.ensureCustomer({ externalCustomerId: "t", name: "n" }), /422.*email/);
});

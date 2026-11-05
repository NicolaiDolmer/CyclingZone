import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseFetchWithRetry, isRetryableRequest } from "./supabaseFetchRetry.js";

const html = (status) => new Response("<html>cf</html>", { status, headers: { "content-type": "text/html" } });
const ok = () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });

function build(responses) {
  const calls = [];
  const sleeps = [];
  const baseFetch = async (input, init) => {
    calls.push({ input, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const wrapped = createSupabaseFetchWithRetry(baseFetch, { sleep: async (ms) => { sleeps.push(ms); } });
  return { wrapped, calls, sleeps };
}

const URL_ = "https://x.supabase.co/rest/v1/race_team_orders";

test("GET prøves igen ved Cloudflare 522 og lykkes", async () => {
  const { wrapped, calls, sleeps } = build([html(522), ok()]);
  const res = await wrapped(URL_, { method: "GET" });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [300]);
});

test("højst 2 gentagelser med backoff 300 ms og 1 s, derefter returneres sidste svar", async () => {
  const { wrapped, calls, sleeps } = build([html(520), html(521), html(525)]);
  const res = await wrapped(URL_, { method: "GET" });
  assert.equal(res.status, 525);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [300, 1000]);
});

test("netværksfejl prøves igen og kastes til sidst uændret", async () => {
  const err = new TypeError("fetch failed");
  const { wrapped, calls } = build([err, err, err]);
  await assert.rejects(() => wrapped(URL_, { method: "GET" }), (e) => e === err);
  assert.equal(calls.length, 3);
});

test("upsert (POST + merge-duplicates) prøves igen", async () => {
  const { wrapped, calls } = build([html(523), ok()]);
  const res = await wrapped(URL_, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: "[]",
  });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

test("upsert med Headers-objekt genkendes", () => {
  const headers = new Headers({ prefer: "return=representation,resolution=merge-duplicates" });
  assert.equal(isRetryableRequest(URL_, { method: "POST", headers, body: "{}" }), true);
});

test("almindeligt insert, RPC, PATCH og DELETE prøves aldrig igen", async () => {
  for (const [url, init] of [
    [URL_, { method: "POST", headers: { Prefer: "return=minimal" }, body: "{}" }],
    ["https://x.supabase.co/rest/v1/rpc/foo", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: "{}" }],
    [URL_, { method: "PATCH", body: "{}" }],
    [URL_, { method: "DELETE" }],
  ]) {
    const { wrapped, calls } = build([html(522), ok()]);
    const res = await wrapped(url, init);
    assert.equal(res.status, 522);
    assert.equal(calls.length, 1);
  }
});

test("andre statuskoder og JSON-fejl med 5xx prøves ikke igen", async () => {
  for (const response of [
    new Response("{}", { status: 500, headers: { "content-type": "application/json" } }),
    new Response("{}", { status: 522, headers: { "content-type": "application/json" } }),
    new Response("nope", { status: 404, headers: { "content-type": "text/html" } }),
  ]) {
    const { wrapped, calls } = build([response, ok()]);
    await wrapped(URL_, { method: "GET" });
    assert.equal(calls.length, 1);
  }
});

test("succes ved første forsøg returneres uændret uden sleep", async () => {
  const { wrapped, calls, sleeps } = build([ok()]);
  const res = await wrapped(URL_);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(sleeps.length, 0);
});

test("afbrudt request (AbortError) prøves ikke igen", async () => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  const { wrapped, calls } = build([abort, ok()]);
  await assert.rejects(() => wrapped(URL_, { method: "GET" }), (e) => e === abort);
  assert.equal(calls.length, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseFetchWithRetry, isRetryableRequest } from "./supabaseFetchRetry.js";
import { isTransientSupabaseError } from "./supabaseErrorNormalize.js";

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
  const { wrapped, calls, sleeps } = build([html(521), html(524), html(525)]);
  const res = await wrapped(URL_, { method: "GET" });
  assert.equal(res.status, 525);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [300, 1000]);
});

test("læsninger: 520 og netværksfejl overlades til PostgREST-klienten (ingen gange-effekt)", async () => {
  const { wrapped, calls } = build([html(520), ok()]);
  const res = await wrapped(URL_, { method: "GET" });
  assert.equal(res.status, 520);
  assert.equal(calls.length, 1);

  const err = new TypeError("fetch failed");
  const second = build([err, ok()]);
  await assert.rejects(() => second.wrapped(URL_, { method: "GET" }), (e) => e === err);
  assert.equal(second.calls.length, 1);
});

test("upsert: netværksfejl prøves igen og kastes til sidst uændret", async () => {
  const err = new TypeError("fetch failed");
  const { wrapped, calls } = build([err, err, err]);
  const init = { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: "[]" };
  await assert.rejects(() => wrapped(URL_, init), (e) => e === err);
  assert.equal(calls.length, 3);
});

test("upsert: Cloudflare 520 prøves igen (SDK'et prøver ikke skrivninger)", async () => {
  const { wrapped, calls } = build([html(520), ok()]);
  const res = await wrapped(URL_, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: "[]" });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

function clientWith(responses, fetchCalls) {
  const baseFetch = async (input, init) => {
    fetchCalls.push({ input, init });
    return responses.shift();
  };
  return createClient("https://x.supabase.co", "service-key", {
    global: { fetch: createSupabaseFetchWithRetry(baseFetch, { delaysMs: [1, 1] }) },
  });
}

test("gennem createClient: læsning med vedvarende 521 giver 3 kald, ikke flere", async () => {
  const fetchCalls = [];
  const client = clientWith([html(521), html(521), html(521), html(521)], fetchCalls);
  const { error } = await client.from("race_team_orders").select("*");
  assert.ok(error);
  assert.equal(fetchCalls.length, 3);
});

test("gennem createClient: vedvarende 520 på læsning forstærkes ikke af wrapperen", async () => {
  const fetchCalls = [];
  const client = clientWith([html(520), html(520), html(520), html(520)], fetchCalls);
  const { error } = await client.from("race_team_orders").select("*").retry(false);
  assert.ok(error);
  assert.equal(fetchCalls.length, 1);
});

test("gennem createClient: upsert med 522 lykkes ved andet forsøg", async () => {
  const fetchCalls = [];
  const client = clientWith([html(522), ok()], fetchCalls);
  const { error } = await client.from("race_team_orders").upsert([{ id: 1 }], { onConflict: "id" });
  assert.equal(error, null);
  assert.equal(fetchCalls.length, 2);
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

test("andre statuskoder prøves ikke igen, heller ikke 5xx uden for Cloudflare-området", async () => {
  for (const response of [
    new Response("{}", { status: 500, headers: { "content-type": "application/json" } }),
    new Response("{}", { status: 503, headers: { "content-type": "application/json" } }),
    new Response("{}", { status: 526, headers: { "content-type": "application/json" } }),
    new Response("nope", { status: 404, headers: { "content-type": "text/html" } }),
  ]) {
    const { wrapped, calls } = build([response, ok()]);
    await wrapped(URL_, { method: "GET" });
    assert.equal(calls.length, 1);
  }
});

const cloudflareJson = (status, contentType = "application/json") => new Response(
  JSON.stringify({ title: `Error ${status}`, status }),
  { status, headers: { "content-type": contentType } },
);

test("#7917 Cloudflares JSON-fejl 521-525 prøves igen på læsninger", async () => {
  for (const status of [521, 522, 523, 524, 525]) {
    for (const contentType of ["application/json", "application/problem+json"]) {
      const { wrapped, calls } = build([cloudflareJson(status, contentType), ok()]);
      const res = await wrapped(URL_, { method: "GET" });
      assert.equal(res.status, 200);
      assert.equal(calls.length, 2);
    }
  }
});

test("#7917 Cloudflares JSON-fejl 520 overlades til PostgREST-klienten på læsninger, men prøves igen på upserts", async () => {
  const read = build([cloudflareJson(520), ok()]);
  assert.equal((await read.wrapped(URL_, { method: "GET" })).status, 520);
  assert.equal(read.calls.length, 1);

  const upsert = build([cloudflareJson(520), ok()]);
  const res = await upsert.wrapped(URL_, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: "[]" });
  assert.equal(res.status, 200);
  assert.equal(upsert.calls.length, 2);
});

test("#7917 ikke-idempotente skrivninger sendes kun én gang, også ved Cloudflares JSON-fejl", async () => {
  const { wrapped, calls } = build([cloudflareJson(522), ok()]);
  const res = await wrapped("https://x.supabase.co/rest/v1/rpc/foo", { method: "POST", body: "{}" });
  assert.equal(res.status, 522);
  assert.equal(calls.length, 1);
});

test("#7917 gennem createClient: vedvarende JSON-521 giver en fejl og 3 kald, ikke flere", async () => {
  const fetchCalls = [];
  const client = clientWith([cloudflareJson(521), cloudflareJson(521), cloudflareJson(521), cloudflareJson(521)], fetchCalls);
  const { error } = await client.from("race_team_orders").select("*");
  assert.ok(error);
  assert.equal(fetchCalls.length, 3);
});

test("#7917 PGRST002 er ikke en af de transiente fejl (op til 12 kald pr. læsning)", async () => {
  const schemaCache = new Response(JSON.stringify({ code: "PGRST002", message: "schema cache" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
  const { wrapped, calls } = build([schemaCache, ok()]);
  await wrapped(URL_, { method: "GET" });
  assert.equal(calls.length, 1);
  assert.equal(isTransientSupabaseError({ code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." }), false);
});

// ── #7917: alle runtime-klienter skal have wrapperen ─────────────────────────
// Kilde-scan, fordi de fleste klienter oprettes som sideeffekt af en import og kræver
// miljø for at loade. backend/scripts/ er CLI-værktøj og står uden for kravet.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIPPED_DIRS = new Set(["node_modules", "scripts", "dist", "coverage", ".git"]);
const SOURCE_FILE_RE = /\.(?:js|mjs|cjs|ts)$/;
const NON_RUNTIME_FILE_RE = /\.test\.[cm]?[jt]s$|^test-setup\.js$/;

function runtimeSourceFiles(dir = BACKEND_ROOT) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : runtimeSourceFiles(full);
    return SOURCE_FILE_RE.test(entry.name) && !NON_RUNTIME_FILE_RE.test(entry.name) ? [full] : [];
  });
}

// Finder hvert createClient(...)-kald: hvad det tildeles, og om det har wrapperen.
function findSupabaseClients(source) {
  const code = source.split("\n").map((line) => (/^\s*(?:\/\/|\/?\*)/.test(line) ? "" : line)).join("\n");
  return [...code.matchAll(/\bcreateClient\s*\(/g)].map((match) => {
    const open = match.index + match[0].length;
    let depth = 1;
    let end = open;
    while (end < code.length && depth > 0) {
      if (code[end] === "(") depth += 1;
      if (code[end] === ")") depth -= 1;
      end += 1;
    }
    const assignedTo = /(?:const|let|var)\s+(\w+)\s*=\s*$/.exec(code.slice(0, match.index))?.[1] ?? null;
    return { assignedTo, wrapped: /\bfetch:\s*createSupabaseFetchWithRetry\(/.test(code.slice(open, end)) };
  });
}

test("#7917 scanneren fanger en klient uden wrapper og ser bort fra kommentarer", () => {
  const unwrapped = findSupabaseClients("const a = createClient(url, key, { auth: { persistSession: false } });");
  assert.deepEqual(unwrapped, [{ assignedTo: "a", wrapped: false }]);

  const lazy = findSupabaseClients("x.then(({ createClient }) => (\n  createClient(url, key)\n));");
  assert.deepEqual(lazy, [{ assignedTo: null, wrapped: false }]);

  const wrapped = findSupabaseClients("const b = createClient(url, key, {\n  global: { fetch: createSupabaseFetchWithRetry() },\n});");
  assert.deepEqual(wrapped, [{ assignedTo: "b", wrapped: true }]);

  assert.deepEqual(findSupabaseClients("// createClient(url, key)\n * createClient(url, key)"), []);
});

test("#7917 alle runtime-klienter bruger fetch-wrapperen (kun health er undtaget)", () => {
  const clients = runtimeSourceFiles().flatMap((file) => {
    const source = readFileSync(file, "utf8");
    if (!source.includes("createClient")) return [];
    const relative = path.relative(BACKEND_ROOT, file).split(path.sep).join("/");
    return findSupabaseClients(source).map((client) => ({ ...client, relative }));
  });
  const isHealthClient = (client) => client.relative === "server.js" && client.assignedTo === "healthSupabase";

  assert.ok(clients.length >= 9, `scanneren fandt kun ${clients.length} klienter, så den tester intet`);
  assert.deepEqual(
    clients.filter((client) => !client.wrapped && !isHealthClient(client)).map((client) => client.relative),
    [],
    "en runtime-klient mangler global: { fetch: createSupabaseFetchWithRetry() }",
  );
  // /health/ready skal måle databasen, som den er, uden gentagelser foran.
  assert.deepEqual(clients.filter(isHealthClient).map((client) => client.wrapped), [false]);
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

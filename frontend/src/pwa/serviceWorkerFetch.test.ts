import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://pwa.test";
type Input = { url: string; method: string; mode: string; destination: string; headers: Headers; credentials: string };
function request(path: string, overrides: Partial<Input> = {}): Input {
  return { url: new URL(path, ORIGIN).href, method: "GET", mode: "navigate", destination: "document", headers: new Headers({ Authorization: "Bearer fixture-token" }), credentials: "include", ...overrides };
}
function harness() {
  const handlers = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const writes: string[] = [];
  const fetches: Input[] = [];
  let offline = false;
  let claimed = 0;
  let skipped = 0;
  let preloadEnabled = 0;
  const key = (value: string | Request) => typeof value === "string" ? new URL(value, ORIGIN).href : value.url;
  const store = (name: string) => {
    let entries = stores.get(name);
    if (!entries) { entries = new Map(); stores.set(name, entries); }
    return entries;
  };
  class RelativeRequest extends Request {
    constructor(value: string | Request, options?: RequestInit) { super(typeof value === "string" ? new URL(value, ORIGIN) : value, options); }
  }
  vm.runInNewContext(source, {
    URL, Request: RelativeRequest, Response, Headers,
    self: {
      location: { origin: ORIGIN },
      addEventListener: (name: string, callback: (event: unknown) => void) => handlers.set(name, callback),
      skipWaiting: async () => { skipped += 1; },
      registration: { navigationPreload: { enable: async () => { preloadEnabled += 1; } } },
      clients: { claim: async () => { claimed += 1; } },
    },
    caches: {
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      open: async (name: string) => ({
        put: async (input: string | Request, response: Response) => { writes.push(key(input)); store(name).set(key(input), response.clone()); },
        add: async (input: Request) => { writes.push(key(input)); store(name).set(key(input), new Response("<svg>cached logo</svg>", { headers: { "Content-Type": "image/svg+xml" } })); },
        match: async (input: string | Request) => store(name).get(key(input))?.clone(),
      }),
    },
    fetch: async (input: Input) => {
      fetches.push(input);
      if (offline) throw new TypeError("Network unavailable");
      return new Response("fresh network response");
    },
  });
  async function lifecycle(name: string) {
    let pending: Promise<unknown> | undefined;
    handlers.get(name)!({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
    await pending;
  }
  function fetch(input: Input, preloadResponse: Promise<Response | undefined> = Promise.resolve(undefined)) {
    let response: Promise<Response> | undefined;
    handlers.get("fetch")!({ request: input, preloadResponse, respondWith: (value: Promise<Response>) => { response = value; } });
    return response;
  }
  return { stores, writes, fetches, lifecycle, fetch, offline: () => { offline = true; }, counters: () => ({ claimed, skipped, preloadEnabled }) };
}

test("a rejected navigation preload still tries the authenticated network request", async () => {
  const worker = harness();
  await worker.lifecycle("install");
  const input = request("/dashboard");
  const response = await worker.fetch(input, Promise.reject(new TypeError("preload failed")));
  assert.equal(await response!.text(), "fresh network response");
  assert.deepEqual(worker.fetches, [input]);
  assert.equal(worker.fetches[0].headers.get("Authorization"), "Bearer fixture-token");
  assert.equal(worker.fetches[0].credentials, "include");
});

test("a successful navigation preload is returned without a duplicate request", async () => {
  const worker = harness();
  const response = await worker.fetch(request("/login?next=/dashboard"), Promise.resolve(new Response("preloaded login")));
  assert.equal(await response!.text(), "preloaded login");
  assert.equal(worker.fetches.length, 0);
});

test("offline navigation shows only the selected offline page, never cached app or game data", async () => {
  const worker = harness();
  await worker.lifecycle("install");
  for (const entries of worker.stores.values()) entries.set(ORIGIN + "/dashboard", new Response("PRIVATE GAME DATA"));
  worker.offline();
  const response = await worker.fetch(request("/dashboard", { headers: new Headers({ "Accept-Language": "da-DK, en;q=0.8" }) }));
  const html = await response!.text();
  assert.match(html, /<html lang="da">/);
  assert.match(html, /name="robots" content="noindex"/);
  assert.doesNotMatch(html, /PRIVATE GAME DATA|\/assets\//);
});

test("only the exact same-origin offline logo gains a network-first cache fallback", async () => {
  const worker = harness();
  await worker.lifecycle("install");
  const logo = request("/favicon.svg", { mode: "no-cors", destination: "image" });
  const onlineResponse = worker.fetch(logo);
  assert.ok(onlineResponse, "the offline page logo must have a worker response");
  assert.equal(await (await onlineResponse).text(), "fresh network response");
  worker.offline();
  const response = await worker.fetch(logo);
  assert.equal(await response!.text(), "<svg>cached logo</svg>");
  assert.equal(worker.fetch(request("/favicon.svg?other=1", { mode: "no-cors", destination: "image" })), undefined);
});

test("bundles, API calls, Supabase, auth posts and other images remain outside the worker", () => {
  const worker = harness();
  for (const input of [
    request("/assets/app-old.js", { mode: "cors", destination: "script" }),
    request("/assets/app.css", { mode: "cors", destination: "style" }),
    request("/api/auctions", { mode: "cors", destination: "" }),
    request("https://fixture.supabase.co/rest/v1/teams", { mode: "cors", destination: "" }),
    request("/login", { method: "POST" }),
    request("/icons/icon-192.png", { mode: "no-cors", destination: "image" }),
    request("https://other.test/favicon.svg", { mode: "no-cors", destination: "image" }),
  ]) assert.equal(worker.fetch(input), undefined, input.url);
  assert.equal(worker.fetches.length, 0);
  assert.equal(worker.writes.length, 0);
});

test("install writes only offline documents and their logo", async () => {
  const worker = harness();
  await worker.lifecycle("install");
  assert.deepEqual(worker.writes.map(url => new URL(url).pathname + new URL(url).search).sort(), ["/__cz-offline?lang=da", "/__cz-offline?lang=en", "/favicon.svg"]);
  assert.equal(worker.counters().skipped, 1);
});

test("activation removes only superseded Cycling Zone caches and retains the current offline page", async () => {
  const worker = harness();
  worker.stores.set("cz-sw-offline-obsolete", new Map());
  worker.stores.set("unrelated-owner", new Map());
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  assert.equal(worker.stores.has("cz-sw-offline-obsolete"), false);
  assert.equal(worker.stores.has("unrelated-owner"), true);
  assert.equal(worker.stores.size, 2);
  assert.deepEqual(worker.counters(), { claimed: 1, skipped: 1, preloadEnabled: 1 });
});

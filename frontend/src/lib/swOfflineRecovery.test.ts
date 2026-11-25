import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

const serviceWorker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const worker = createContext({ self: new EventTarget() });
runInContext(serviceWorker, worker);
const html: string = runInContext("offlineHtml(OFFLINE_COPY.en)", worker);
const offlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(offlineScript);

function offlinePage(visibilityState = "visible", session = new Map<string, string>(), rejectStorageWrite = false) {
  const events = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState });
  const timers = new Map<number, { due: number; callback: () => void }>();
  const requests: { url: string; options: RequestInit; resolve: (response: { ok: boolean }) => void; reject: (error: Error) => void }[] = [];
  let clock = 0;
  let timerId = 0;
  let reloads = 0;
  runInContext(offlineScript!, createContext({
    AbortController,
    Date: { now: () => 1_000_000 + clock },
    document,
    performance: { now: () => clock },
    location: { href: "https://game.test/team?tab=roster#senior", reload: () => { reloads += 1; } },
    sessionStorage: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (rejectStorageWrite) throw new Error("QuotaExceededError");
        session.set(key, value);
      },
    },
    fetch: (url: string, options: RequestInit) => new Promise((resolve, reject) => {
      const request = { url, options, resolve, reject };
      requests.push(request);
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    setTimeout: (callback: () => void, delay: number) => {
      timers.set(++timerId, { due: clock + delay, callback });
      return timerId;
    },
    clearTimeout: (id: number) => { timers.delete(id); },
  }));
  return {
    requests,
    timers,
    get reloads() { return reloads; },
    event(name: string) { events.dispatchEvent(new Event(name)); },
    visibility(state: string) {
      document.visibilityState = state;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    async advance(milliseconds: number) {
      clock += milliseconds;
      for (const [id, { due, callback }] of [...timers]) {
        if (due > clock || !timers.delete(id)) continue;
        callback();
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    },
  };
}

test("offline recovery probes on return and backs off after transport errors or 5xx", async () => {
  const page = offlinePage("hidden");
  await page.advance(30_000);
  assert.equal(page.requests.length, 0);
  page.visibility("visible");
  page.event("pageshow");
  page.event("online");
  assert.equal(page.requests.length, 1);
  assert.match(page.requests[0].url, /^https:\/\/game\.test\/team\?tab=roster/);
  assert.equal(page.requests[0].options.method, "HEAD");
  assert.equal(page.requests[0].options.cache, "no-store");

  page.requests[0].reject(new Error("DNS unavailable"));
  await page.advance(0);
  assert.equal(page.reloads, 0);
  page.event("pageshow");
  await page.advance(4_999);
  assert.equal(page.requests.length, 1);
  await page.advance(1);
  page.requests[1].resolve({ ok: false });
  await page.advance(0);
  assert.equal(page.reloads, 0);
  assert.equal(page.timers.size, 1);

  await page.advance(10_000);
  page.requests[2].resolve({ ok: true });
  await page.advance(0);
  assert.equal(page.reloads, 1);
  assert.equal(page.timers.size, 0);
  page.event("pageshow");
  page.event("online");
  page.visibility("visible");
  await page.advance(60_000);
  assert.equal(page.requests.length, 3);
});

test("offline recovery cancels the pending probe on pagehide and resumes after pageshow", async () => {
  const page = offlinePage();
  page.event("pageshow");
  await page.advance(5_000);
  assert.equal(page.requests.length, 1);
  page.event("pagehide");
  await page.advance(0);
  assert.equal(page.requests[0].options.signal?.aborted, true);
  assert.equal(page.timers.size, 0);
  page.event("pageshow");
  assert.equal(page.requests.length, 2);
  page.requests[1].resolve({ ok: true });
  await page.advance(0);
  assert.equal(page.reloads, 1);
  assert.match(html, /onclick="location\.reload\(\)"/);
});

test("a failed recovery navigation cannot cause immediate reloads across offline documents", async () => {
  const session = new Map<string, string>();
  const first = offlinePage("visible", session);
  first.event("pageshow");
  await first.advance(5_000);
  first.requests[0].resolve({ ok: true });
  await first.advance(0);
  assert.equal(first.reloads, 1);

  // HEAD was successful, but the new navigation again returned the offline document.
  const second = offlinePage("visible", session);
  second.event("pageshow");
  second.event("online");
  await second.advance(59_999);
  assert.equal(second.requests.length, 0);
  assert.equal(second.reloads, 0);
  await second.advance(1);
  second.requests[0].resolve({ ok: true });
  await second.advance(0);
  assert.equal(second.reloads, 1);
});

test("an offline document waits before probing when tab storage cannot save reload state", async () => {
  const session = new Map<string, string>();
  const first = offlinePage("visible", session, true);
  first.event("pageshow");
  await first.advance(5_000);
  first.requests[0].resolve({ ok: true });
  await first.advance(0);
  assert.equal(first.reloads, 1);
  assert.equal(session.size, 0);

  const second = offlinePage("visible", session, true);
  second.event("pageshow");
  second.event("online");
  await second.advance(4_999);
  assert.equal(second.requests.length, 0);
  await second.advance(1);
  assert.equal(second.requests.length, 1);
});

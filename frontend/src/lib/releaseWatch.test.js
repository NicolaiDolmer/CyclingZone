import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKGROUND_THRESHOLD_MS,
  MIN_CHECK_INTERVAL_MS,
  PENDING_TELEMETRY_KEY,
  claimReloadSlot,
  createReleaseWatcher,
  getReloadGuardKey,
  hardReload,
  isComparableRelease,
  isNewRelease,
  isSafeToReload,
  parseRelease,
  rememberPendingTelemetry,
  takePendingTelemetry,
} from "./releaseWatch.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function jsonResponse(body, ok = true) {
  return { ok, text: async () => body };
}

// --- versions-sammenligning ------------------------------------------------

test("isComparableRelease afviser release.js' fallback-vaerdier", () => {
  assert.equal(isComparableRelease("a1b2c3d"), true);
  assert.equal(isComparableRelease(" a1b2c3d "), true);
  assert.equal(isComparableRelease(""), false);
  assert.equal(isComparableRelease("   "), false);
  assert.equal(isComparableRelease("dev"), false);
  assert.equal(isComparableRelease("unknown"), false);
  assert.equal(isComparableRelease(undefined), false);
  assert.equal(isComparableRelease(null), false);
  assert.equal(isComparableRelease(42), false);
});

test("isNewRelease er sand KUN ved to forskellige, kendte releases", () => {
  assert.equal(isNewRelease("aaa111", "bbb222"), true);
  assert.equal(isNewRelease("aaa111", "aaa111"), false);
  assert.equal(isNewRelease("aaa111", " aaa111 "), false, "whitespace er ikke en ny release");
});

test("isNewRelease er fail-closed naar en side er ukendt", () => {
  // Uden en paalidelig sammenligning maa vi ALDRIG genindlaese: prisen for en
  // falsk positiv er at brugeren mister siden under sig uden grund.
  assert.equal(isNewRelease("dev", "bbb222"), false);
  assert.equal(isNewRelease("unknown", "bbb222"), false);
  assert.equal(isNewRelease("", "bbb222"), false);
  assert.equal(isNewRelease("aaa111", ""), false);
  assert.equal(isNewRelease("aaa111", "unknown"), false);
  assert.equal(isNewRelease(undefined, undefined), false);
});

// --- parsing ---------------------------------------------------------------

test("parseRelease laeser version.json", () => {
  assert.equal(parseRelease('{"release":"abc123"}'), "abc123");
  assert.equal(parseRelease('  {"release":" abc123 "}  '), "abc123");
  assert.equal(parseRelease('{"release":""}'), "");
  assert.equal(parseRelease('{"other":"abc123"}'), "");
  assert.equal(parseRelease('{"release":123}'), "");
  assert.equal(parseRelease("{ikke json"), "");
});

test("parseRelease falder tilbage til <meta name=cz-release> i HTML", () => {
  // Mangler /version.json paa et deployment, svarer Vercel-rewriten med
  // app.html — der baerer samme sha i sit meta-tag.
  const html = '<!DOCTYPE html><html><head><meta name="cz-release" content="deadbee" /></head></html>';
  assert.equal(parseRelease(html), "deadbee");
  assert.equal(parseRelease("<html><head><meta name='cz-release' content='beefcafe'></head></html>"), "beefcafe");
  assert.equal(parseRelease("<html><head></head></html>"), "");
  assert.equal(parseRelease(""), "");
  assert.equal(parseRelease(null), "");
});

// --- throttle --------------------------------------------------------------

test("createReleaseWatcher tjekker hoejst én gang pr. interval", async () => {
  let clock = 1_000_000;
  let calls = 0;
  const watcher = createReleaseWatcher({
    currentRelease: "aaa111",
    now: () => clock,
    fetchFn: async () => {
      calls += 1;
      return jsonResponse('{"release":"aaa111"}');
    },
  });

  assert.equal((await watcher.check()).status, "ok");
  assert.equal(calls, 1);

  clock += MIN_CHECK_INTERVAL_MS - 1;
  assert.equal((await watcher.check()).status, "throttled");
  assert.equal(calls, 1, "et tjek inden for vinduet rammer ikke netvaerket");

  clock += 1;
  assert.equal((await watcher.check()).status, "ok");
  assert.equal(calls, 2);
});

test("createReleaseWatcher: force springer throttlen over", async () => {
  let calls = 0;
  const watcher = createReleaseWatcher({
    currentRelease: "aaa111",
    now: () => 0,
    fetchFn: async () => {
      calls += 1;
      return jsonResponse('{"release":"aaa111"}');
    },
  });
  await watcher.check();
  await watcher.check({ force: true });
  assert.equal(calls, 2);
});

test("createReleaseWatcher deduplikerer samtidige tjek", async () => {
  let calls = 0;
  let release;
  const watcher = createReleaseWatcher({
    currentRelease: "aaa111",
    now: () => 0,
    fetchFn: () => {
      calls += 1;
      return new Promise((resolve) => {
        release = () => resolve(jsonResponse('{"release":"bbb222"}'));
      });
    },
  });
  const first = watcher.check();
  const second = watcher.check();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.isNew, true);
  assert.deepEqual(a, b);
});

test("createReleaseWatcher melder ny release", async () => {
  const watcher = createReleaseWatcher({
    currentRelease: "aaa111",
    now: () => 0,
    fetchFn: async () => jsonResponse('{"release":"bbb222"}'),
  });
  assert.deepEqual(await watcher.check(), { status: "ok", release: "bbb222", isNew: true });
});

test("createReleaseWatcher er slaaet fra uden sammenlignelig release", async () => {
  let calls = 0;
  const watcher = createReleaseWatcher({
    currentRelease: "dev",
    now: () => 0,
    fetchFn: async () => {
      calls += 1;
      return jsonResponse('{"release":"bbb222"}');
    },
  });
  assert.deepEqual(await watcher.check(), { status: "disabled" });
  assert.equal(calls, 0, "dev-serveren maa aldrig ramme netvaerket for dette");
});

test("createReleaseWatcher swallower netvaerksfejl og braender vinduet", async () => {
  let clock = 0;
  let calls = 0;
  const watcher = createReleaseWatcher({
    currentRelease: "aaa111",
    now: () => clock,
    fetchFn: async () => {
      calls += 1;
      throw new TypeError("Load failed");
    },
  });
  assert.deepEqual(await watcher.check(), { status: "error" });
  assert.equal((await watcher.check()).status, "throttled");
  assert.equal(calls, 1, "et daarligt netvaerk giver ikke et kald pr. navigation");
  clock += MIN_CHECK_INTERVAL_MS;
  assert.deepEqual(await watcher.check(), { status: "error" });
  assert.equal(calls, 2);
});

test("createReleaseWatcher behandler ikke-ok svar som fejl", async () => {
  const watcher = createReleaseWatcher({
    currentRelease: "aaa111",
    now: () => 0,
    fetchFn: async () => jsonResponse('{"release":"bbb222"}', false),
  });
  assert.deepEqual(await watcher.check(), { status: "error" });
});

test("createReleaseWatcher melder ulaeseligt svar som unknown, aldrig som ny", async () => {
  const watcher = createReleaseWatcher({
    currentRelease: "aaa111",
    now: () => 0,
    fetchFn: async () => jsonResponse("<html>en fejlside uden meta</html>"),
  });
  const result = await watcher.check();
  assert.equal(result.status, "unknown");
  assert.notEqual(result.isNew, true);
});

// --- reload-sikkerhed ------------------------------------------------------

test("isSafeToReload: aldrig i baggrunden", () => {
  assert.equal(isSafeToReload({ visibilityState: "hidden", activeElement: null }), false);
  assert.equal(isSafeToReload({ visibilityState: "visible", activeElement: null }), true);
  assert.equal(isSafeToReload(null), false);
});

test("isSafeToReload: aldrig midt i input", () => {
  const doc = (activeElement) => ({ visibilityState: "visible", activeElement });
  assert.equal(isSafeToReload(doc({ tagName: "INPUT" })), false);
  assert.equal(isSafeToReload(doc({ tagName: "TEXTAREA" })), false);
  assert.equal(isSafeToReload(doc({ tagName: "SELECT" })), false);
  assert.equal(isSafeToReload(doc({ tagName: "DIV", isContentEditable: true })), false);
  assert.equal(isSafeToReload(doc({ tagName: "BODY" })), true);
  assert.equal(isSafeToReload(doc({ tagName: "BUTTON" })), true);
  assert.equal(isSafeToReload(doc({ tagName: "A" })), true);
});

test("claimReloadSlot giver ét reload pr. maal-release", () => {
  const storage = memoryStorage();
  assert.equal(claimReloadSlot(storage, "bbb222"), true);
  assert.equal(claimReloadSlot(storage, "bbb222"), false, "ingen reload-loop");
  assert.equal(claimReloadSlot(storage, "ccc333"), true, "en NY release faar sit eget slot");
  assert.equal(storage.getItem(getReloadGuardKey("bbb222")), "1");
});

test("claimReloadSlot tillader forsoeget naar storage kaster (privat browsing)", () => {
  const hostile = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
  };
  assert.equal(claimReloadSlot(hostile, "bbb222"), true);
  assert.equal(claimReloadSlot(null, "bbb222"), true);
});

test("hardReload laver et fuldt dokument-load af den aktuelle URL", () => {
  const calls = [];
  const win = {
    location: {
      href: "https://cyclingzone.org/dashboard?tab=squad",
      assign: (url) => calls.push(["assign", url]),
      reload: () => calls.push(["reload"]),
    },
  };
  hardReload(win);
  assert.deepEqual(calls, [["assign", "https://cyclingzone.org/dashboard?tab=squad"]]);
});

test("hardReload bruger reload() naar URL'en har et fragment", () => {
  // assign() til samme URL med fragment ville kun scrolle — intet dokument-load,
  // og dermed ingen nye chunks.
  const calls = [];
  const win = {
    location: {
      href: "https://cyclingzone.org/help#auctions",
      assign: (url) => calls.push(["assign", url]),
      reload: () => calls.push(["reload"]),
    },
  };
  hardReload(win);
  assert.deepEqual(calls, [["reload"]]);
});

test("hardReload er en no-op uden location", () => {
  assert.doesNotThrow(() => hardReload(undefined));
  assert.doesNotThrow(() => hardReload({}));
});

// --- telemetri over navigationen -------------------------------------------

test("pending telemetri overlever reloadet og laeses kun én gang", () => {
  const storage = memoryStorage();
  rememberPendingTelemetry(storage, { from: "aaa111", to: "bbb222", trigger: "navigation" });
  assert.equal(typeof storage.getItem(PENDING_TELEMETRY_KEY), "string");
  assert.deepEqual(takePendingTelemetry(storage), {
    from: "aaa111",
    to: "bbb222",
    trigger: "navigation",
  });
  assert.equal(takePendingTelemetry(storage), null, "eventet maa ikke fyre to gange");
});

test("takePendingTelemetry er fail-closed ved skrald", () => {
  const storage = memoryStorage();
  assert.equal(takePendingTelemetry(storage), null);
  storage.setItem(PENDING_TELEMETRY_KEY, "ikke json");
  assert.equal(takePendingTelemetry(storage), null);
  storage.setItem(PENDING_TELEMETRY_KEY, '{"from":"aaa111"}');
  assert.equal(takePendingTelemetry(storage), null, "uden 'to' er der intet at maale");
  storage.setItem(PENDING_TELEMETRY_KEY, '{"to":"bbb222"}');
  assert.deepEqual(takePendingTelemetry(storage), { from: "", to: "bbb222", trigger: "unknown" });
});

test("baggrunds-taersklen er 5 minutter (issue-designet)", () => {
  assert.equal(BACKGROUND_THRESHOLD_MS, 5 * 60_000);
  assert.equal(MIN_CHECK_INTERVAL_MS, 60_000);
});

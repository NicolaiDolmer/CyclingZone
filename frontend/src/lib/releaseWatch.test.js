import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKGROUND_THRESHOLD_MS,
  MIN_CHECK_INTERVAL_MS,
  PENDING_TELEMETRY_KEY,
  PERIODIC_CHECK_INTERVAL_MS,
  canHardReload,
  claimReloadSlot,
  createReleaseReloader,
  createReleaseWatcher,
  getReloadGuardKey,
  hardReload,
  installReleaseWatchHandlers,
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

// Minimal event-target-attrap: installReleaseWatchHandlers rører kun
// add/removeEventListener, saa hele fokus- og interval-stien kan koeres uden
// en browser.
function fakeEnv({ visibilityState = "visible" } = {}) {
  const listeners = new Map();
  const addEventListener = (type, fn) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  };
  const removeEventListener = (type, fn) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((registered) => registered !== fn));
  };
  const doc = { visibilityState, addEventListener, removeEventListener };
  return {
    doc,
    target: { addEventListener, removeEventListener },
    dispatch: (type) => {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    listenerCount: () => [...listeners.values()].reduce((sum, fns) => sum + fns.length, 0),
  };
}

// Falske intervaller: tiden i testen skal ikke gaa i rigtige 5 minutter.
function fakeInterval() {
  const state = { fn: null, ms: null, cleared: [] };
  return {
    state,
    timers: {
      set: (fn, ms) => {
        state.fn = fn;
        state.ms = ms;
        return "interval-handle";
      },
      clear: (handle) => state.cleared.push(handle),
    },
  };
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

test("claimReloadSlot er fail-CLOSED uden brugbar storage", () => {
  // Review 11/9: fail-open her ville vaere en uendelig reload-ring, hvis
  // reloadet ikke leverer den nye release (CDN-skaevhed midt i et rollout) —
  // per-page-load-flaget doer jo med page-loadet. Samme valg som
  // shouldAttemptChunkReload i chunkErrors.js.
  const throwsOnWrite = {
    getItem: () => null,
    setItem() { throw new Error("QuotaExceededError"); },
  };
  const throwsOnRead = {
    getItem() { throw new Error("SecurityError"); },
    setItem() {},
  };
  assert.equal(claimReloadSlot(throwsOnWrite, "bbb222"), false, "setItem kaster -> intet reload");
  assert.equal(claimReloadSlot(throwsOnRead, "bbb222"), false, "getItem kaster -> intet reload");
  assert.equal(claimReloadSlot(null, "bbb222"), false, "ingen storage -> intet reload");
  assert.equal(claimReloadSlot(undefined, "bbb222"), false);
});

// --- navigations-guard (#3602) ---------------------------------------------

test("canHardReload: et dokument der bliver liggende svarer paa proben", async () => {
  const win = { location: { href: "https://cyclingzone.org/team" }, fetch: async () => ({ ok: true }) };
  assert.equal(await canHardReload(win), true);
});

test("canHardReload er fail-closed: navigation in flight, ingen fetch, ingen url", async () => {
  const navigatingAway = {
    location: { href: "https://cyclingzone.org/team" },
    fetch: async () => { throw new TypeError("Load failed"); },
  };
  assert.equal(await canHardReload(navigatingAway), false, "afvist fetch -> intet reload");
  assert.equal(await canHardReload({ location: { href: "https://cyclingzone.org/team" } }), false);
  assert.equal(await canHardReload({ fetch: async () => ({ ok: true }) }), false);
  assert.equal(await canHardReload(undefined), false);
});

test("canHardReload prober den URL brugeren staar paa, uden cache", async () => {
  const seen = [];
  const win = {
    location: { href: "https://cyclingzone.org/auctions" },
    fetch: async (url, options) => { seen.push([url, options?.cache]); return { ok: true }; },
  };
  await canHardReload(win);
  assert.deepEqual(seen, [["https://cyclingzone.org/auctions", "no-store"]]);
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
  assert.equal(PERIODIC_CHECK_INTERVAL_MS, 5 * 60_000);
});

// --- triggere: fokus efter baggrund + periodisk tjek ------------------------

function harness({ visibilityState = "visible", start = 1_000_000 } = {}) {
  const env = fakeEnv({ visibilityState });
  const interval = fakeInterval();
  const triggers = [];
  const state = { clock: start };
  const uninstall = installReleaseWatchHandlers({
    target: env.target,
    doc: env.doc,
    now: () => state.clock,
    timers: interval.timers,
    runCheck: (trigger) => { triggers.push(trigger); },
  });
  return { env, interval, triggers, state, uninstall };
}

test("focus-stien: window-focus efter lang baggrund giver et tjek", () => {
  // Desktop-alt-tab aendrer ofte IKKE visibilityState — uden window-focus
  // findes tab-fokus-stien reelt ikke paa desktop.
  const h = harness();
  h.env.dispatch("blur");
  h.state.clock += BACKGROUND_THRESHOLD_MS + 1;
  h.env.dispatch("focus");
  assert.deepEqual(h.triggers, ["focus"]);
  h.uninstall();
});

test("focus-stien: pageshow (bfcache-restore) taeller som fokus", () => {
  const h = harness();
  h.env.doc.visibilityState = "hidden";
  h.env.dispatch("visibilitychange");
  h.state.clock += BACKGROUND_THRESHOLD_MS + 1;
  h.env.doc.visibilityState = "visible";
  h.env.dispatch("pageshow");
  assert.deepEqual(h.triggers, ["focus"]);
  h.uninstall();
});

test("et hurtigt alt-tab er ikke et deploy-vindue", () => {
  const h = harness();
  h.env.dispatch("blur");
  h.state.clock += BACKGROUND_THRESHOLD_MS;
  h.env.dispatch("focus");
  assert.deepEqual(h.triggers, [], "5 min eller mindre giver intet tjek");
  h.uninstall();
});

test("visibilitychange og focus i samme tab-skift giver KUN ét tjek", () => {
  const h = harness();
  h.env.doc.visibilityState = "hidden";
  h.env.dispatch("visibilitychange");
  h.state.clock += BACKGROUND_THRESHOLD_MS + 1;
  h.env.doc.visibilityState = "visible";
  h.env.dispatch("visibilitychange");
  h.env.dispatch("focus");
  assert.deepEqual(h.triggers, ["focus"], "den foerste handler nulstiller baggrunds-uret");
  h.uninstall();
});

test("en fane der aabnes SKJULT faar ogsaa focus-tjekket", () => {
  // Ctrl-klik: fanen har ligget i baggrunden siden mount. Med hiddenAt = 0
  // ville dens foerste fokus vaere "0 ms i baggrunden".
  const h = harness({ visibilityState: "hidden" });
  h.state.clock += BACKGROUND_THRESHOLD_MS + 1;
  h.env.doc.visibilityState = "visible";
  h.env.dispatch("visibilitychange");
  assert.deepEqual(h.triggers, ["focus"]);
  h.uninstall();
});

test("det periodiske tjek fyrer kun mens fanen er synlig og ryddes ved unmount", () => {
  const h = harness();
  assert.equal(h.interval.state.ms, PERIODIC_CHECK_INTERVAL_MS);

  h.interval.state.fn();
  assert.deepEqual(h.triggers, ["interval"]);

  h.env.doc.visibilityState = "hidden";
  h.interval.state.fn();
  assert.deepEqual(h.triggers, ["interval"], "en skjult fane maa hverken tjekke eller genindlaese");

  h.uninstall();
  assert.deepEqual(h.interval.state.cleared, ["interval-handle"], "intervallet skal ryddes ved unmount");
  assert.equal(h.env.listenerCount(), 0, "alle listeners skal afregistreres ved unmount");
});

test("det periodiske tjek gaar gennem den samme 60 s-throttle", async () => {
  const env = fakeEnv();
  const interval = fakeInterval();
  let clock = 0;
  let calls = 0;
  const watcher = createReleaseWatcher({
    currentRelease: "aaa111",
    now: () => clock,
    fetchFn: async () => { calls += 1; return jsonResponse('{"release":"aaa111"}'); },
  });
  const uninstall = installReleaseWatchHandlers({
    target: env.target,
    doc: env.doc,
    now: () => clock,
    timers: interval.timers,
    runCheck: () => watcher.check(),
  });

  await interval.state.fn();
  clock += MIN_CHECK_INTERVAL_MS - 1;
  await interval.state.fn();
  assert.equal(calls, 1, "throttlen deles med alle andre triggere");
  uninstall();
});

test("installReleaseWatchHandlers er en no-op uden et rigtigt target", () => {
  assert.doesNotThrow(() => installReleaseWatchHandlers()());
  assert.doesNotThrow(() => installReleaseWatchHandlers({ target: {}, doc: {} })());
});

// --- hele stien: tjek -> beslutning -> reload -------------------------------

function reloaderHarness({ activeElement = null, releases = ['{"release":"bbb222"}'] } = {}) {
  const doc = { visibilityState: "visible", activeElement };
  const storage = memoryStorage();
  const reloads = [];
  let calls = 0;
  const reloader = createReleaseReloader({
    win: { location: { href: "https://cyclingzone.org/team" }, fetch: async () => ({ ok: true }) },
    doc,
    storage,
    currentRelease: "aaa111",
    watcher: createReleaseWatcher({
      currentRelease: "aaa111",
      now: () => 0,
      fetchFn: async () => { calls += 1; return jsonResponse(releases[Math.min(calls - 1, releases.length - 1)]); },
    }),
    reload: (win) => reloads.push(win.location.href),
  });
  return { doc, storage, reloads, reloader, networkCalls: () => calls };
}

test("focus-stien ender i et reload naar der er ro", async () => {
  const h = reloaderHarness();
  await h.reloader.runCheck("focus");
  assert.deepEqual(h.reloads, ["https://cyclingzone.org/team"]);
  assert.equal(h.storage.getItem(getReloadGuardKey("bbb222")), "1");
  assert.deepEqual(takePendingTelemetry(h.storage), {
    from: "aaa111",
    to: "bbb222",
    trigger: "focus",
  });
});

test("focus-stien genindlaeser IKKE mens der staar tekst i et felt", async () => {
  const h = reloaderHarness({ activeElement: { tagName: "TEXTAREA" } });
  await h.reloader.runCheck("focus");
  assert.deepEqual(h.reloads, [], "brugeren maa ikke miste uafsendt tekst");
  assert.equal(h.reloader.state.pendingRelease, "bbb222", "markoeren bliver liggende");

  // Naeste rolige oejeblik: markoeren bruges uden et nyt netvaerkskald.
  h.doc.activeElement = null;
  await h.reloader.runCheck("navigation");
  assert.deepEqual(h.reloads, ["https://cyclingzone.org/team"]);
  assert.equal(h.networkCalls(), 1, "en allerede bevist release tjekkes ikke igen");
});

test("en afbrudt navigation stjaeler ikke reload-slottet (#3602)", async () => {
  const storage = memoryStorage();
  const reloads = [];
  const reloader = createReleaseReloader({
    win: { location: { href: "https://cyclingzone.org/team" } },
    doc: { visibilityState: "visible", activeElement: null },
    storage,
    currentRelease: "aaa111",
    watcher: createReleaseWatcher({
      currentRelease: "aaa111",
      now: () => 0,
      fetchFn: async () => jsonResponse('{"release":"bbb222"}'),
    }),
    reload: (win) => reloads.push(win.location.href),
    canReload: async () => false,
  });
  await reloader.runCheck("navigation");
  assert.deepEqual(reloads, []);
  assert.equal(storage.getItem(getReloadGuardKey("bbb222")), null, "loop-guarden maa ikke vaere braendt");
});

test("uden brugbar storage sker der intet reload (fail-closed)", async () => {
  const reloads = [];
  const reloader = createReleaseReloader({
    win: { location: { href: "https://cyclingzone.org/team" }, fetch: async () => ({ ok: true }) },
    doc: { visibilityState: "visible", activeElement: null },
    storage: null,
    currentRelease: "aaa111",
    watcher: createReleaseWatcher({
      currentRelease: "aaa111",
      now: () => 0,
      fetchFn: async () => jsonResponse('{"release":"bbb222"}'),
    }),
    reload: (win) => reloads.push(win.location.href),
  });
  await reloader.runCheck("focus");
  assert.deepEqual(reloads, [], "uden loop-guard ville et mislykket reload kunne gentage sig i det uendelige");
});

test("samme release giver aldrig et reload", async () => {
  const h = reloaderHarness({ releases: ['{"release":"aaa111"}'] });
  await h.reloader.runCheck("interval");
  assert.deepEqual(h.reloads, []);
  assert.equal(h.reloader.state.pendingRelease, null);
});

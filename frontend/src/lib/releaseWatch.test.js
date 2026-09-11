import test from "node:test";
import assert from "node:assert/strict";

import {
  canHardReload,
  claimReloadSlot,
  createReleaseReloader,
  createReleaseWatcher,
  getReloadGuardKey,
  hardReload,
  installPendingNavigationInterceptor,
  installReleaseWatchHandlers,
  isComparableRelease,
  isNewRelease,
  isSafeToReload,
  parseVersionPayload,
  readFrontendIdMeta,
  takePendingTelemetry,
  VERSION_FETCH_TIMEOUT_MS,
} from "./releaseWatch.js";
import {
  acquireReloadBlock,
  isReloadAllowed,
  onReloadAllowed,
  __resetReloadGateForTests,
} from "./reloadGate.js";
import { RECOVERY_BUDGET_KEY, RECOVERY_BUDGET_MAX } from "./chunkErrors.js";

// --- testdoubler ------------------------------------------------------------

function fakeStorage({ broken = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem(k) {
      if (broken) throw new Error("SecurityError");
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (broken) throw new Error("SecurityError");
      map.set(k, String(v));
    },
    removeItem(k) {
      if (broken) throw new Error("SecurityError");
      map.delete(k);
    },
  };
}

function fakeDoc({ visibilityState = "visible", activeElement = null } = {}) {
  const listeners = new Map();
  return {
    visibilityState,
    activeElement,
    addEventListener(type, fn, capture) { listeners.set(`${type}:${Boolean(capture)}`, fn); },
    removeEventListener(type, _fn, capture) { listeners.delete(`${type}:${Boolean(capture)}`); },
    fire(type, event, capture = false) { listeners.get(`${type}:${Boolean(capture)}`)?.(event); },
    has(type, capture = false) { return listeners.has(`${type}:${Boolean(capture)}`); },
  };
}

function fakeWin({ href = "https://cyclingzone.org/dashboard" } = {}) {
  const calls = { assign: [], reload: 0 };
  return {
    calls,
    location: {
      href,
      origin: "https://cyclingzone.org",
      assign(url) { calls.assign.push(url); },
      reload() { calls.reload += 1; },
    },
  };
}

// Standard-reloader med alle ydre afhængigheder injiceret, så ingen test rører
// et rigtigt netværk, en rigtig storage eller en rigtig klokke.
function makeReloader(overrides = {}) {
  const win = overrides.win ?? fakeWin();
  const doc = overrides.doc ?? fakeDoc();
  const storage = overrides.storage ?? fakeStorage();
  const reloads = [];
  const reloader = createReleaseReloader({
    win,
    doc,
    storage,
    currentRelease: "sha-a",
    currentFrontendId: "fe-a",
    reload: (w) => reloads.push(w?.location?.href ?? "?"),
    canReload: async () => true,
    isAllowed: isReloadAllowed,
    subscribeAllowed: onReloadAllowed,
    ...overrides,
  });
  return { reloader, reloads, storage, doc, win };
}

function okWatcher(sequence) {
  const queue = [...sequence];
  let last = queue[queue.length - 1];
  return {
    calls: 0,
    async check() {
      this.calls += 1;
      const next = queue.length ? queue.shift() : last;
      last = next;
      return next;
    },
  };
}

test.beforeEach(() => __resetReloadGateForTests());

// --- rene funktioner --------------------------------------------------------

test("parseVersionPayload laeser baade release og frontend-id fra JSON", () => {
  assert.deepEqual(
    parseVersionPayload('{"release":"abc","frontend":"fe-1"}'),
    { release: "abc", frontendId: "fe-1" },
  );
});

test("parseVersionPayload falder tilbage til meta-tags naar svaret er HTML", () => {
  const html = '<html><head><meta name="cz-release" content="abc"><meta name="cz-frontend" content="fe-1"></head></html>';
  assert.deepEqual(parseVersionPayload(html), { release: "abc", frontendId: "fe-1" });
});

test("parseVersionPayload er tom ved skrald i stedet for at gaette", () => {
  assert.deepEqual(parseVersionPayload("{ ikke json"), { release: "", frontendId: "" });
  assert.deepEqual(parseVersionPayload(""), { release: "", frontendId: "" });
  assert.deepEqual(parseVersionPayload(null), { release: "", frontendId: "" });
});

test("isComparableRelease afviser dev/unknown/tom", () => {
  assert.equal(isComparableRelease("fe-1"), true);
  for (const bad of ["", " ", "dev", "unknown", null, 7]) {
    assert.equal(isComparableRelease(bad), false, `${bad} skal ikke kunne sammenlignes`);
  }
});

test("isNewRelease kraever to rigtige id'er der er forskellige", () => {
  assert.equal(isNewRelease("fe-a", "fe-b"), true);
  assert.equal(isNewRelease("fe-a", "fe-a"), false);
  assert.equal(isNewRelease("dev", "fe-b"), false);
  assert.equal(isNewRelease("fe-a", ""), false);
});

test("isSafeToReload afviser skjult fane og fokuseret tekstfelt", () => {
  assert.equal(isSafeToReload(fakeDoc()), true);
  assert.equal(isSafeToReload(fakeDoc({ visibilityState: "hidden" })), false);
  assert.equal(isSafeToReload(fakeDoc({ activeElement: { tagName: "INPUT" } })), false);
  assert.equal(isSafeToReload(fakeDoc({ activeElement: { tagName: "SELECT" } })), false);
  assert.equal(isSafeToReload(fakeDoc({ activeElement: { isContentEditable: true } })), false);
  assert.equal(isSafeToReload(fakeDoc({ activeElement: { tagName: "BUTTON" } })), true);
  assert.equal(isSafeToReload(null), false);
});

test("readFrontendIdMeta er tom naar tagget mangler (deployment fra foer #5159)", () => {
  assert.equal(readFrontendIdMeta({ querySelector: () => null }), "");
  assert.equal(readFrontendIdMeta(undefined), "");
  assert.equal(
    readFrontendIdMeta({ querySelector: () => ({ getAttribute: () => " fe-1 " }) }),
    "fe-1",
  );
});

test("hardReload bruger reload() paa URL'er med hash og assign() ellers", () => {
  const plain = fakeWin();
  hardReload(plain);
  assert.deepEqual(plain.calls.assign, ["https://cyclingzone.org/dashboard"]);
  const hashed = fakeWin({ href: "https://cyclingzone.org/races#stage-3" });
  hardReload(hashed);
  assert.equal(hashed.calls.reload, 1);
  assert.deepEqual(hashed.calls.assign, []);
});

// --- B1: porten -------------------------------------------------------------

test("B1: ugemt arbejde blokerer automatisk reload — markoeren bliver liggende", async () => {
  const { reloader, reloads } = makeReloader({
    watcher: okWatcher([{ status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true }]),
  });
  const release = acquireReloadBlock("dirty");

  await reloader.runCheck("interval");

  assert.deepEqual(reloads, [], "INTET reload mens der er ugemt arbejde");
  assert.equal(reloader.state.pendingRelease, "fe-b", "markoeren er sat");
  assert.equal(reloader.isUpdateReady(), true, "banneret skal vises");
  release();
});

test("B1: det sikre punkt — reloadet sker i samme oejeblik den sidste blokering slippes", async () => {
  const { reloader, reloads } = makeReloader({
    watcher: okWatcher([{ status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true }]),
  });
  const release = acquireReloadBlock("dirty");
  await reloader.runCheck("interval");
  assert.deepEqual(reloads, []);

  release();
  // gate-lytteren er async (attemptReload er en promise).
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(reloads.length, 1, "Gem/annuller frigiver porten og reloadet sker");
});

test("B1: et fokuseret tekstfelt blokerer stadig, ogsaa uden en registreret blokering", async () => {
  const doc = fakeDoc({ activeElement: { tagName: "TEXTAREA" } });
  const { reloader, reloads } = makeReloader({
    doc,
    watcher: okWatcher([{ status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true }]),
  });
  await reloader.runCheck("interval");
  assert.deepEqual(reloads, []);
});

test("spillerens eget klik paa banneret gaar gennem porten — det er hans beslutning", async () => {
  const { reloader, reloads } = makeReloader({
    watcher: okWatcher([{ status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true }]),
  });
  acquireReloadBlock("dirty");
  await reloader.runCheck("interval");
  assert.deepEqual(reloads, [], "ikke automatisk");

  await reloader.applyUpdate();
  assert.equal(reloads.length, 1, "men klikket virker");
});

test("banner-knappen er aldrig et doedt klik — heller ikke naar netvaerks-proben fejler", async () => {
  // Proben er fail-closed og svarer false naar spilleren er offline eller kaldet
  // blokeres. Paa den automatiske sti er det rigtigt; paa den manuelle ville det
  // betyde at spilleren trykkede paa knappen og der skete INGENTING, uden en
  // eneste besked (CodeRabbit 11/9).
  const { reloader, reloads } = makeReloader({
    canReload: async () => false,
    watcher: okWatcher([{ status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true }]),
  });
  await reloader.runCheck("interval");
  assert.deepEqual(reloads, [], "automatisk: proben holder igen, som den skal");

  await reloader.applyUpdate();
  assert.equal(reloads.length, 1, "manuelt: klikket virker alligevel");
});

test("det manuelle klik bruger IKKE af recovery-budgettet", async () => {
  const storage = fakeStorage();
  storage.setItem(RECOVERY_BUDGET_KEY, JSON.stringify({ used: RECOVERY_BUDGET_MAX, windowStart: Date.now() }));
  const { reloader, reloads } = makeReloader({
    storage,
    watcher: okWatcher([{ status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true }]),
  });
  await reloader.runCheck("interval");
  assert.deepEqual(reloads, [], "budgettet er brugt: intet automatisk reload");
  assert.equal(reloader.isUpdateReady(), true, "men spilleren faar banneret");

  await reloader.applyUpdate();
  assert.equal(reloads.length, 1);
});

// --- M1 ---------------------------------------------------------------------

test("et rollback fjerner banneret igen — knappen maa ikke love en opdatering der ikke findes", async () => {
  let gone = 0;
  const watcher = okWatcher([
    { status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true },
    // Rollback / CDN-flip: serveren koerer igen den frontend vi allerede har.
    { status: "ok", release: "sha-a", frontendId: "fe-a", isNew: false },
  ]);
  const { reloader, reloads } = makeReloader({ watcher, onUpdateGone: () => { gone += 1; } });
  acquireReloadBlock("dirty");

  await reloader.runCheck("interval");
  assert.equal(reloader.isUpdateReady(), true);

  await reloader.runCheck("interval");
  assert.equal(reloader.isUpdateReady(), false, "banneret skal vaek igen");
  assert.equal(gone, 1, "hooken faar besked, ellers bliver knappen staaende");

  await reloader.applyUpdate();
  assert.deepEqual(reloads, [], "og der er intet at klikke paa laengere");
});

test("M1: A -> forsoeg paa B -> stadig A -> C opdages (polling fryser ikke)", async () => {
  const storage = fakeStorage();
  // Foerste dokument brugte allerede B's slot; denne fane er starten paa nummer to.
  storage.setItem(getReloadGuardKey("fe-b"), "1");
  const watcher = okWatcher([
    { status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true },
    { status: "ok", release: "sha-c", frontendId: "fe-c", isNew: true },
  ]);
  const { reloader, reloads } = makeReloader({ storage, watcher });

  await reloader.runCheck("navigation");
  assert.deepEqual(reloads, [], "B's slot er brugt — intet nyt reload paa B");
  assert.equal(reloader.state.pendingRelease, null, "markoeren er ryddet, ikke laast fast");

  await reloader.runCheck("interval");
  assert.equal(watcher.calls, 2, "der laves stadig versionsopslag");
  assert.equal(reloads.length, 1, "C bliver opdaget og reloadet");
});

test("M1: en afvist forlad-dialog fryser ikke watcheren for evigt", async () => {
  let clock = 1_000;
  const watcher = okWatcher([{ status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true }]);
  const { reloader, reloads } = makeReloader({
    watcher,
    now: () => clock,
    settleMs: 10_000,
  });

  await reloader.runCheck("interval");
  assert.equal(reloads.length, 1);
  assert.equal(reloader.state.reloading, true, "vi tror vi er paa vej vaek");

  // Spilleren afviste sidens beforeunload; dokumentet lever videre.
  clock += 11_000;
  await reloader.runCheck("interval");
  assert.equal(reloader.state.reloading, false, "flaget udloeb, watcheren arbejder igen");
  assert.equal(watcher.calls, 2, "og der laves versionsopslag igen");
});

// --- M2 ---------------------------------------------------------------------

test("M2: et haengende versionskald aborteres af deadlinen og blokerer ikke naeste vindue", async () => {
  let clock = 0;
  const timeouts = [];
  const aborts = [];
  class FakeAbort {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; aborts.push(1); }
  }
  let fetchCalls = 0;
  const watcher = createReleaseWatcher({
    currentFrontendId: "fe-a",
    now: () => clock,
    minIntervalMs: 60_000,
    AbortCtor: FakeAbort,
    timers: {
      set: (fn) => { timeouts.push(fn); return timeouts.length - 1; },
      clear: () => {},
    },
    fetchFn: (_url, opts) =>
      new Promise((_resolve, reject) => {
        fetchCalls += 1;
        // Et kald der aldrig svarer — indtil signalet aborteres.
        const iv = setInterval(() => {
          if (opts?.signal?.aborted) { clearInterval(iv); reject(new Error("AbortError")); }
        }, 1);
        iv.unref?.();
      }),
  });

  const first = watcher.check();
  // Deadlinen rammer.
  timeouts[0]();
  const result = await first;
  assert.equal(result.status, "timeout");
  assert.equal(aborts.length, 1, "AbortController blev faktisk brugt");

  clock += 60_001;
  watcher.check();
  assert.equal(fetchCalls, 2, "naeste vindue henter igen — inFlight blev frigivet");
  timeouts[1]?.();
});

test("M2: deadlinen daekker ogsaa body-laesningen, ikke kun svaret", async () => {
  const timeouts = [];
  class FakeAbort {
    constructor() { this.signal = { aborted: false }; }
    abort() { this.signal.aborted = true; }
  }
  const watcher = createReleaseWatcher({
    currentFrontendId: "fe-a",
    AbortCtor: FakeAbort,
    timers: { set: (fn) => { timeouts.push(fn); return timeouts.length - 1; }, clear: () => {} },
    fetchFn: async (_url, opts) => ({
      ok: true,
      // Headers kom, men body'en kommer aldrig.
      text: () => new Promise((_res, rej) => {
        const iv = setInterval(() => {
          if (opts?.signal?.aborted) { clearInterval(iv); rej(new Error("AbortError")); }
        }, 1);
        iv.unref?.();
      }),
    }),
  });
  const pending = watcher.check();
  await new Promise((r) => setTimeout(r, 5));
  timeouts[0]();
  assert.equal((await pending).status, "timeout");
});

test("watcheren er slaaet fra uden et sammenligneligt frontend-id", async () => {
  const watcher = createReleaseWatcher({ currentFrontendId: "", fetchFn: async () => ({ ok: true, text: async () => "{}" }) });
  assert.equal((await watcher.check()).status, "disabled");
});

test("throttlen holder — to tjek inden for vinduet giver eet netvaerkskald", async () => {
  let clock = 0;
  let calls = 0;
  const watcher = createReleaseWatcher({
    currentFrontendId: "fe-a",
    now: () => clock,
    minIntervalMs: 60_000,
    AbortCtor: undefined,
    fetchFn: async () => { calls += 1; return { ok: true, text: async () => '{"release":"sha-a","frontend":"fe-a"}' }; },
  });
  await watcher.check();
  await watcher.check();
  assert.equal(calls, 1);
  clock += 60_001;
  await watcher.check();
  assert.equal(calls, 2);
});

test("H4: et deploy der kun aendrer git-sha'en er IKKE en ny frontend", async () => {
  const watcher = createReleaseWatcher({
    currentFrontendId: "fe-a",
    AbortCtor: undefined,
    fetchFn: async () => ({ ok: true, text: async () => '{"release":"sha-nyt","frontend":"fe-a"}' }),
  });
  const result = await watcher.check();
  assert.equal(result.status, "ok");
  assert.equal(result.isNew, false, "docs-/backend-deploy maa ikke genindlaese nogen");
});

test("H4: et deployment uden frontend-id giver status unknown, ikke et gaet", async () => {
  const watcher = createReleaseWatcher({
    currentFrontendId: "fe-a",
    AbortCtor: undefined,
    fetchFn: async () => ({ ok: true, text: async () => '{"release":"sha-b"}' }),
  });
  assert.equal((await watcher.check()).status, "unknown");
});

// --- M3 ---------------------------------------------------------------------

test("M3: uden brugbar storage sker der INTET automatisk reload (fail-closed)", async () => {
  const { reloader, reloads } = makeReloader({
    storage: null,
    watcher: okWatcher([{ status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true }]),
  });
  await reloader.runCheck("interval");
  assert.deepEqual(reloads, []);
  assert.equal(reloader.isUpdateReady(), true, "banneret er den manuelle udvej");
});

test("M3: reloadet bogfoeres i det faelles recovery-budget", async () => {
  const storage = fakeStorage();
  const { reloader, reloads } = makeReloader({
    storage,
    watcher: okWatcher([{ status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true }]),
  });
  await reloader.runCheck("interval");
  assert.equal(reloads.length, 1);
  assert.equal(JSON.parse(storage.getItem(RECOVERY_BUDGET_KEY)).used, 1);
});

test("claimReloadSlot er fail-closed og braender kun een gang pr. maal", () => {
  const storage = fakeStorage();
  assert.equal(claimReloadSlot(storage, "fe-b"), true);
  assert.equal(claimReloadSlot(storage, "fe-b"), false);
  assert.equal(claimReloadSlot(storage, "fe-c"), true);
  assert.equal(claimReloadSlot(null, "fe-b"), false);
  assert.equal(claimReloadSlot(fakeStorage({ broken: true }), "fe-b"), false);
});

// --- M4 ---------------------------------------------------------------------

test("M4: telemetrien siger 'arrived' KUN naar vi faktisk landede paa maalet", () => {
  const storage = fakeStorage();
  storage.setItem("cz:app-version-reload-pending", JSON.stringify({ from: "fe-a", to: "fe-b", trigger: "interval" }));
  const payload = takePendingTelemetry(storage, "fe-b");
  assert.equal(payload.outcome, "arrived");
  assert.equal(payload.actual, "fe-b");
  assert.equal(storage.getItem("cz:app-version-reload-pending"), null, "markoeren ryddes");
});

test("M4: et reload der ikke aendrede noget rapporteres som 'no_effect'", () => {
  const storage = fakeStorage();
  storage.setItem("cz:app-version-reload-pending", JSON.stringify({ from: "fe-a", to: "fe-b", trigger: "interval" }));
  const payload = takePendingTelemetry(storage, "fe-a");
  assert.equal(payload.outcome, "no_effect");
});

test("takePendingTelemetry taaler manglende og oedelagt storage", () => {
  assert.equal(takePendingTelemetry(null, "fe-a"), null);
  assert.equal(takePendingTelemetry(fakeStorage({ broken: true }), "fe-a"), null);
  const storage = fakeStorage();
  storage.setItem("cz:app-version-reload-pending", "{ikke json");
  assert.equal(takePendingTelemetry(storage, "fe-a"), null);
});

// --- H3: navigations-interceptoren -----------------------------------------

test("H3: et klik paa et internt link bliver til et dokument-load af DESTINATIONEN", () => {
  const doc = fakeDoc();
  const win = fakeWin();
  const storage = fakeStorage();
  const uninstall = installPendingNavigationInterceptor({
    doc, win, storage, getTarget: () => "fe-b",
  });
  let prevented = false;
  doc.fire("click", {
    button: 0,
    defaultPrevented: false,
    preventDefault: () => { prevented = true; },
    target: {
      closest: () => ({
        href: "https://cyclingzone.org/auctions",
        getAttribute: () => null,
        hasAttribute: () => false,
      }),
    },
  }, true);
  assert.equal(prevented, true, "routeren maa ikke committe ruten");
  assert.deepEqual(win.calls.assign, ["https://cyclingzone.org/auctions"]);
  uninstall();
  assert.equal(doc.has("click", true), false);
});

test("H3: interceptoren braender hverken loop-guard eller budget — den aendrer kun spillerens eget klik", () => {
  const doc = fakeDoc();
  const win = fakeWin();
  const storage = fakeStorage();
  installPendingNavigationInterceptor({ doc, win, storage, getTarget: () => "fe-b" });
  doc.fire("click", {
    button: 0,
    preventDefault: () => {},
    target: { closest: () => ({ href: "https://cyclingzone.org/auctions", getAttribute: () => null, hasAttribute: () => false }) },
  }, true);
  assert.deepEqual(win.calls.assign, ["https://cyclingzone.org/auctions"]);
  assert.equal(storage.getItem(getReloadGuardKey("fe-b")), null, "slottet skal vaere urørt");
  assert.equal(storage.getItem(RECOVERY_BUDGET_KEY), null, "budgettet skal vaere urørt");
});

test("H3: loftet pr. dokument holder en fane fra at lave fulde sideskift i det uendelige", () => {
  const doc = fakeDoc();
  const win = fakeWin();
  installPendingNavigationInterceptor({
    doc, win, storage: fakeStorage(), getTarget: () => "fe-b", maxPerDocument: 2,
  });
  const click = (href) => doc.fire("click", {
    button: 0,
    preventDefault: () => {},
    target: { closest: () => ({ href, getAttribute: () => null, hasAttribute: () => false }) },
  }, true);
  click("https://cyclingzone.org/a");
  click("https://cyclingzone.org/b");
  click("https://cyclingzone.org/c");
  assert.deepEqual(win.calls.assign, ["https://cyclingzone.org/a", "https://cyclingzone.org/b"]);
});

test("H3: et opbrugt recovery-budget slukker ogsaa interceptoren", () => {
  const doc = fakeDoc();
  const win = fakeWin();
  const storage = fakeStorage();
  storage.setItem(RECOVERY_BUDGET_KEY, JSON.stringify({ used: RECOVERY_BUDGET_MAX, windowStart: Date.now() }));
  installPendingNavigationInterceptor({ doc, win, storage, getTarget: () => "fe-b" });
  doc.fire("click", {
    button: 0,
    preventDefault: () => { throw new Error("maa ikke ske"); },
    target: { closest: () => ({ href: "https://cyclingzone.org/auctions", getAttribute: () => null, hasAttribute: () => false }) },
  }, true);
  assert.deepEqual(win.calls.assign, []);
});

test("M4: en NY maalrelease rapporteres ogsaa som deferred, ikke kun den foerste", async () => {
  const notified = [];
  const watcher = okWatcher([
    { status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true },
    { status: "ok", release: "sha-c", frontendId: "fe-c", isNew: true },
  ]);
  const { reloader } = makeReloader({
    watcher,
    onUpdateReady: ({ target, sha }) => notified.push(`${target}/${sha}`),
  });
  acquireReloadBlock("dirty");
  await reloader.runCheck("interval");
  await reloader.runCheck("interval");
  assert.deepEqual(notified, ["fe-b/sha-b", "fe-c/sha-c"]);
});

test("H3: interceptoren roerer IKKE klikket naar der er ugemt arbejde", () => {
  const doc = fakeDoc();
  const win = fakeWin();
  installPendingNavigationInterceptor({ doc, win, storage: fakeStorage(), getTarget: () => "fe-b" });
  acquireReloadBlock("dirty");
  let prevented = false;
  doc.fire("click", {
    button: 0,
    preventDefault: () => { prevented = true; },
    target: { closest: () => ({ href: "https://cyclingzone.org/auctions", getAttribute: () => null, hasAttribute: () => false }) },
  }, true);
  assert.equal(prevented, false);
  assert.deepEqual(win.calls.assign, []);
});

test("H3: eksterne links, nye faner og modifier-klik gaar urørt igennem", () => {
  const doc = fakeDoc();
  const win = fakeWin();
  installPendingNavigationInterceptor({ doc, win, storage: fakeStorage(), getTarget: () => "fe-b" });
  const anchor = (href, attrs = {}) => ({
    closest: () => ({
      href,
      getAttribute: (n) => attrs[n] ?? null,
      hasAttribute: (n) => n in attrs,
    }),
  });
  const fire = (event) => doc.fire("click", { button: 0, preventDefault: () => { throw new Error("maa ikke ske"); }, ...event }, true);

  fire({ target: anchor("https://discord.gg/abc") });
  fire({ target: anchor("https://cyclingzone.org/auctions", { target: "_blank" }) });
  fire({ target: anchor("https://cyclingzone.org/auctions", { download: "" }) });
  fire({ button: 1, target: anchor("https://cyclingzone.org/auctions") });
  fire({ metaKey: true, target: anchor("https://cyclingzone.org/auctions") });
  fire({ target: { closest: () => null } });
  assert.deepEqual(win.calls.assign, []);
});

// --- triggere ---------------------------------------------------------------

test("intervallet tjekker kun mens fanen er synlig", () => {
  const doc = fakeDoc();
  const win = { addEventListener() {}, removeEventListener() {} };
  const triggers = [];
  let tick;
  const uninstall = installReleaseWatchHandlers({
    target: win,
    doc,
    runCheck: (t) => triggers.push(t),
    timers: { set: (fn) => { tick = fn; return 1; }, clear: () => {} },
  });
  tick();
  assert.deepEqual(triggers, ["interval"]);
  doc.visibilityState = "hidden";
  tick();
  assert.deepEqual(triggers, ["interval"], "en skjult fane hverken henter eller reloader");
  uninstall();
});

test("tab-fokus tjekker foerst efter mere end fem minutter i baggrunden", () => {
  const doc = fakeDoc();
  const listeners = new Map();
  const win = {
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t) => listeners.delete(t),
  };
  const triggers = [];
  let clock = 0;
  installReleaseWatchHandlers({
    target: win, doc, runCheck: (t) => triggers.push(t), now: () => clock,
    timers: { set: () => 1, clear: () => {} },
  });

  listeners.get("blur")();
  clock += 60_000;
  listeners.get("focus")();
  assert.deepEqual(triggers, [], "et hurtigt alt-tab er ikke et deploy-vindue");

  listeners.get("blur")();
  clock += 6 * 60_000;
  listeners.get("focus")();
  assert.deepEqual(triggers, ["focus"]);
});

// --- navigations-guarden ----------------------------------------------------

test("canHardReload er fail-closed naar dokumentet ikke kan hente noget", async () => {
  const win = fakeWin();
  assert.equal(await canHardReload(win, { fetchFn: async () => { throw new Error("Load failed"); } }), false);
  assert.equal(await canHardReload(win, { fetchFn: async () => ({ status: 404 }) }), true);
  assert.equal(await canHardReload({}, {}), false);
});

test("en afbrudt navigation braender ikke det ene reload-slot", async () => {
  const storage = fakeStorage();
  const { reloader, reloads } = makeReloader({
    storage,
    canReload: async () => false,
    watcher: okWatcher([{ status: "ok", release: "sha-b", frontendId: "fe-b", isNew: true }]),
  });
  await reloader.runCheck("navigation");
  assert.deepEqual(reloads, []);
  assert.equal(storage.getItem(getReloadGuardKey("fe-b")), null, "slottet er urørt");
  assert.equal(claimReloadSlot(storage, "fe-b"), true, "en senere, aegte chance findes stadig");
});

test("VERSION_FETCH_TIMEOUT_MS er sat og rimelig", () => {
  assert.ok(VERSION_FETCH_TIMEOUT_MS > 0 && VERSION_FETCH_TIMEOUT_MS <= 15_000);
});

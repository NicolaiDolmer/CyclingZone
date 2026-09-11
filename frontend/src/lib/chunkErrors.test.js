import { test } from "node:test";
import assert from "node:assert/strict";
import {
  __resetRecoveryDeferredForTests,
  accountBootGuardReload,
  attemptRecoveryReload,
  BOOT_GUARD_KEY,
  documentIsStillLoadable,
  getChunkReloadKey,
  hasRecoveryBudget,
  installChunkReloadHandlers,
  isChunkLoadError,
  isUnambiguousChunkLoadError,
  RECOVERY_BUDGET_KEY,
  RECOVERY_BUDGET_MAX,
  RECOVERY_BUDGET_WINDOW_MS,
  safeSessionStorage,
  shouldAttemptChunkReload,
  onRecoveryDeferred,
  spendRecoverySlot,
} from "./chunkErrors.js";
import {
  __resetReloadGateForTests,
  acquireReloadBlock,
  RELOAD_BLOCK_REASONS,
} from "./reloadGate.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

// Minimal EventTarget-stand-in: optager handlers så testen kan dispatche
// syntetiske events uden en DOM (node --test kører uden window).
function fakeTarget() {
  const handlers = {};
  return {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    removeEventListener: (type) => { delete handlers[type]; },
    dispatch: (type, event) => handlers[type]?.(event),
  };
}

// Manuel scheduler i stedet for setTimeout: testen styrer selv hvornår den
// udskudte reload fyrer (flush) — deterministisk, ingen ægte timere.
// #3602: fireReload er async (den kausale navigations-guard afventer en canary-
// fetch), så flush afventer hver opgave.
function manualScheduler() {
  const queue = [];
  return {
    schedule: (fn) => { queue.push(fn); },
    flush: async () => { while (queue.length) await queue.shift()(); },
    get pending() { return queue.length; },
  };
}

// Canary-fetch-stand-ins for den kausale navigations-guard (#3602).
// Dokumentet bliver liggende → fetchen svarer.
const stayingDocument = () => Promise.resolve({ ok: true, status: 200 });
// En navigation er startet → browseren afviser nye fetches (WebKit: TypeError
// "Load failed" efter ~16 ms).
const navigatingAwayDocument = () => Promise.reject(new TypeError("Load failed"));

const PROBE = { fetchFn: stayingDocument, url: "https://cyclingzone.org/dashboard" };

test("isChunkLoadError — detects Vite dynamic import failures", () => {
  assert.equal(
    isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://cycling-zone.vercel.app/assets/TeamPage-old.js")),
    true
  );
});

test("isChunkLoadError — detects module MIME-type chunk failures", () => {
  assert.equal(
    isChunkLoadError(new Error("Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of text/html.")),
    true
  );
});

test("isChunkLoadError — ignores ordinary render errors", () => {
  assert.equal(isChunkLoadError(new Error("Cannot read properties of null")), false);
});

test("isChunkLoadError — detects React.lazy internal-state failures (#881)", () => {
  assert.equal(
    isChunkLoadError(new TypeError('can\'t access property "default", e._result is undefined')),
    true
  );
  assert.equal(
    isChunkLoadError(new TypeError("undefined is not an object (evaluating 'e._result.default')")),
    true
  );
});

test("isChunkLoadError — detects V8 (Chrome/Edge) React.lazy render failure (#906)", () => {
  // Chrome/Edge/Chromium-formuleringen når en stale lazy-chunk resolver til et
  // ugyldigt modul og React læser `.default` på undefined under render. Det var
  // den dominerende Sentry-signatur (CYCLINGZONE-D, 147 events / 6 brugere) og
  // faldt igennem alle patterns før → fejlklassificeret som render_error-støj.
  assert.equal(
    isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'default')")),
    true
  );
});

test("shouldAttemptChunkReload — allows exactly one reload per release", () => {
  const storage = memoryStorage();
  const error = new Error("Failed to fetch dynamically imported module");

  assert.equal(shouldAttemptChunkReload({ error, release: "abc123", storage }), true);
  assert.equal(shouldAttemptChunkReload({ error, release: "abc123", storage }), false);
  assert.equal(storage.getItem(getChunkReloadKey("abc123")), "1");
});

test("shouldAttemptChunkReload — does not reload for non-chunk errors", () => {
  assert.equal(
    shouldAttemptChunkReload({ error: new Error("ordinary crash"), release: "abc123", storage: memoryStorage() }),
    false
  );
});

test("installChunkReloadHandlers — vite:preloadError udløser præcis ét loop-guarded reload", async () => {
  const target = fakeTarget();
  const timer = manualScheduler();
  let reloads = 0;
  installChunkReloadHandlers({ target, release: "rel1", storage: memoryStorage(), reload: () => { reloads += 1; }, schedule: timer.schedule, ...PROBE });

  let prevented = 0;
  const ev = () => ({ preventDefault: () => { prevented += 1; } });
  target.dispatch("vite:preloadError", ev());
  target.dispatch("vite:preloadError", ev());

  assert.equal(reloads, 0, "reload er udskudt — fyrer ikke synkront i event-handleren");
  await timer.flush();
  assert.equal(reloads, 1, "kun ét reload trods to preloadError-events (loop-guard pr. release)");
  // #4595: preventDefault ville stoppe Vite i at kaste, så __vitePreload
  // resolvede med undefined og loaderen mistede den ægte fejl + chunk-URL'en.
  assert.equal(prevented, 0, "preventDefault kaldes ALDRIG på preloadError — Vite skal kaste videre");
});

test("isChunkLoadError — #4595: Vites CSS-preload-fejl er en utvetydig chunk-fejl", () => {
  // Uden dette moenster ville en fejlet <link rel="stylesheet"> for et
  // async-chunk blive klassificeret render_error → fuldskærms-fallback, i
  // stedet for det ene retry der faktisk redder den.
  const error = new Error("Unable to preload CSS for https://cyclingzone.org/assets/TeamPage-old.css");
  assert.equal(isChunkLoadError(error), true);
  assert.equal(isUnambiguousChunkLoadError(error), true);
});

test("installChunkReloadHandlers — unhandledrejection: reloader på chunk-fejl, ignorerer andre", async () => {
  const target = fakeTarget();
  const timer = manualScheduler();
  let reloads = 0;
  installChunkReloadHandlers({ target, release: "rel2", storage: memoryStorage(), reload: () => { reloads += 1; }, schedule: timer.schedule, ...PROBE });

  // Almindelig (ikke-chunk) rejection: må hverken reloade eller preventDefault'e —
  // ellers skjuler vi ægte fejl.
  let preventedOrdinary = 0;
  target.dispatch("unhandledrejection", {
    reason: new Error("ordinary async crash"),
    preventDefault: () => { preventedOrdinary += 1; },
  });
  await timer.flush();
  assert.equal(reloads, 0);
  assert.equal(preventedOrdinary, 0);

  // Chunk-rejection der undslipper render-stien (fx await import("@e965/xlsx") /
  // import("@microsoft/clarity") på en stale chunk): kontrolleret reload.
  let preventedChunk = 0;
  target.dispatch("unhandledrejection", {
    reason: new TypeError("Failed to fetch dynamically imported module: /assets/xlsx-old.js"),
    preventDefault: () => { preventedChunk += 1; },
  });
  await timer.flush();
  assert.equal(reloads, 1);
  assert.equal(preventedChunk, 1);
});

test("installChunkReloadHandlers — deler ét-reload-pr-release-guard med error-boundary", async () => {
  const storage = memoryStorage();
  // Error-boundary har allerede brugt sit ene reload i denne release.
  storage.setItem(getChunkReloadKey("rel3"), "1");
  const target = fakeTarget();
  const timer = manualScheduler();
  let reloads = 0;
  installChunkReloadHandlers({ target, release: "rel3", storage, reload: () => { reloads += 1; }, schedule: timer.schedule, ...PROBE });

  target.dispatch("vite:preloadError", { preventDefault: () => {} });
  await timer.flush();
  assert.equal(reloads, 0, "ingen reload når guard-nøglen allerede er sat (ét reload pr. release på tværs af ALLE stier)");
});

// Regression for mobile-webkit e2e-flaken ("Navigation to /dashboard is interrupted
// by another navigation to /dashboard", 2026-07-03): navigation væk fra siden
// aborterer igangværende chunk-loads, og WebKit melder aborten som en chunk-fejl.
// Reload'en må IKKE fyre i det døende dokument — den ville kapre den ægte navigation.
test("installChunkReloadHandlers — teardown-abort (preloadError efterfulgt af pagehide) reloader IKKE", async () => {
  const storage = memoryStorage();
  const target = fakeTarget();
  const timer = manualScheduler();
  let reloads = 0;
  installChunkReloadHandlers({ target, release: "rel4", storage, reload: () => { reloads += 1; }, schedule: timer.schedule, ...PROBE });

  // Navigation river dokumentet ned → chunk-abort melder sig som preloadError...
  target.dispatch("vite:preloadError", { preventDefault: () => {} });
  // ...og pagehide når at fyre før den udskudte reload.
  target.dispatch("pagehide");
  await timer.flush();

  assert.equal(reloads, 0, "ingen reload når dokumentet er ved at unloade");
  assert.equal(
    storage.getItem(getChunkReloadKey("rel4")),
    null,
    "guard-nøglen brændes ikke af en teardown-abort — en ÆGTE stale chunk senere skal stadig kunne reloade"
  );
});

test("installChunkReloadHandlers — pageshow (bfcache-restore) gør recovery mulig igen", async () => {
  const target = fakeTarget();
  const timer = manualScheduler();
  let reloads = 0;
  installChunkReloadHandlers({ target, release: "rel5", storage: memoryStorage(), reload: () => { reloads += 1; }, schedule: timer.schedule, ...PROBE });

  // Teardown-abort: undertrykt.
  target.dispatch("vite:preloadError", { preventDefault: () => {} });
  target.dispatch("pagehide");
  await timer.flush();
  assert.equal(reloads, 0);

  // Siden genoplives fra bfcache → en ægte stale chunk skal stadig recovere.
  target.dispatch("pageshow");
  target.dispatch("vite:preloadError", { preventDefault: () => {} });
  await timer.flush();
  assert.equal(reloads, 1, "efter pageshow fyrer den udskudte reload igen");
});

test("installChunkReloadHandlers — uden brugbart target er det en sikker no-op", async () => {
  assert.doesNotThrow(() => installChunkReloadHandlers({ target: null, release: "x", storage: memoryStorage(), reload: () => {} }));
  assert.doesNotThrow(() => installChunkReloadHandlers());
});

// ---------------------------------------------------------------------------
// #3602 — den KAUSALE navigations-guard.
//
// Den temporale guard (250 ms + pagehide) var et gæt på hvor lang tid en
// document-commit tager. Målt på CI-lignende timing: chunk-abort t+0, deferred
// reload t+250 ms, commit/pagehide først t+1463 ms — reload'en fyrede altså
// midt i en igangværende navigation og kaprede den.
// ---------------------------------------------------------------------------

test("documentIsStillLoadable — dokument der bliver liggende svarer på canary-fetchen", async () => {
  assert.equal(await documentIsStillLoadable({ ...PROBE }), true);
});

test("documentIsStillLoadable — navigation in flight afviser canary-fetchen", async () => {
  assert.equal(
    await documentIsStillLoadable({ fetchFn: navigatingAwayDocument, url: PROBE.url }),
    false,
    "en afvist fetch betyder at browseren allerede er på vej væk fra dokumentet"
  );
});

test("documentIsStillLoadable — fail-closed: timeout, manglende fetch og manglende url reloader ikke", async () => {
  // Hængende netværk: vi må ikke blokere for evigt, og vi må ikke reloade i
  // blinde — et reload uden net giver en browser-fejlside i stedet for den
  // brandede fallback med sin manuelle "Genindlæs siden"-knap.
  assert.equal(
    await documentIsStillLoadable({ fetchFn: () => new Promise(() => {}), url: PROBE.url, timeoutMs: 5 }),
    false,
    "timeout → intet reload"
  );
  assert.equal(await documentIsStillLoadable({ url: PROBE.url }), false, "ingen fetch → intet reload");
  assert.equal(await documentIsStillLoadable({ fetchFn: stayingDocument }), false, "ingen url → intet reload");
  assert.equal(await documentIsStillLoadable(), false);
});

test("documentIsStillLoadable — canary'en tvinger et rigtigt netværkskald (no-store)", async () => {
  // Et cache-hit ville kunne svare selv under en igangværende navigation og
  // dermed give et falsk "dokumentet er i live".
  const calls = [];
  await documentIsStillLoadable({
    fetchFn: (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true }); },
    url: PROBE.url,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, PROBE.url);
  assert.equal(calls[0].init.cache, "no-store");
});

test("installChunkReloadHandlers — navigation in flight (pagehide er IKKE nået at fyre) reloader IKKE", async () => {
  // Præcis CI-vinduet: navigationen er startet og har aborteret chunk-loadet,
  // men den nye side har ikke committet endnu, så pagehide er ikke fyret og
  // delayMs er udløbet. Før #3602 fyrede reload'en her og kaprede navigationen.
  const storage = memoryStorage();
  const target = fakeTarget();
  const timer = manualScheduler();
  let reloads = 0;
  installChunkReloadHandlers({
    target,
    release: "rel6",
    storage,
    reload: () => { reloads += 1; },
    schedule: timer.schedule,
    fetchFn: navigatingAwayDocument,
    url: PROBE.url,
  });

  target.dispatch("vite:preloadError", { preventDefault: () => {} });
  await timer.flush();

  assert.equal(reloads, 0, "ingen reload mens en navigation er i gang — den ville blive kapret");
  assert.equal(
    storage.getItem(getChunkReloadKey("rel6")),
    null,
    "guard-nøglen brændes ikke af en navigations-abort — en ÆGTE stale chunk senere skal stadig kunne reloade"
  );
});

test("installChunkReloadHandlers — bruger target.fetch og target.location når intet er injiceret", async () => {
  const seen = [];
  const target = fakeTarget();
  target.fetch = function (url, init) { seen.push({ url, init, thisIsTarget: this === target }); return Promise.resolve({ ok: true }); };
  target.location = { href: "https://cyclingzone.org/planning" };
  const timer = manualScheduler();
  let reloads = 0;
  installChunkReloadHandlers({ target, release: "rel7", storage: memoryStorage(), reload: () => { reloads += 1; }, schedule: timer.schedule });

  target.dispatch("vite:preloadError", { preventDefault: () => {} });
  await timer.flush();

  assert.equal(reloads, 1);
  assert.deepEqual(seen.map((c) => c.url), ["https://cyclingzone.org/planning"]);
  assert.equal(seen[0].thisIsTarget, true, "fetch skal bindes til target — ellers kaster browseren Illegal invocation");
});

// #4545: to klassifikatorer med hver sin pris for at tage fejl.
//   recovery  -> bred. En falsk positiv koster ét unoedigt reload.
//   telemetri -> snaever. En falsk positiv begraver et aegte crash i chunk-bunken.
const UNAMBIGUOUS_SAMPLES = [
  "Failed to fetch dynamically imported module: https://cyclingzone.org/assets/AuctionsPage-7ZpbxV8J.js",
  "Importing a module script failed.",
  "Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".",
  "Loading chunk 42 failed",
  "ChunkLoadError",
];

const AMBIGUOUS_SAMPLES = [
  "Cannot read properties of undefined (reading 'default')",
  "e._result is undefined",
  "undefined is not an object (evaluating 'e._result.default')",
];

test("isUnambiguousChunkLoadError fanger de sikre modul-load-fejl", () => {
  for (const message of UNAMBIGUOUS_SAMPLES) {
    assert.ok(isUnambiguousChunkLoadError({ message }), message);
    assert.ok(isChunkLoadError({ message }), `${message} skal ogsaa udloese recovery`);
  }
});

test("React.lazy-interne signaturer er tvetydige: recovery ja, daempning nej", () => {
  for (const message of AMBIGUOUS_SAMPLES) {
    assert.ok(
      isChunkLoadError({ message }),
      `${message} skal stadig udloese recovery (#906 maalte den som dominerende signatur)`,
    );
    assert.ok(
      !isUnambiguousChunkLoadError({ message }),
      `${message} kan ogsaa komme fra almindelig kode og maa derfor ikke daempes i Sentry`,
    );
  }
});

test("almindelige fejl rammes af ingen af dem", () => {
  for (const message of ["Cannot read properties of undefined (reading 'name')", "Network request failed"]) {
    assert.ok(!isChunkLoadError({ message }), message);
    assert.ok(!isUnambiguousChunkLoadError({ message }), message);
  }
});

// --- #5159 / audit-fund M3: ét fælles recovery-budget ------------------------

// Auditten reproducerede præcis dette i en ren model: tre dokumentstarter, samme
// release, sessionStorage utilgængelig, ét preload-error pr. start — og TRE
// reloads, fordi den globale handler faldt tilbage på et per-load-flag der dør
// med dokumentet. Nu er stien fail-closed: uden bevis for at vi ikke allerede
// har reloadet, reloader vi ikke.
test("M3 — tre dokumentstarter uden storage giver NUL automatiske reloads", async () => {
  let reloads = 0;
  for (let documentStart = 0; documentStart < 3; documentStart += 1) {
    const target = fakeTarget();
    const timer = manualScheduler();
    installChunkReloadHandlers({
      target, release: "rel1", storage: null,
      reload: () => { reloads += 1; }, schedule: timer.schedule, ...PROBE,
    });
    target.dispatch("vite:preloadError", { preventDefault() {} });
    await timer.flush();
  }
  assert.equal(reloads, 0, "hoejst ét reload var kravet; fail-closed giver nul");
});

test("M3 — en storage der KASTER er lige så fail-closed som ingen storage", async () => {
  const throwing = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
  };
  const target = fakeTarget();
  const timer = manualScheduler();
  let reloads = 0;
  installChunkReloadHandlers({
    target, release: "rel1", storage: throwing,
    reload: () => { reloads += 1; }, schedule: timer.schedule, ...PROBE,
  });
  target.dispatch("vite:preloadError", { preventDefault() {} });
  await timer.flush();
  assert.equal(reloads, 0);
});

test("M3 — budgettet er FÆLLES: boot-vagtens reload tæller med", () => {
  const storage = memoryStorage();
  storage.setItem(BOOT_GUARD_KEY, String(Date.now()));
  assert.equal(accountBootGuardReload(storage), true, "vagtens reload bogfoeres");
  assert.equal(JSON.parse(storage.getItem(RECOVERY_BUDGET_KEY)).used, 1);
  // Samme tidsstempel må aldrig tælles to gange (fx ved en ekstra mount).
  assert.equal(accountBootGuardReload(storage), false);
  assert.equal(JSON.parse(storage.getItem(RECOVERY_BUDGET_KEY)).used, 1);
});

test("M3 — et gammelt selvhelings-tidsstempel er ikke 'lige sket'", () => {
  const storage = memoryStorage();
  storage.setItem(BOOT_GUARD_KEY, String(Date.now() - 60 * 60 * 1000));
  assert.equal(accountBootGuardReload(storage), false);
  assert.equal(storage.getItem(RECOVERY_BUDGET_KEY), null);
});

test("M3 — budgettet løber tør på tværs af lag og lukker så alle automatiske reloads", () => {
  const storage = memoryStorage();
  for (let i = 0; i < RECOVERY_BUDGET_MAX; i += 1) {
    assert.equal(hasRecoveryBudget(storage), true, `slot ${i} skal findes`);
    spendRecoverySlot(storage, "test");
  }
  assert.equal(hasRecoveryBudget(storage), false, "budgettet er brugt");
  assert.equal(
    shouldAttemptChunkReload({ error: { message: "ChunkLoadError" }, release: "helt-ny", storage }),
    false,
    "ogsaa en HELT ny release afvises — budgettet er delt, ikke pr. release",
  );
});

test("M3 — en oedelagt budget-post er FAIL-CLOSED, ikke et frisk budget", () => {
  // Foer denne aendring blev baade ugyldig JSON og ulaeselige felter laest som
  // "ubrugt". En reload-loop der naaede at skrive skrald i noeglen, fik dermed
  // tre friske forsoeg hver gang — praecis det budgettet findes for at stoppe.
  for (const broken of ['{"used":', '"ikke et objekt"', '{"used":"3","windowStart":1}', "null", "[]"]) {
    const storage = memoryStorage();
    storage.setItem(RECOVERY_BUDGET_KEY, broken);
    assert.equal(hasRecoveryBudget(storage), false, `skrald skal lukke porten: ${broken}`);
    assert.equal(spendRecoverySlot(storage, "test"), false, `og der bogfoeres intet: ${broken}`);
    assert.equal(
      shouldAttemptChunkReload({ error: { message: "ChunkLoadError" }, release: "ny", storage }),
      false,
    );
  }
});

test("M3 — spendRecoverySlot skriver ALDRIG forbi loftet", () => {
  const storage = memoryStorage();
  storage.setItem(RECOVERY_BUDGET_KEY, JSON.stringify({ used: RECOVERY_BUDGET_MAX, windowStart: Date.now() }));
  assert.equal(spendRecoverySlot(storage, "for-sent"), false, "bogfoeringen selv skal afvise");
  assert.equal(
    JSON.parse(storage.getItem(RECOVERY_BUDGET_KEY)).used,
    RECOVERY_BUDGET_MAX,
    "taelleren maa ikke vokse forbi loftet",
  );
});

test("M3 — et reload uden bogfoering sker ikke (fejlende skrivning)", () => {
  // Storage der kan laeses men ikke skrives: peeket siger ja, bogfoeringen
  // fejler. Uden at kraeve bogfoeringen ville vi reloade uden loft.
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (key === RECOVERY_BUDGET_KEY) throw new Error("kvote opbrugt");
      data.set(key, String(value));
    },
  };
  assert.equal(hasRecoveryBudget(storage), true, "peeket ser et ubrugt budget");
  assert.equal(
    shouldAttemptChunkReload({ error: { message: "ChunkLoadError" }, release: "ny", storage }),
    false,
    "men uden bogfoering reloader vi ikke",
  );
});

test("M3 — budgettet er et RULLENDE vindue, ikke fanens levetid", () => {
  const storage = memoryStorage();
  const start = Date.now();
  storage.setItem(RECOVERY_BUDGET_KEY, JSON.stringify({ used: RECOVERY_BUDGET_MAX, windowStart: start }));
  assert.equal(hasRecoveryBudget(storage, { now: start + 1000 }), false);
  assert.equal(
    hasRecoveryBudget(storage, { now: start + RECOVERY_BUDGET_WINDOW_MS + 1 }),
    true,
    "en fane der staar aaben i dage skal kunne tage en opdatering i morgen",
  );
});

test("M3 — safeSessionStorage overlever at selve OPSLAGET kaster", () => {
  const hostile = {};
  Object.defineProperty(hostile, "sessionStorage", {
    get() { throw new Error("The operation is insecure."); },
  });
  assert.equal(safeSessionStorage(hostile), null);
  assert.equal(safeSessionStorage(undefined), null);
  const ok = { sessionStorage: memoryStorage() };
  assert.equal(safeSessionStorage(ok), ok.sessionStorage);
});

// ---------------------------------------------------------------------------
// #5159 review-fund 1 — de to REAKTIVE lag skal ogsaa gennem porten
// ---------------------------------------------------------------------------
//
// Foer dette kaldte baade `installChunkReloadHandlers` (vite:preloadError /
// unhandledrejection) og error-boundary'ens auto-recovery `reload()` uden at
// spoerge reloadGate.js. Det er praecis den sti der fyrer lige efter et deploy,
// altsaa i det samme minut hvor en spiller kan sidde med en ugemt holdudtagelse.

test("review-fund 1 — porten AABEN: preloadError giver ét reload, intet banner-signal", async () => {
  __resetReloadGateForTests();
  __resetRecoveryDeferredForTests();
  const target = fakeTarget();
  const timer = manualScheduler();
  let reloads = 0;
  let deferrals = 0;
  const off = onRecoveryDeferred(() => { deferrals += 1; });

  installChunkReloadHandlers({
    target, release: "gate-open", storage: memoryStorage(),
    reload: () => { reloads += 1; }, schedule: timer.schedule, ...PROBE,
  });
  target.dispatch("vite:preloadError", { preventDefault() {} });
  await timer.flush();

  assert.equal(reloads, 1, "ingen blokeringer -> lag 2 reparerer som foer");
  assert.equal(deferrals, 0, "og der er intet at vise banneret for");
  off();
  __resetRecoveryDeferredForTests();
});

test("review-fund 1 — porten LUKKET: preloadError giver NUL reload + et banner-signal", async () => {
  __resetReloadGateForTests();
  __resetRecoveryDeferredForTests();
  const target = fakeTarget();
  const timer = manualScheduler();
  const storage = memoryStorage();
  let reloads = 0;
  const seen = [];
  const off = onRecoveryDeferred((notice) => { seen.push(notice.source); });

  // En flade med ugemt arbejde — praecis B1's tilstand.
  const release = acquireReloadBlock(RELOAD_BLOCK_REASONS.DIRTY);

  installChunkReloadHandlers({
    target, release: "gate-closed", storage,
    reload: () => { reloads += 1; }, schedule: timer.schedule, ...PROBE,
  });
  target.dispatch("vite:preloadError", { preventDefault() {} });
  await timer.flush();

  assert.equal(reloads, 0, "en ugemt kladde maa ikke kasseres af en chunk-reparation");
  assert.deepEqual(seen, ["chunk-error"], "banneret er den manuelle udvej imens");
  assert.equal(
    storage.getItem(getChunkReloadKey("gate-closed")), null,
    "loop-guarden maa ikke braendes for et reload der aldrig skete",
  );
  assert.equal(storage.getItem(RECOVERY_BUDGET_KEY), null, "og budgettet maa ikke debiteres");

  // Det SIKRE PUNKT: spilleren gemmer, sidste blokering slippes.
  release();
  await new Promise((resolve) => { setTimeout(resolve, 0); });

  assert.equal(reloads, 1, "reparationen sker foerst naar der ikke laengere er noget at miste");
  assert.equal(storage.getItem(getChunkReloadKey("gate-closed")), "1");
  assert.equal(JSON.parse(storage.getItem(RECOVERY_BUDGET_KEY)).used, 1, "og bogfoeres i det faelles budget");
  off();
  __resetReloadGateForTests();
  __resetRecoveryDeferredForTests();
});

test("review-fund 1 — en lytter der kommer for sent faar signalet alligevel", async () => {
  // Handlerne installeres i main.jsx FOER React monterer, saa et preload-error i
  // boot-vinduet ville ellers vaere usynligt for banneret.
  __resetReloadGateForTests();
  __resetRecoveryDeferredForTests();
  const target = fakeTarget();
  const timer = manualScheduler();
  const blocked = acquireReloadBlock(RELOAD_BLOCK_REASONS.DIALOG);
  installChunkReloadHandlers({
    target, release: "late-listener", storage: memoryStorage(),
    reload: () => {}, schedule: timer.schedule, ...PROBE,
  });
  target.dispatch("vite:preloadError", { preventDefault() {} });
  await timer.flush();

  let replayed = 0;
  const off = onRecoveryDeferred(() => { replayed += 1; });
  assert.equal(replayed, 1, "abonnementet replayer et signal der allerede er faldet");

  off();
  blocked();
  __resetReloadGateForTests();
  __resetRecoveryDeferredForTests();
});

test("review-fund 1 — boundary-stien deler port og udfald med lag 2", async () => {
  // Samme funktion som error-boundary'en i sentry.jsx kalder. De tre udfald er
  // det fallbacken traeffer sin beslutning paa.
  __resetReloadGateForTests();
  __resetRecoveryDeferredForTests();
  const alive = () => Promise.resolve(true);

  // Porten aaben + et ledigt slot -> reload.
  let reloads = 0;
  assert.equal(
    await attemptRecoveryReload({ probe: alive, claim: () => true, reload: () => { reloads += 1; }, source: "boundary" }),
    "reloaded",
  );
  assert.equal(reloads, 1);

  // Porten aaben, men lagets loop-guard/budget er brugt -> "exhausted".
  // Det er dét udfald der saetter fallbackens "stuck"-copy (#4545).
  assert.equal(
    await attemptRecoveryReload({ probe: alive, claim: () => false, reload: () => { reloads += 1; }, source: "boundary" }),
    "exhausted",
  );
  assert.equal(reloads, 1, "et exhausted forsoeg reloader ikke");

  // Porten LUKKET -> "deferred": intet reload, men fallbackens egen
  // "Genindlaes siden"-knap staar der som den manuelle udvej.
  const deferredSources = [];
  const off = onRecoveryDeferred((notice) => deferredSources.push(notice.source));
  const blocked = acquireReloadBlock(RELOAD_BLOCK_REASONS.DIRTY);
  let claims = 0;
  assert.equal(
    await attemptRecoveryReload({
      probe: alive, claim: () => { claims += 1; return true; },
      reload: () => { reloads += 1; }, source: "boundary",
    }),
    "deferred",
  );
  assert.equal(reloads, 1, "porten lukket -> intet automatisk reload");
  assert.equal(claims, 0, "og hverken loop-guard eller budget roeres");
  assert.deepEqual(deferredSources, ["boundary"]);

  blocked();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(reloads, 2, "reloadet sker paa det sikre punkt");

  off();
  __resetReloadGateForTests();
  __resetRecoveryDeferredForTests();
});

test("review-fund 1 — en doed navigations-probe slaar porten helt fra", async () => {
  // Fail-closed-rækkefoelgen: er dokumentet paa vej vaek, spoerger vi slet ikke
  // porten — vi ville ellers lægge et abonnement der reloadede et dokument der
  // ikke findes laengere.
  __resetReloadGateForTests();
  __resetRecoveryDeferredForTests();
  let deferrals = 0;
  const off = onRecoveryDeferred(() => { deferrals += 1; });
  const blocked = acquireReloadBlock(RELOAD_BLOCK_REASONS.DIRTY);
  let reloads = 0;
  assert.equal(
    await attemptRecoveryReload({
      probe: () => Promise.resolve(false), claim: () => true,
      reload: () => { reloads += 1; }, source: "chunk-error",
    }),
    "cancelled",
  );
  assert.equal(reloads, 0);
  assert.equal(deferrals, 0, "en kapret navigation er ikke en udskudt reparation");
  off();
  blocked();
  __resetReloadGateForTests();
  __resetRecoveryDeferredForTests();
});

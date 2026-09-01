import { test } from "node:test";
import assert from "node:assert/strict";
import {
  documentIsStillLoadable,
  getChunkReloadKey,
  installChunkReloadHandlers,
  isChunkLoadError,
  isUnambiguousChunkLoadError,
  shouldAttemptChunkReload,
} from "./chunkErrors.js";

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
  assert.equal(prevented, 2, "preventDefault kaldes på hvert preloadError så Vite ikke selv kaster");
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

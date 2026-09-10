// #4595 / CYCLINGZONE-56 — kontrakten mellem Vites preload-helper og vores
// egen recovery-sti.
//
// Fejlen der kostede 954 events og 50 spillere paa 7 dage kunne ikke ses i
// nogen af de eksisterende tests: lazyWithRetry.test.js tester validateModule
// mod almindelige objekter, og chunkErrors.test.js dispatcher et bart
// {preventDefault}-event. Ingen af dem koerte samspillet — og det var praecis
// dér fejlen laa.
//
// Denne fil gengiver `__vitePreload` ordret fra den genererede helper i vite
// 8.2.2 (`node_modules/vite/dist/node/chunks/node.js`, `preload()`):
//
//   function handlePreloadError(err) {
//     const e = new Event("vite:preloadError", { cancelable: true });
//     e.payload = err;
//     window.dispatchEvent(e);
//     if (!e.defaultPrevented) throw err;
//   }
//   return promise.then((res) => {
//     for (const item of res || []) {
//       if (item.status !== "rejected") continue;
//       handlePreloadError(item.reason);
//     }
//     return baseModule().catch(handlePreloadError);
//   });
//
// Begge grene testes: kaste-stien (den vi koerer efter #4595) og
// preventDefault-stien — den vi netop har forladt, og som stadig skal vaere
// pinned, saa ingen ved et uheld indfoerer den igen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installChunkReloadHandlers } from "./chunkErrors.js";
import { loadWithRetry } from "./lazyWithRetry.js";

const CHUNK_URL = "https://cyclingzone.org/assets/TeamPage-CmQ8ux1a.js";
const CSS_URL = "https://cyclingzone.org/assets/TeamPage-CmQ8ux1a.css";
const SYNTHETIC = /invalid module without a default export/i;

// EventTarget-stand-in med FLERE listeners pr. type — nødvendigt for at kunne
// haenge en ekstra preventDefault-listener ved siden af vores egen.
function fakeTarget() {
  const handlers = new Map();
  return {
    addEventListener: (type, fn) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== fn));
    },
    dispatch: (type, event) => {
      for (const fn of handlers.get(type) ?? []) fn(event);
      return event;
    },
  };
}

function manualScheduler() {
  const queue = [];
  return {
    schedule: (fn) => { queue.push(fn); },
    flush: async () => { while (queue.length) await queue.shift()(); },
  };
}

// Dokumentet bliver liggende → den kausale navigations-guard (#3602) svarer ja.
const PROBE = {
  fetchFn: () => Promise.resolve({ ok: true, status: 200 }),
  url: "https://cyclingzone.org/team",
};

// Ordret gengivelse af Vites helper. `deps` er preload-links (CSS/JS) med et
// `seen`-map, praecis som i vite: en dep der allerede er forsoegt springes over
// ved naeste kald — derfor kan ét retry redde en fejlet CSS-preload.
function makeVitePreload({ target, baseModule, deps = [] }) {
  const seen = new Set();
  function handlePreloadError(err) {
    const event = {
      type: "vite:preloadError",
      payload: err,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    target.dispatch("vite:preloadError", event);
    if (!event.defaultPrevented) throw err;
    // Vite returnerer implicit undefined naar den ikke kaster — det er den
    // vaerdi `baseModule().catch(...)` resolver med.
  }
  return function __vitePreload() {
    const settled = deps.map((dep) => {
      if (seen.has(dep.href)) return { status: "fulfilled", value: undefined };
      seen.add(dep.href);
      return dep.fails
        ? { status: "rejected", reason: new Error(`Unable to preload CSS for ${dep.href}`) }
        : { status: "fulfilled", value: undefined };
    });
    return Promise.resolve(settled).then((res) => {
      for (const item of res) {
        if (item.status !== "rejected") continue;
        handlePreloadError(item.reason);
      }
      return baseModule().catch(handlePreloadError);
    });
  };
}

function chunkFetchError() {
  return new TypeError(`Failed to fetch dynamically imported module: ${CHUNK_URL}`);
}

function install(target, schedule, release) {
  return installChunkReloadHandlers({
    target,
    release,
    storage: { getItem: () => null, setItem: () => {} },
    reload: () => {},
    schedule,
    ...PROBE,
  });
}

test("__vitePreload kaste-stien — den ægte fejl med chunk-URL når loadWithRetry", async () => {
  const target = fakeTarget();
  const timer = manualScheduler();
  install(target, timer.schedule, "rel-throw");

  const purged = [];
  const importFn = makeVitePreload({
    target,
    baseModule: () => Promise.reject(chunkFetchError()),
  });

  await assert.rejects(
    () => loadWithRetry(importFn, { fetchFn: async (url, init) => { purged.push([url, init.cache]); return { ok: true }; } }),
    (err) => {
      assert.equal(err.name, "ChunkLoadError");
      assert.match(err.message, new RegExp(CHUNK_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(err.message, SYNTHETIC, "ingen syntetisk fejl — browserens egen skal igennem");
      return true;
    },
  );

  assert.deepEqual(purged, [[CHUNK_URL, "reload"]], "cache-purgen rammer det chunk der faktisk fejlede");
  await timer.flush(); // reload-stien skal stadig kunne fyre
});

test("__vitePreload preventDefault-stien — hele skaden ligger i preventDefault", async () => {
  // Rod-årsagen fra CYCLINGZONE-56, pinned: nogen preventDefault'er, Vite
  // kaster ikke, `.catch()` returnerer undefined, og HELE promisen resolver med
  // undefined. Så mister loaderen browserens fejl OG chunk-URL'en, og tilbage
  // er den syntetiske streng uden noget at rense cachen for.
  //
  // Testen er derfor bevidst en NEGATIV kontrakt: den viser præcis hvad prisen
  // er, og den fejler den dag nogen sætter preventDefault tilbage i vores egen
  // handler (så ville kaste-stien ovenfor ramme her i stedet).
  const target = fakeTarget();
  const timer = manualScheduler();
  install(target, timer.schedule, "rel-prevented");
  target.addEventListener("vite:preloadError", (event) => event.preventDefault());

  const purged = [];
  const importFn = makeVitePreload({
    target,
    baseModule: () => Promise.reject(chunkFetchError()),
  });

  // Selve helperen resolver undefined — det er dét der gjorde fejlen usynlig.
  const resolvedValue = await importFn();
  assert.equal(resolvedValue, undefined, "preventDefault ⇒ __vitePreload resolver undefined");

  await assert.rejects(
    () => loadWithRetry(importFn, { fetchFn: async (url, init) => { purged.push([url, init.cache]); return { ok: true }; } }),
    (err) => {
      assert.equal(err.name, "ChunkLoadError");
      assert.match(err.message, SYNTHETIC, "en slugt fejl efterlader kun den syntetiske streng");
      assert.doesNotMatch(err.message, new RegExp(CHUNK_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    },
  );
  assert.deepEqual(purged, [], "ingen URL at rense — præcis det tab preventDefault koster");
  await timer.flush();
});

test("__vitePreload — fejlet CSS-preload reddes af det ene retry", async () => {
  const target = fakeTarget();
  const timer = manualScheduler();
  install(target, timer.schedule, "rel-css");

  const mod = { default: "TeamPage" };
  let baseCalls = 0;
  const purged = [];
  const importFn = makeVitePreload({
    target,
    deps: [{ href: CSS_URL, fails: true }],
    baseModule: async () => { baseCalls += 1; return mod; },
  });

  const result = await loadWithRetry(importFn, {
    fetchFn: async (url) => { purged.push(url); return { ok: true }; },
  });

  assert.equal(result, mod, "modulet loader — CSS-fejlen må ikke tage siden ned");
  assert.equal(baseCalls, 1, "første forsøg nåede aldrig baseModule (CSS kastede først)");
  assert.deepEqual(purged, [], "ingen cache-purge når retry'et lykkes");
  await timer.flush();
});

test("et modul der reelt mangler default-export giver stadig den syntetiske fejl", async () => {
  await assert.rejects(
    () => loadWithRetry(async () => ({ notDefault: 1 })),
    (err) => {
      assert.equal(err.name, "ChunkLoadError");
      assert.match(err.message, SYNTHETIC);
      return true;
    },
  );
});

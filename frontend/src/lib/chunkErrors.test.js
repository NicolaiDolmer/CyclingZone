import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getChunkReloadKey,
  installChunkReloadHandlers,
  isChunkLoadError,
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

test("installChunkReloadHandlers — vite:preloadError udløser præcis ét loop-guarded reload", () => {
  const target = fakeTarget();
  let reloads = 0;
  installChunkReloadHandlers({ target, release: "rel1", storage: memoryStorage(), reload: () => { reloads += 1; } });

  let prevented = 0;
  const ev = () => ({ preventDefault: () => { prevented += 1; } });
  target.dispatch("vite:preloadError", ev());
  target.dispatch("vite:preloadError", ev());

  assert.equal(reloads, 1, "kun ét reload trods to preloadError-events (loop-guard pr. release)");
  assert.equal(prevented, 2, "preventDefault kaldes på hvert preloadError så Vite ikke selv kaster");
});

test("installChunkReloadHandlers — unhandledrejection: reloader på chunk-fejl, ignorerer andre", () => {
  const target = fakeTarget();
  let reloads = 0;
  installChunkReloadHandlers({ target, release: "rel2", storage: memoryStorage(), reload: () => { reloads += 1; } });

  // Almindelig (ikke-chunk) rejection: må hverken reloade eller preventDefault'e —
  // ellers skjuler vi ægte fejl.
  let preventedOrdinary = 0;
  target.dispatch("unhandledrejection", {
    reason: new Error("ordinary async crash"),
    preventDefault: () => { preventedOrdinary += 1; },
  });
  assert.equal(reloads, 0);
  assert.equal(preventedOrdinary, 0);

  // Chunk-rejection der undslipper render-stien (fx await import("@e965/xlsx") /
  // import("@microsoft/clarity") på en stale chunk): kontrolleret reload.
  let preventedChunk = 0;
  target.dispatch("unhandledrejection", {
    reason: new TypeError("Failed to fetch dynamically imported module: /assets/xlsx-old.js"),
    preventDefault: () => { preventedChunk += 1; },
  });
  assert.equal(reloads, 1);
  assert.equal(preventedChunk, 1);
});

test("installChunkReloadHandlers — deler ét-reload-pr-release-guard med error-boundary", () => {
  const storage = memoryStorage();
  // Error-boundary har allerede brugt sit ene reload i denne release.
  storage.setItem(getChunkReloadKey("rel3"), "1");
  const target = fakeTarget();
  let reloads = 0;
  installChunkReloadHandlers({ target, release: "rel3", storage, reload: () => { reloads += 1; } });

  target.dispatch("vite:preloadError", { preventDefault: () => {} });
  assert.equal(reloads, 0, "ingen reload når guard-nøglen allerede er sat (ét reload pr. release på tværs af ALLE stier)");
});

test("installChunkReloadHandlers — uden brugbart target er det en sikker no-op", () => {
  assert.doesNotThrow(() => installChunkReloadHandlers({ target: null, release: "x", storage: memoryStorage(), reload: () => {} }));
  assert.doesNotThrow(() => installChunkReloadHandlers());
});

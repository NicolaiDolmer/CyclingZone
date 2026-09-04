// Forward-guard for #4595. Boot-vagten ligger i frontend/public/chunk-selfheal.js
// som et CLASSIC script (den skal virke netop naar modul-grafen fejler), saa den
// kan ikke importeres. Den evalueres i stedet i en node:vm-kontekst med et falsk
// window — hvilket er en fordel her: testen koerer den PRAECIS samme fil der
// shippes, inklusive selv-installationen i bunden.
//
// Det testen skal bevise:
//   1. En fejlet modulepreload/entry-script udloeser refetch af ALLE modul-URL'er
//      med { cache: "reload" } — det eneste der overskriver en immutable-cachet 404.
//   2. Der reloades HOEJST én gang: hverken to fejl i samme load eller en
//      sessionStorage-vagt fra <60 s siden maa give reload nummer to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SCRIPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "chunk-selfheal.js",
);
const SOURCE = readFileSync(SCRIPT_PATH, "utf8");

const PRELOAD_URL = "https://cyclingzone.org/assets/react-dom-B1c9.js";
const ENTRY_URL = "https://cyclingzone.org/assets/index-Xy42.js";

function element(tagName, attrs) {
  return {
    tagName,
    getAttribute: (name) => attrs[name] ?? null,
    href: attrs.href,
    src: attrs.src,
    addEventListener() {},
  };
}

// Minimalt window: kun de flader vagten faktisk roerer.
function bootGuard({ storage = new Map(), fetchImpl } = {}) {
  const listeners = new Map();
  const fetched = [];
  const reloads = [];
  const warnings = [];

  const preload = element("LINK", { rel: "modulepreload", href: PRELOAD_URL });
  const entry = element("SCRIPT", { type: "module", src: ENTRY_URL });

  const win = {
    document: {
      readyState: "complete",
      querySelectorAll: (selector) =>
        selector.includes("modulepreload") ? [preload, entry] : [entry],
      addEventListener() {},
    },
    addEventListener: (type, handler, capture) => {
      listeners.set(`${type}:${capture ? "capture" : "bubble"}`, handler);
    },
    removeEventListener() {},
    console: { warn: (...args) => warnings.push(args.join(" ")) },
    location: { reload: () => reloads.push(Date.now()) },
    sessionStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
    Promise,
    fetch: (url, init) => {
      fetched.push({ url, cache: init?.cache });
      return fetchImpl ? fetchImpl(url, init) : Promise.resolve({ ok: true });
    },
  };
  win.window = win;
  win.globalThis = win;

  vm.runInNewContext(SOURCE, win, { filename: "chunk-selfheal.js" });

  return {
    win,
    fetched,
    reloads,
    warnings,
    storage,
    preload,
    entry,
    fireResourceError: (target) =>
      listeners.get("error:capture")?.({ target, message: undefined }),
  };
}

// Vagten reloader efter et refetch-race; ét tick er nok naar alt er afgjort.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("selvinstallerer og lytter i capture-fasen paa window", () => {
  const g = bootGuard();
  assert.equal(typeof g.win.__czChunkSelfHeal.create, "function");
  assert.equal(typeof g.fireResourceError, "function");
});

test("fejlet modulepreload refetcher ALLE modul-URL'er med cache:'reload' og reloader én gang", async () => {
  const g = bootGuard();
  g.fireResourceError(g.preload);
  await flush();

  assert.deepEqual(
    g.fetched,
    [
      { url: PRELOAD_URL, cache: "reload" },
      { url: ENTRY_URL, cache: "reload" },
    ],
    "en cachet 404 forsvinder kun ved en refetch med cache:'reload'",
  );
  assert.equal(g.reloads.length, 1);
  assert.match(g.warnings.join("\n"), /modulepreload fejlede/);
});

test("fejlet entry-modul (script[type=module]) udloeser samme selvhelbredelse", async () => {
  const g = bootGuard();
  g.fireResourceError(g.entry);
  await flush();
  assert.equal(g.fetched.length, 2);
  assert.equal(g.reloads.length, 1);
  assert.match(g.warnings.join("\n"), /entry-modulet kunne ikke hentes/);
});

test("to fejl i samme page-load giver ÉT reload, ikke to", async () => {
  const g = bootGuard();
  g.fireResourceError(g.preload);
  g.fireResourceError(g.entry);
  await flush();
  assert.equal(g.reloads.length, 1);
  assert.equal(g.fetched.length, 2, "kun ét refetch-saet");
});

test("sessionStorage-vagt: et reload for <60 s siden blokerer det naeste", async () => {
  const storage = new Map([["cz_chunk_selfheal_at", String(Date.now() - 5_000)]]);
  const g = bootGuard({ storage });
  g.fireResourceError(g.preload);
  await flush();
  assert.equal(g.reloads.length, 0, "loop-guarden skal holde");
  assert.equal(g.fetched.length, 0);
  assert.match(g.warnings.join("\n"), /reload sprunget over/);
});

test("sessionStorage-vagt: et reload for >60 s siden tillader et nyt forsoeg", async () => {
  const storage = new Map([["cz_chunk_selfheal_at", String(Date.now() - 120_000)]]);
  const g = bootGuard({ storage });
  g.fireResourceError(g.preload);
  await flush();
  assert.equal(g.reloads.length, 1);
  assert.match(storage.get("cz_chunk_selfheal_at"), /^\d+$/);
});

test("runtime-fejl (ingen ressource-target) roerer ikke vagten", async () => {
  const g = bootGuard();
  g.fireResourceError(undefined);
  g.fireResourceError({ tagName: "IMG", getAttribute: () => null });
  await flush();
  assert.equal(g.reloads.length, 0);
  assert.equal(g.fetched.length, 0);
});

test("en fejlende refetch stopper ikke reload'et", async () => {
  const g = bootGuard({ fetchImpl: () => Promise.reject(new TypeError("Load failed")) });
  g.fireResourceError(g.preload);
  await flush();
  assert.equal(g.reloads.length, 1);
});

test("uden sessionStorage reloades der IKKE (fail-closed, ingen loop-risiko)", async () => {
  const g = bootGuard();
  g.win.sessionStorage = null;
  g.fireResourceError(g.preload);
  await flush();
  assert.equal(g.reloads.length, 0);
});

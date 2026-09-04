// Forward-guard for #4595. Boot-vagten ligger i frontend/public/chunk-selfheal.js
// som et CLASSIC script (den skal virke netop naar modul-grafen fejler), saa den
// kan ikke importeres. Den evalueres i stedet i en node:vm-kontekst med et falsk
// window — hvilket er en fordel her: testen koerer den PRAECIS samme fil der
// shippes, inklusive selv-installationen i bunden.
//
// Det testen skal bevise:
//   1. En fejlet modulepreload/entry-script/stylesheet der stod i dokumentet VED
//      INSTALL ("bootUrls") udloeser — efter en bekraeftelses-fetch — refetch af
//      ALLE boot-URL'er med { cache: "reload" }, det eneste der overskriver en
//      immutable-cachet 404.
//   2. En ressource der IKKE stod i dokumentet ved install (runtime-indsat) kan
//      ikke udloese vagten — boot-scope (review 4/9).
//   3. Bekraeftelses-fetchen forhindrer falske alarmer (WebKit-navigations-races,
//      CI-evidens #4760): svarer den 200, sker der intet.
//   4. Der reloades HOEJST én gang: hverken to fejl i samme load eller en
//      sessionStorage-vagt fra <60 s siden maa give reload nummer to — og et
//      brændt forsoeg med tom #root viser i stedet en fallback-UI.
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
const STYLESHEET_URL = "https://cyclingzone.org/assets/index-DT_ei3E8.css";
const RUNTIME_URL = "https://cyclingzone.org/assets/late-injected-BEEF.js";

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
function bootGuard({
  storage = new Map(),
  fetchImpl,
  includeStylesheet = false,
  rootHasChild = false,
  href,
} = {}) {
  const listeners = new Map();
  const fetched = [];
  const reloads = [];
  const warnings = [];

  const preload = element("LINK", { rel: "modulepreload", href: PRELOAD_URL });
  const entry = element("SCRIPT", { type: "module", src: ENTRY_URL });
  const stylesheet = element("LINK", { rel: "stylesheet", href: STYLESHEET_URL });

  // Fallback-UI-mocken: ingen rigtig HTML-parser, blot nok til at bevise at
  // koden skriver til #root og wirer knappen op via querySelector("button").
  const buttonListeners = [];
  const button = {
    addEventListener: (type, handler) => {
      if (type === "click") buttonListeners.push(handler);
    },
  };
  const rootEl = {
    firstElementChild: rootHasChild ? {} : null,
    innerHTML: "",
    querySelector: (selector) => (selector === "button" ? button : null),
  };

  const win = {
    document: {
      readyState: "complete",
      querySelectorAll: (selector) => {
        if (selector.includes("modulepreload")) {
          const nodes = [preload, entry];
          if (includeStylesheet) nodes.push(stylesheet);
          return nodes;
        }
        return [entry];
      },
      addEventListener() {},
      getElementById: (id) => (id === "root" ? rootEl : null),
    },
    addEventListener: (type, handler, capture) => {
      listeners.set(`${type}:${capture ? "capture" : "bubble"}`, handler);
    },
    removeEventListener() {},
    console: { warn: (...args) => warnings.push(args.join(" ")) },
    location: { reload: () => reloads.push(Date.now()), href },
    sessionStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
    Promise,
    fetch: (url, init) => {
      fetched.push({ url, cache: init?.cache });
      // Standard: en stadig-cachet immutable 404 — den realistiske #4595-case,
      // saa hovedparten af testene kan bevise heal-flowet uden at override'e.
      return fetchImpl ? fetchImpl(url, init) : Promise.resolve({ ok: false, status: 404 });
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
    stylesheet,
    rootEl,
    clickReloadButton: () => buttonListeners.forEach((handler) => handler()),
    fireResourceError: (target) =>
      listeners.get("error:capture")?.({ target, message: undefined }),
  };
}

// Vagten reloader efter et refetch-race; ét tick er nok naar alt er afgjort
// (alle mellemled er mikrotasks — én macrotask-flush toemmer hele kaeden).
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("selvinstallerer og lytter i capture-fasen paa window", () => {
  const g = bootGuard();
  assert.equal(typeof g.win.__czChunkSelfHeal.create, "function");
  assert.equal(typeof g.fireResourceError, "function");
});

test("fejlet modulepreload bekraeftes og refetcher ALLE modul-URL'er med cache:'reload', reloader én gang", async () => {
  const g = bootGuard();
  g.fireResourceError(g.preload);
  await flush();

  assert.deepEqual(
    g.fetched,
    [
      { url: PRELOAD_URL, cache: undefined }, // bekraeftelses-fetch (normal cache)
      { url: PRELOAD_URL, cache: "reload" },
      { url: ENTRY_URL, cache: "reload" },
    ],
    "en cachet 404 forsvinder kun ved en refetch med cache:'reload' — men foerst bekraeftes den fejlede URL",
  );
  assert.equal(g.reloads.length, 1);
  assert.match(g.warnings.join("\n"), /modulepreload fejlede/);
});

test("fejlet entry-modul (script[type=module]) udloeser samme selvhelbredelse", async () => {
  const g = bootGuard();
  g.fireResourceError(g.entry);
  await flush();
  assert.equal(g.fetched.length, 3, "1 bekraeftelse + 2 cache:'reload'-refetches");
  assert.equal(g.reloads.length, 1);
  assert.match(g.warnings.join("\n"), /entry-modulet kunne ikke hentes/);
});

test("fejlet stylesheet i bootUrls udloeser samme selvhelbredelse", async () => {
  const g = bootGuard({ includeStylesheet: true });
  g.fireResourceError(g.stylesheet);
  await flush();

  assert.deepEqual(g.fetched, [
    { url: STYLESHEET_URL, cache: undefined },
    { url: PRELOAD_URL, cache: "reload" },
    { url: ENTRY_URL, cache: "reload" },
    { url: STYLESHEET_URL, cache: "reload" },
  ]);
  assert.equal(g.reloads.length, 1);
  assert.match(g.warnings.join("\n"), /stylesheet fejlede/);
});

test("boot-scope: en runtime-indsat modulepreload (uden for bootUrls) udloeser INGEN reload", async () => {
  const g = bootGuard();
  // Denne link stod IKKE i dokumentet da install() snapshottede bootUrls —
  // simulerer en route-praefetch app-koden indsaetter efter boot.
  const runtimeLink = element("LINK", { rel: "modulepreload", href: RUNTIME_URL });
  g.fireResourceError(runtimeLink);
  await flush();

  assert.equal(g.fetched.length, 0, "URL'en var ikke en del af boot-snapshottet, saa den roerer ikke vagten");
  assert.equal(g.reloads.length, 0);
});

test("bekraeftelses-fetch svarer 200 (falsk alarm, fx en afbrudt WebKit-navigation, #4760): INGEN reload", async () => {
  const g = bootGuard({
    fetchImpl: (url) =>
      url === PRELOAD_URL ? Promise.resolve({ ok: true, status: 200 }) : Promise.resolve({ ok: false, status: 404 }),
  });
  g.fireResourceError(g.preload);
  await flush();

  assert.deepEqual(g.fetched, [{ url: PRELOAD_URL, cache: undefined }], "kun bekraeftelsen — intet cache:'reload'-forsoeg");
  assert.equal(g.reloads.length, 0);
  assert.match(g.warnings.join("\n"), /falsk alarm/);
});

test("to fejl i samme page-load giver ÉT heal-forsoeg og ÉT reload, ikke to", async () => {
  const g = bootGuard();
  g.fireResourceError(g.preload);
  g.fireResourceError(g.entry);
  await flush();
  assert.equal(g.reloads.length, 1);
  assert.equal(g.fetched.length, 3, "kun ét bekraeftelses- + refetch-saet");
});

test("sessionStorage-vagt: et reload for <60 s siden blokerer det naeste (og viser fallback-UI i tom #root)", async () => {
  const storage = new Map([["cz_chunk_selfheal_at", String(Date.now() - 5_000)]]);
  const g = bootGuard({ storage });
  g.fireResourceError(g.preload);
  await flush();
  assert.equal(g.reloads.length, 0, "loop-guarden skal holde");
  assert.equal(g.fetched.length, 1, "kun bekraeftelsen — refetch/reload sprunget over af loop-guarden");
  assert.match(g.warnings.join("\n"), /reload sprunget over/);
  assert.match(g.rootEl.innerHTML, /The page could not load/);
  assert.match(g.rootEl.innerHTML, /Siden kunne ikke indl/);
});

test("fallback-UI'ens knap kan udloese et manuelt reload", async () => {
  const storage = new Map([["cz_chunk_selfheal_at", String(Date.now() - 5_000)]]);
  const g = bootGuard({ storage });
  g.fireResourceError(g.preload);
  await flush();
  assert.equal(g.reloads.length, 0);
  g.clickReloadButton();
  assert.equal(g.reloads.length, 1, "knappen kalder location.reload()");
});

test("tom-#root-betingelsen: staar #root allerede med indhold, skrives der ingen fallback-UI", async () => {
  const storage = new Map([["cz_chunk_selfheal_at", String(Date.now() - 5_000)]]);
  const g = bootGuard({ storage, rootHasChild: true });
  g.fireResourceError(g.preload);
  await flush();
  assert.equal(g.rootEl.innerHTML, "", "en side der allerede viser noget skal ikke overskrives");
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

test("sessionStorage.setItem kaster (fx QuotaExceededError): fail-closed, ingen reload-loop", async () => {
  const g = bootGuard();
  g.win.sessionStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  g.fireResourceError(g.preload);
  await flush();
  assert.equal(g.reloads.length, 0);
  assert.match(g.warnings.join("\n"), /reload sprunget over/);
});

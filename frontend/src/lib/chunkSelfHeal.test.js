// Forward-guard for #4595 + #5161. Boot-vagten ligger i
// frontend/public/chunk-selfheal.js som et CLASSIC script (den skal virke netop
// naar modul-grafen fejler), saa den kan ikke importeres. Den evalueres i stedet i
// en node:vm-kontekst med et falsk window — hvilket er en fordel her: testen
// koerer den PRAECIS samme fil der shippes, inklusive selv-installationen i
// bunden.
//
// ── Hvorfor harness'en ser ud som den gør (#5161) ──────────────────────────
//
// Den tidligere version af denne fil startede sit falske dokument paa
// `readyState: "complete"` og lod `querySelectorAll` returnere entry- og
// preload-elementerne med det samme. Det er IKKE den rækkefølge der findes i en
// browser: guard-scriptet staar i <head> FOER entry-scriptet og Vites
// modulepreloads, saa ved install er `readyState === "loading"` og
// `querySelectorAll` finder NUL modultags (maalt i Chromium + WebKit, audit-fund
// H2 11/9: `count: 0` ved install, 28 tags efter boot). Testen var derfor groen
// samtidig med at en entry-404 i en rigtig browser gav en tom `#root` uden
// hverken selvheling eller fallback.
//
// Harness'en defaulter nu til `readyState: "loading"` med en tom DOM, og
// boot-listen kommer — som i det byggede dokument — fra JSON-datablokken
// `<script type="application/json" id="cz-boot-assets">`, der injiceres af
// vite-plugins/boot-assets-manifest.js LIGE FOER guarden. Manifestet indeholder
// RELATIVE stier, praecis som i dist/, saa testen ogsaa daekker at guarden
// normaliserer dem til absolutte URL'er (et fejl-events target baerer den
// absolutte).
//
// Det testen skal bevise:
//   1. Boot-listen er komplet ved install, ogsaa mens parseren kun er naaet til
//      <head> — og en entry-fejl i netop det vindue udloeser selvheling (#5161).
//   2. En fejlet modulepreload/entry-script/stylesheet fra boot-listen udloeser —
//      efter en bekraeftelses-fetch — refetch af ALLE boot-URL'er med
//      { cache: "reload" }, det eneste der overskriver en immutable-cachet 404.
//   3. En ressource der IKKE er et boot-asset (runtime-indsat) kan ikke udloese
//      vagten — boot-scope (review 4/9).
//   4. Mangler manifestet helt, logges det som en eksplicit assertion/telemetri
//      (det maa aldrig ske i et bygget dokument) — og en entry-fejl slipper
//      stadig ikke forbi i stilhed.
//   5. Bekraeftelses-fetchen forhindrer falske alarmer (WebKit-navigations-races,
//      CI-evidens #4760): svarer den 200, sker der intet.
//   6. Der reloades HOEJST én gang: hverken to fejl i samme load eller en
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

const ORIGIN = "https://cyclingzone.org";
// Build-manifestet indeholder relative stier; elementernes .src/.href er absolutte.
const ENTRY_PATH = "/assets/index-Xy42.js";
const PRELOAD_PATH = "/assets/react-dom-B1c9.js";
const STYLESHEET_PATH = "/assets/index-DT_ei3E8.css";
const ENTRY_URL = ORIGIN + ENTRY_PATH;
const PRELOAD_URL = ORIGIN + PRELOAD_PATH;
const STYLESHEET_URL = ORIGIN + STYLESHEET_PATH;
const RUNTIME_URL = `${ORIGIN}/assets/late-injected-BEEF.js`;

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
  // "loading" = HTML-parseren staar stadig i <head>, hvor guarden installeres.
  // Default, fordi det er den rækkefølge en rigtig browser har (#5161).
  readyState = "loading",
  // JSON-datablokken fra vite-pluginet. `null` = intet manifest (dev-server,
  // eller et build hvor pluginet ikke koerte).
  bootAssets = includeStylesheet
    ? [ENTRY_PATH, PRELOAD_PATH, STYLESHEET_PATH]
    : [ENTRY_PATH, PRELOAD_PATH],
} = {}) {
  const listeners = new Map();
  const docListeners = new Map();
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

  const manifestEl =
    bootAssets === null ? null : { textContent: JSON.stringify(bootAssets) };

  const doc = {
    readyState,
    baseURI: `${ORIGIN}/`,
    // Parser-rækkefølgen: mens dokumentet loader, er modultags'ene endnu ikke
    // indsat. Det er praecis hullet #5161 lukker.
    querySelectorAll: (selector) => {
      if (doc.readyState === "loading") return [];
      if (selector.includes("modulepreload")) {
        const nodes = [entry, preload];
        if (includeStylesheet) nodes.push(stylesheet);
        return nodes;
      }
      return [entry];
    },
    addEventListener: (type, handler) => {
      docListeners.set(type, handler);
    },
    getElementById: (id) => {
      if (id === "root") return rootEl;
      if (id === "cz-boot-assets") return manifestEl;
      return null;
    },
  };

  const win = {
    document: doc,
    URL,
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
    // Parseren naaede bunden af dokumentet: modultags findes nu, og
    // DOMContentLoaded fyrer (som i en browser).
    finishParsing: () => {
      doc.readyState = "complete";
      docListeners.get("DOMContentLoaded")?.();
    },
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

// ── #5161: parser-rækkefølgen ──────────────────────────────────────────────

test("#5161 parser-raekkefoelge: entry-fejl FOER parseren har indsat modultags udloeser stadig selvheling", async () => {
  const g = bootGuard();
  // Kontrol af premissen: dokumentet loader stadig, og DOM'en kender ingen
  // modultags — praecis tilstanden ved install i en rigtig browser.
  assert.equal(g.win.document.readyState, "loading");
  assert.equal(g.win.document.querySelectorAll("script[type=module][src]").length, 0);

  g.fireResourceError(g.entry);
  await flush();

  assert.deepEqual(
    g.fetched,
    [
      { url: ENTRY_URL, cache: undefined }, // bekraeftelses-fetch (normal cache)
      { url: ENTRY_URL, cache: "reload" },
      { url: PRELOAD_URL, cache: "reload" },
    ],
    "boot-listen kom fra build-manifestet, saa den var komplet allerede under 'loading'",
  );
  assert.equal(g.reloads.length, 1, "en entry-404 i boot-vinduet SKAL give ét heal-reload");
  assert.match(g.warnings.join("\n"), /renser 2 modul-URL'er/);
});

test("#5161 boot-listen laeses fra manifestet (relative stier normaliseres til absolutte)", async () => {
  const g = bootGuard({ includeStylesheet: true });
  g.fireResourceError(g.stylesheet);
  await flush();

  assert.deepEqual(g.fetched, [
    { url: STYLESHEET_URL, cache: undefined },
    { url: ENTRY_URL, cache: "reload" },
    { url: PRELOAD_URL, cache: "reload" },
    { url: STYLESHEET_URL, cache: "reload" },
  ]);
  assert.equal(g.reloads.length, 1);
  assert.equal(g.win.__czChunkSelfHealBootListEmpty, undefined, "listen var ikke tom");
});

test("#5161 manglende manifest: tom boot-liste logges som assertion og saetter telemetri-flaget", () => {
  const g = bootGuard({ bootAssets: null });
  assert.equal(g.win.__czChunkSelfHealBootListEmpty, true);
  assert.match(g.warnings.join("\n"), /boot-listen er TOM ved install \(readyState=loading\)/);
  assert.match(g.warnings.join("\n"), /cz-boot-assets/);
});

test("#5161 tom boot-liste: en entry-fejl slipper alligevel ikke forbi i stilhed", async () => {
  const g = bootGuard({ bootAssets: null });
  g.fireResourceError(g.entry);
  await flush();

  assert.deepEqual(
    g.fetched,
    [
      { url: ENTRY_URL, cache: undefined },
      { url: ENTRY_URL, cache: "reload" },
    ],
    "uden liste renses i det mindste den URL vi ved fejlede",
  );
  assert.equal(g.reloads.length, 1);
});

test("#5161 tom boot-liste: en modulepreload-fejl udloeser ingenting (boot-scope holder for links)", async () => {
  const g = bootGuard({ bootAssets: null });
  g.fireResourceError(g.preload);
  await flush();
  assert.equal(g.fetched.length, 0);
  assert.equal(g.reloads.length, 0);
});

test("#5161 uden manifest men med faerdigparset DOM bruges snapshottet (dev-serveren)", () => {
  const g = bootGuard({ bootAssets: null, readyState: "complete" });
  assert.equal(
    g.win.__czChunkSelfHealBootListEmpty,
    undefined,
    "DOM-snapshottet supplerer manifestet, saa listen er ikke tom her",
  );
  assert.doesNotMatch(g.warnings.join("\n"), /boot-listen er TOM/);
});

// ── #4595: heal-flowet ─────────────────────────────────────────────────────

test("fejlet modulepreload bekraeftes og refetcher ALLE modul-URL'er med cache:'reload', reloader én gang", async () => {
  const g = bootGuard();
  g.fireResourceError(g.preload);
  await flush();

  assert.deepEqual(
    g.fetched,
    [
      { url: PRELOAD_URL, cache: undefined }, // bekraeftelses-fetch (normal cache)
      { url: ENTRY_URL, cache: "reload" },
      { url: PRELOAD_URL, cache: "reload" },
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
  assert.equal(g.fetched.length, 4);
  assert.equal(g.reloads.length, 1);
  assert.match(g.warnings.join("\n"), /stylesheet fejlede/);
});

test("boot-scope: en runtime-indsat modulepreload (uden for bootUrls) udloeser INGEN reload", async () => {
  // Parseren er faerdig og appen er ved at vaere booted — linket her er en
  // route-praefetch app-koden indsaetter EFTER boot, og det staar hverken i
  // manifestet eller i install-snapshottet.
  const g = bootGuard();
  g.finishParsing();
  const runtimeLink = element("LINK", { rel: "modulepreload", href: RUNTIME_URL });
  g.fireResourceError(runtimeLink);
  await flush();

  assert.equal(g.fetched.length, 0, "URL'en er ikke et boot-asset, saa den roerer ikke vagten");
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
  assert.match(g.rootEl.innerHTML, /The game did not start/);
  assert.match(g.rootEl.innerHTML, /Spillet startede ikke/);
  assert.match(g.rootEl.innerHTML, /The game's files did not load\. Reload to try again\./);
  assert.match(g.rootEl.innerHTML, /Spillets filer blev ikke hentet\./);
  // Brand-fladen (#5161, ejer-krav 11/9): den inline wordmark og guld-knappen er
  // det der goer siden til Cycling Zone og ikke en browserfejl. Tokenerne er
  // haardkodede i vagten (der er ingen :root at arve fra), saa en stille drift
  // vaek fra spillets vaerdier skal fejle her.
  assert.match(g.rootEl.innerHTML, /aria-label="Cycling Zone"/);
  assert.match(g.rootEl.innerHTML, /#e8c547/, "guld-accenten (--accent) mangler");
  assert.match(g.rootEl.innerHTML, /#0e0f15/, "moerk canvas (--bg-body) mangler");
  assert.doesNotMatch(g.rootEl.innerHTML, /box-shadow/, "hairlines, ingen skygger");
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

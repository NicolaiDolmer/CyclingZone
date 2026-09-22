import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import i18n from "./i18n";
import { AppProviders } from "./AppProviders.jsx";
import App from "./App.jsx";
import { beginSsrHeadCapture, endSsrHeadCapture } from "./hooks/useDocumentHead.js";

// Prerender-entry (Node, build-time) — bruges af scripts/prerender.mjs til at
// generere de prerendrede offentlige ruter i dist/ (#5494; oprindeligt kun
// landing i dist/index.html).
//
// Vi renderer det SAMME <App/> som klienten (main.jsx), bare med StaticRouter i
// stedet for BrowserRouter. Det er afgørende for "/": hydration kræver at
// server- og client-træet er strukturelt identiske (samme komponent-dybde →
// samme useId osv.). På "/" har App ingen session endnu (getSession kører kun i
// en useEffect, som renderToString ikke eksekverer), så App renderer
// LandingPage — præcis som klientens første render gør.
//
// "/" hydreres (main.jsx: `hydratingLanding` kræver pathname === "/"); de
// øvrige prerendrede ruter gør IKKE — main.jsx rydder #root og laver en frisk
// createRoot-render på alt andet end "/". Server-HTML'en dér er altså ren
// crawler-/first-paint-værdi og kan ikke give hydration-mismatch.
//
// Renderes ÉN gang pr. rute på ét sprog (EN for de engelske ruter, DA for
// /privatlivspolitik + /handelsbetingelser). Header-baseret per-sprog-servering
// er umulig: Vercels CDN cacher en URL alene (ignorerer Accept-Language). En
// da-klient hydrerer derfor mod EN på "/" og skifter til sit sprog FØRST efter
// hydration (main.jsx's deferredLanguage → LanguageProvider mount-effect) —
// ellers ville klientens da-render mismatche EN-HTML'en (React
// #418/#422/#425, se .claude/learnings/2026-07-03-landing-hydration-lang-mismatch.md).

// ---------------------------------------------------------------------------
// i18n i Node (#5494)
//
// De sjældent besøgte namespaces er IKKE inlinet i i18n/index.js — de hentes
// af LocaleBundleBackend over HTTP fra /locales/{lng}/{ns}.json. I Node findes
// der ingen origin at hente fra, så en prerender af /help ville ramme
// I18nReadyGate/`ready`-gaten og udsende en PageLoader uden H1.
//
// Vi erstatter derfor backendens `read` med et opslag i de JSON-filer vi
// importerer statisk her. Modulet bygges KUN til dist-ssr (build-time) og
// slettes af prerender.mjs bagefter, så det koster intet i klient-bundlen.
import helpEn from "../public/locales/en/help.json";
import rulesEn from "../public/locales/en/rules.json";
import roadmapEn from "../public/locales/en/roadmap.json";
import patchnotesEn from "../public/locales/en/patchnotes.json";
import privacyEn from "../public/locales/en/privacy.json";
import founderEn from "../public/locales/en/founder.json";
import helpDa from "../public/locales/da/help.json";
import rulesDa from "../public/locales/da/rules.json";
import roadmapDa from "../public/locales/da/roadmap.json";
import patchnotesDa from "../public/locales/da/patchnotes.json";
import privacyDa from "../public/locales/da/privacy.json";
import founderDa from "../public/locales/da/founder.json";

const SSR_BUNDLES = {
  en: {
    help: helpEn,
    rules: rulesEn,
    roadmap: roadmapEn,
    patchnotes: patchnotesEn,
    privacy: privacyEn,
    founder: founderEn,
  },
  da: {
    help: helpDa,
    rules: rulesDa,
    roadmap: roadmapDa,
    patchnotes: patchnotesDa,
    privacy: privacyDa,
    founder: founderDa,
  },
};

// Antal render-pass vi højst bruger på at få lazy-grænser til at resolve.
// Hver pass opløser ét niveau (route-chunk → Layout → evt. indre lazy), så
// loftet er rigeligt; loopet stopper selv når output er stabilt.
const MAX_WARMUP_PASSES = 16;

let ssrI18nReady = false;

async function prepareI18n() {
  if (ssrI18nReady) return;

  // KRITISK (#5494, samme race som #5177): i18n.init() kalder SELV
  // changeLanguage(detekteret sprog) og skriver resultatet når dets async
  // resource-load lander. Kalder vi changeLanguage("en") FØR init er færdig,
  // vinder init'ens sene callback og sætter sproget tilbage. I Node betyder
  // "detekteret sprog" maskinens locale — `globalThis.navigator.language` er
  // "da-DK" på en dansk Windows-maskine — så prerenderen fik i18n.language
  // "da" mens teksten (tom da-bundle → fallbackLng) blev engelsk. Resultatet
  // var <html lang="da"> på en engelsk forside. Vent på `initialized` først,
  // præcis som main.jsx gør før mount.
  if (!i18n.isInitialized) {
    await new Promise((resolve) => i18n.on("initialized", resolve));
  }

  const backend = i18n.services?.backendConnector?.backend;
  if (backend) {
    // Deterministisk, netværksfri read for de namespaces vi har importeret.
    // Alt andet får LocaleBundleBackends egen read (den danske
    // first-paint-bundle er en dynamisk import og virker fint i Node).
    const originalRead = backend.read.bind(backend);
    backend.read = (language, namespace, callback) => {
      const base = typeof language === "string" ? language.split("-")[0] : "";
      const bundle = SSR_BUNDLES[base]?.[namespace];
      if (bundle) {
        callback(null, bundle);
        return;
      }
      originalRead(language, namespace, callback);
    };
  }
  for (const [lng, namespaces] of Object.entries(SSR_BUNDLES)) {
    for (const [ns, data] of Object.entries(namespaces)) {
      i18n.addResourceBundle(lng, ns, data, true, false);
    }
  }
  ssrI18nReady = true;
}

/**
 * Render én rute til HTML-strengen der skal ind i <div id="root">.
 *
 * React.lazy kan ikke resolve inde i ét renderToString-kald: den første render
 * starter import()'en og udsender Suspense-fallbacken. Vi render'er derfor
 * igen (med en macrotask imellem så import-promiser når at settle) indtil
 * output er stabilt — standard-varmeteknikken for lazy + renderToString.
 *
 * @param {string} url  rute-path, fx "/help"
 * @param {string} lng  "en" | "da"
 * @returns {Promise<{ html: string, head: object }>} html = #root-indhold,
 *   head = den metadata sidens useDocumentHead ville sætte klient-side.
 */
export async function render(url = "/", lng = "en") {
  await prepareI18n();
  if (i18n.language !== lng) {
    await i18n.changeLanguage(lng);
  }

  const tree = (
    <AppProviders>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </AppProviders>
  );

  let html = "";
  let head = {};
  let previous = null;
  for (let pass = 0; pass < MAX_WARMUP_PASSES; pass += 1) {
    beginSsrHeadCapture();
    html = renderToString(tree);
    head = endSsrHeadCapture();
    if (html === previous) break;
    previous = html;
    // Lad de import()-promiser React lige har startet, resolve.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { html, head };
}

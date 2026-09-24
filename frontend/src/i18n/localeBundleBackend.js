// i18next-backend der serverer et helt sprog fra ÉN lazy chunk — Refs #5177.
//
// ── Hvorfor ────────────────────────────────────────────────────────────────
//
// De 24 first-paint-namespaces laa inline i `resources` for BEGGE sprog (#411/
// #412/#470 kraever at de er der foer first paint, ellers renderer fladerne raa
// noegler med `useSuspense: false`). Resultatet var en statisk `i18n-messages`-
// chunk paa 426 KB raat / 131 KB gzippet i entry'ens kritiske sti — hvor
// haelvten altid var det sprog den besoegende IKKE bruger.
//
// Engelsk bliver liggende inline: det er baade default og `fallbackLng`, saa en
// manglende dansk noegle skal stadig kunne falde tilbage uden et netvaerkskald.
// Dansk flyttes til en lazy chunk (`messages.da.js`) som denne backend henter
// ÉN gang og derefter serverer alle 24 namespaces fra.
//
// ── Hvorfor en backend og ikke en changeLanguage-wrapper ───────────────────
//
// `i18next.init()` kalder selv `this.changeLanguage(...)` (i18next.js ~L1907),
// saa en wrapper omkring changeLanguage der venter paa init ville laase sig
// selv. Backend-interfacet er derimod praecis det hook i18next allerede bruger
// til "hent dette namespace paa dette sprog" — baade ved init OG ved et senere
// sprogskifte. Én mekanisme, ingen raekkefoelge-faelder.
//
// Alt backenden ikke selv kan svare paa falder igennem til i18next-http-backend
// praecis som foer: de route-gatede INLINE_EXEMPT-namespaces (help, board,
// roadmap …) ligger stadig som statiske filer i dist/locales/ paa begge sprog.

import HttpBackend from "i18next-http-backend";

// Kun sprog der har en lazy bundle staar her. Engelsk goer IKKE: det ligger
// inline i `resources`, og i18next spoerger derfor aldrig backenden om det
// (partialBundledLanguages springer bundlede namespaces over).
const LAZY_BUNDLES = {
  da: () => import("./messages.da.js"),
};

// Én promise pr. sprog — 24 namespace-opslag ved boot maa give ÉT netvaerkskald,
// ikke 24.
const inflight = new Map();

function loadBundle(lng) {
  const loader = LAZY_BUNDLES[lng];
  if (!loader) return null;
  if (!inflight.has(lng)) {
    inflight.set(
      lng,
      loader().then((mod) => mod.default)
    );
  }
  return inflight.get(lng);
}

/**
 * Normalisér en i18next-sprogkode til bundle-noeglen.
 *
 * i18next kan spoerge med regionale koder (`da-DK`) selv om `load:
 * "languageOnly"` er sat, fx via `toResolveHierarchy`. Vi matcher derfor paa
 * basis-koden. Pseudo-locale `en-XA` rammer ingen bundle og falder igennem til
 * den inline engelske — praecis som foer.
 *
 * @param {string} lng
 * @returns {string|null}
 */
export function bundleKey(lng) {
  if (typeof lng !== "string") return null;
  const base = lng.trim().toLowerCase().split("-")[0];
  return Object.prototype.hasOwnProperty.call(LAZY_BUNDLES, base) ? base : null;
}

export default class LocaleBundleBackend {
  static type = "backend";

  constructor(services, options = {}, i18nextOptions = {}) {
    this.type = "backend";
    this.init(services, options, i18nextOptions);
  }

  init(services, options = {}, i18nextOptions = {}) {
    this.http = new HttpBackend(services, options, i18nextOptions);
  }

  read(language, namespace, callback) {
    const key = bundleKey(language);
    const bundle = key ? loadBundle(key) : null;
    if (!bundle) {
      this.http.read(language, namespace, callback);
      return;
    }
    bundle.then(
      (messages) => {
        if (messages && Object.prototype.hasOwnProperty.call(messages, namespace)) {
          callback(null, messages[namespace]);
          return;
        }
        // Route-gatet namespace (INLINE_EXEMPT) — ligger ikke i bundlen og skal
        // hentes som statisk JSON praecis som foer.
        this.http.read(language, namespace, callback);
      },
      () => {
        // Chunken kunne ikke hentes (deploy-skift, offline). Fald tilbage til
        // den statiske JSON i stedet for at lade namespacet staa tomt — samme
        // holdning som lazyWithRetry: en langsom vej slaar en tom flade.
        this.http.read(language, namespace, callback);
      }
    );
  }
}

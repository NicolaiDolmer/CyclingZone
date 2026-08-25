// i18n foundation — Refs #410.
//
// Setup:
//   • react-i18next + i18next-icu (ICU MessageFormat plurals)
//   • HTTP backend lazy-loader namespaces fra /locales/{lng}/{ns}.json
//     (filer i frontend/public/locales/ — served af Vite på begge
//      dev og prod via samme URL)
//   • Namespaces der kan ramme first paint bundles INLINE
//     (FOUC-fri first paint — Refs #411, #412, #470).
//     React renderer med `useSuspense: false`, så ikke-inlinet namespace =
//     t() returnerer raw key på first paint ("dashboard:stats.balance" i UI).
//     Forward-guard: `scripts/i18n-check-namespace-inline.mjs` (kører i CI).
//   • #3697: namespaces hvis eneste forbrugere ligger bag en lazy route med
//     en `ready`-gate lazy-loades via HttpBackend i stedet. JSON-filerne
//     shippes allerede statisk i dist/locales/, så det fjerner ren JS-vægt
//     fra language-chunken uden at tilføje ny payload. Listen (og kravet om
//     ready-gate) håndhæves af INLINE_EXEMPT i guard-scriptet.
//   • supportedLngs: ['en','da','en-XA'] — pseudo-locale aktiveres
//     ved at sætte ?pseudo=1 i URL (kun dev/preview, ikke production-safe)
//
// Sprog-prioritet (initial detection):
//   1. localStorage 'cz_lang' (sat af LanguageProvider efter login)
//   2. browser navigator.language (kun ved første besøg)
//   3. fallbackLng 'en'
//
// DB-sync (users.language) håndteres af LanguageProvider, ikke her.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import HttpBackend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";
import ICU from "i18next-icu";

import commonDa from "../../public/locales/da/common.json";
import commonEn from "../../public/locales/en/common.json";
import authDa from "../../public/locales/da/auth.json";
import authEn from "../../public/locales/en/auth.json";
import errorsDa from "../../public/locales/da/errors.json";
import errorsEn from "../../public/locales/en/errors.json";
import auctionsDa from "../../public/locales/da/auctions.json";
import auctionsEn from "../../public/locales/en/auctions.json";
import transfersDa from "../../public/locales/da/transfers.json";
import transfersEn from "../../public/locales/en/transfers.json";
import dashboardDa from "../../public/locales/da/dashboard.json";
import dashboardEn from "../../public/locales/en/dashboard.json";
import bannersDa from "../../public/locales/da/banners.json";
import bannersEn from "../../public/locales/en/banners.json";
import feedbackDa from "../../public/locales/da/feedback.json";
import feedbackEn from "../../public/locales/en/feedback.json";
import riderDa from "../../public/locales/da/rider.json";
import riderEn from "../../public/locales/en/rider.json";
import ridersDa from "../../public/locales/da/riders.json";
import ridersEn from "../../public/locales/en/riders.json";
import riderFiltersDa from "../../public/locales/da/riderFilters.json";
import riderFiltersEn from "../../public/locales/en/riderFilters.json";
import teamDa from "../../public/locales/da/team.json";
import teamEn from "../../public/locales/en/team.json";
import financeDa from "../../public/locales/da/finance.json";
import financeEn from "../../public/locales/en/finance.json";
import sponsorDa from "../../public/locales/da/sponsor.json";
import sponsorEn from "../../public/locales/en/sponsor.json";
import headtoheadDa from "../../public/locales/da/headtohead.json";
import headtoheadEn from "../../public/locales/en/headtohead.json";
import halloffameDa from "../../public/locales/da/halloffame.json";
import halloffameEn from "../../public/locales/en/halloffame.json";
import riderTypesDa from "../../public/locales/da/riderTypes.json";
import riderTypesEn from "../../public/locales/en/riderTypes.json";
import racesDa from "../../public/locales/da/races.json";
import racesEn from "../../public/locales/en/races.json";
import trainingDa from "../../public/locales/da/training.json";
import trainingEn from "../../public/locales/en/training.json";
import academyDa from "../../public/locales/da/academy.json";
import academyEn from "../../public/locales/en/academy.json";
import klubDa from "../../public/locales/da/klub.json";
import klubEn from "../../public/locales/en/klub.json";
import staffDa from "../../public/locales/da/staff.json";
import staffEn from "../../public/locales/en/staff.json";
import landingDa from "../../public/locales/da/landing.json";
import landingEn from "../../public/locales/en/landing.json";
import globalRankDa from "../../public/locales/da/globalRank.json";
import globalRankEn from "../../public/locales/en/globalRank.json";

const PSEUDO_ENABLED = (() => {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("pseudo") === "1";
  } catch {
    return false;
  }
})();

const SUPPORTED = PSEUDO_ENABLED ? ["en", "da", "en-XA"] : ["en", "da"];

i18n
  .use(ICU)
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    supportedLngs: SUPPORTED,
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    // NB: de route-gatede namespaces (INLINE_EXEMPT i
    // scripts/i18n-check-namespace-inline.mjs) står BEVIDST ikke i init-listen —
    // de lazy-loades først når deres side mountes (react-i18next kalder
    // loadNamespaces via useTranslation). Stod de her, ville init vente på 2
    // HTTP-loads pr. namespace ved boot (da + en-fallback) og forsinke alt der
    // køer på init (fx changeLanguage).
    ns: ["common", "auth", "dashboard", "auctions", "transfers", "errors", "banners", "feedback", "rider", "riders", "riderFilters", "riderTypes", "team", "finance", "sponsor", "headtohead", "halloffame", "races", "training", "academy", "klub", "staff", "landing", "globalRank"],
    defaultNS: "common",
    // #2849 bølge 4 + #3697: de sjældent besøgte namespaces er IKKE i resources
    // (lazy via HttpBackend fra /locales/{lng}/{ns}.json — filerne ligger
    // allerede i dist/, så det er ren fjernelse af JS-vægt, ikke ny payload).
    // Se INLINE_EXEMPT i scripts/i18n-check-namespace-inline.mjs for listen +
    // kravet om at forbruger-fladen har en `ready`-gate.
    // KRITISK: uden partialBundledLanguages kalder i18next ALDRIG backenden når
    // `resources` er sat — de lazy namespaces "loader" så som tomme, `ready`
    // flipper true og siderne renderer rå nøgler (help crashede på
    // returnObjects). Fanget af ejeren på Vercel-preview 24/7.
    partialBundledLanguages: true,
    resources: {
      da: { common: commonDa, auth: authDa, errors: errorsDa, auctions: auctionsDa, transfers: transfersDa, dashboard: dashboardDa, banners: bannersDa, feedback: feedbackDa, rider: riderDa, riders: ridersDa, riderFilters: riderFiltersDa, riderTypes: riderTypesDa, team: teamDa, finance: financeDa, sponsor: sponsorDa, headtohead: headtoheadDa, halloffame: halloffameDa, races: racesDa, training: trainingDa, academy: academyDa, klub: klubDa, staff: staffDa, landing: landingDa, globalRank: globalRankDa },
      en: { common: commonEn, auth: authEn, errors: errorsEn, auctions: auctionsEn, transfers: transfersEn, dashboard: dashboardEn, banners: bannersEn, feedback: feedbackEn, rider: riderEn, riders: ridersEn, riderFilters: riderFiltersEn, riderTypes: riderTypesEn, team: teamEn, finance: financeEn, sponsor: sponsorEn, headtohead: headtoheadEn, halloffame: halloffameEn, races: racesEn, training: trainingEn, academy: academyEn, klub: klubEn, staff: staffEn, landing: landingEn, globalRank: globalRankEn },
    },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "cz_lang",
      caches: ["localStorage"],
    },
    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json",
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

if (PSEUDO_ENABLED) {
  i18n.changeLanguage("en-XA");
  applyPseudoTransform(i18n);
}

// Dev-only debug-handle — gør i18next inspectable fra DevTools så
// `window.__i18n.t("dashboard:stats.balance")` kan verificere namespace-loading
// uden at skulle gennem fuld login-flow. Eksisterer ikke i den rigtige prod-bundle.
// VITE_E2E sættes KUN af Playwrights webServer.env (#1342: e2e kører nu mod en
// statisk preview-build, hvor import.meta.env.DEV er false) — Vercel-prod-deploy
// sætter den aldrig, så handlen lækker ikke til rigtige brugere.
if (typeof window !== "undefined" && (import.meta.env.DEV || import.meta.env.VITE_E2E)) {
  window.__i18n = i18n;
}

function applyPseudoTransform(instance) {
  const wrap = (input) => {
    if (typeof input !== "string") return input;
    return `[${input}·••]`;
  };
  const origT = instance.t.bind(instance);
  instance.t = (key, options) => {
    const val = origT(key, options);
    return wrap(val);
  };
}

export default i18n;

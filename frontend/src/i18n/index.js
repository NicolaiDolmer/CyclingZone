// i18n foundation — Refs #410.
//
// Setup:
//   • react-i18next + i18next-icu (ICU MessageFormat plurals)
//   • HTTP backend lazy-loader namespaces fra /locales/{lng}/{ns}.json
//     (filer i frontend/public/locales/ — served af Vite på begge
//      dev og prod via samme URL)
//   • Alle namespaces der bruges på authenticated-pages bundles INLINE
//     (FOUC-fri first paint — Refs #411, #412, #470).
//     React renderer med `useSuspense: false`, så ikke-inlinet namespace =
//     t() returnerer raw key på first paint ("dashboard:stats.balance" i UI).
//     Forward-guard: `scripts/check-i18n-namespace-inline.mjs` (kører pre-build).
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
import helpDa from "../../public/locales/da/help.json";
import helpEn from "../../public/locales/en/help.json";
import boardDa from "../../public/locales/da/board.json";
import boardEn from "../../public/locales/en/board.json";
import adminDa from "../../public/locales/da/admin.json";
import adminEn from "../../public/locales/en/admin.json";
import riderDa from "../../public/locales/da/rider.json";
import riderEn from "../../public/locales/en/rider.json";
import ridersDa from "../../public/locales/da/riders.json";
import ridersEn from "../../public/locales/en/riders.json";
import riderFiltersDa from "../../public/locales/da/riderFilters.json";
import riderFiltersEn from "../../public/locales/en/riderFilters.json";
import notificationsDa from "../../public/locales/da/notifications.json";
import notificationsEn from "../../public/locales/en/notifications.json";
import teamDa from "../../public/locales/da/team.json";
import teamEn from "../../public/locales/en/team.json";
import financeDa from "../../public/locales/da/finance.json";
import financeEn from "../../public/locales/en/finance.json";
import backendMessagesDa from "../../public/locales/da/backendMessages.json";
import backendMessagesEn from "../../public/locales/en/backendMessages.json";

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
    ns: ["common", "auth", "dashboard", "auctions", "transfers", "admin", "errors", "patchnotes", "banners", "help", "board", "rider", "riders", "riderFilters", "notifications", "team", "finance", "backendMessages"],
    defaultNS: "common",
    resources: {
      da: { common: commonDa, auth: authDa, errors: errorsDa, auctions: auctionsDa, transfers: transfersDa, dashboard: dashboardDa, banners: bannersDa, help: helpDa, board: boardDa, admin: adminDa, rider: riderDa, riders: ridersDa, riderFilters: riderFiltersDa, notifications: notificationsDa, team: teamDa, finance: financeDa, backendMessages: backendMessagesDa },
      en: { common: commonEn, auth: authEn, errors: errorsEn, auctions: auctionsEn, transfers: transfersEn, dashboard: dashboardEn, banners: bannersEn, help: helpEn, board: boardEn, admin: adminEn, rider: riderEn, riders: ridersEn, riderFilters: riderFiltersEn, notifications: notificationsEn, team: teamEn, finance: financeEn, backendMessages: backendMessagesEn },
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
// uden at skulle gennem fuld login-flow. Eksisterer ikke i prod-bundle (import.meta.env.DEV).
if (typeof window !== "undefined" && import.meta.env.DEV) {
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

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
import sponsorDa from "../../public/locales/da/sponsor.json";
import sponsorEn from "../../public/locales/en/sponsor.json";
import backendMessagesDa from "../../public/locales/da/backendMessages.json";
import backendMessagesEn from "../../public/locales/en/backendMessages.json";
import profileDa from "../../public/locales/da/profile.json";
import profileEn from "../../public/locales/en/profile.json";
import activityDa from "../../public/locales/da/activity.json";
import activityEn from "../../public/locales/en/activity.json";
import standingsDa from "../../public/locales/da/standings.json";
import standingsEn from "../../public/locales/en/standings.json";
import headtoheadDa from "../../public/locales/da/headtohead.json";
import headtoheadEn from "../../public/locales/en/headtohead.json";
import watchlistDa from "../../public/locales/da/watchlist.json";
import watchlistEn from "../../public/locales/en/watchlist.json";
import halloffameDa from "../../public/locales/da/halloffame.json";
import halloffameEn from "../../public/locales/en/halloffame.json";
import riderTypesDa from "../../public/locales/da/riderTypes.json";
import riderTypesEn from "../../public/locales/en/riderTypes.json";
import racesDa from "../../public/locales/da/races.json";
import racesEn from "../../public/locales/en/races.json";
import resultsDa from "../../public/locales/da/results.json";
import resultsEn from "../../public/locales/en/results.json";
import seasonEndDa from "../../public/locales/da/seasonEnd.json";
import seasonEndEn from "../../public/locales/en/seasonEnd.json";
import founderDa from "../../public/locales/da/founder.json";
import founderEn from "../../public/locales/en/founder.json";
import achievementsDa from "../../public/locales/da/achievements.json";
import achievementsEn from "../../public/locales/en/achievements.json";
import roadmapDa from "../../public/locales/da/roadmap.json";
import roadmapEn from "../../public/locales/en/roadmap.json";
import trainingDa from "../../public/locales/da/training.json";
import trainingEn from "../../public/locales/en/training.json";
import academyDa from "../../public/locales/da/academy.json";
import academyEn from "../../public/locales/en/academy.json";
import landingDa from "../../public/locales/da/landing.json";
import landingEn from "../../public/locales/en/landing.json";
import rulesDa from "../../public/locales/da/rules.json";
import rulesEn from "../../public/locales/en/rules.json";
import calendarDa from "../../public/locales/da/calendar.json";
import calendarEn from "../../public/locales/en/calendar.json";

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
    ns: ["common", "auth", "dashboard", "auctions", "transfers", "admin", "errors", "patchnotes", "banners", "help", "board", "rider", "riders", "riderFilters", "riderTypes", "notifications", "team", "finance", "sponsor", "backendMessages", "profile", "activity", "standings", "headtohead", "watchlist", "halloffame", "races", "results", "seasonEnd", "founder", "achievements", "roadmap", "training", "academy", "landing", "rules", "calendar"],
    defaultNS: "common",
    resources: {
      da: { common: commonDa, auth: authDa, errors: errorsDa, auctions: auctionsDa, transfers: transfersDa, dashboard: dashboardDa, banners: bannersDa, help: helpDa, board: boardDa, admin: adminDa, rider: riderDa, riders: ridersDa, riderFilters: riderFiltersDa, riderTypes: riderTypesDa, notifications: notificationsDa, team: teamDa, finance: financeDa, sponsor: sponsorDa, backendMessages: backendMessagesDa, profile: profileDa, activity: activityDa, standings: standingsDa, headtohead: headtoheadDa, watchlist: watchlistDa, halloffame: halloffameDa, races: racesDa, results: resultsDa, seasonEnd: seasonEndDa, founder: founderDa, achievements: achievementsDa, roadmap: roadmapDa, training: trainingDa, academy: academyDa, landing: landingDa, rules: rulesDa, calendar: calendarDa },
      en: { common: commonEn, auth: authEn, errors: errorsEn, auctions: auctionsEn, transfers: transfersEn, dashboard: dashboardEn, banners: bannersEn, help: helpEn, board: boardEn, admin: adminEn, rider: riderEn, riders: ridersEn, riderFilters: riderFiltersEn, riderTypes: riderTypesEn, notifications: notificationsEn, team: teamEn, finance: financeEn, sponsor: sponsorEn, backendMessages: backendMessagesEn, profile: profileEn, activity: activityEn, standings: standingsEn, headtohead: headtoheadEn, watchlist: watchlistEn, halloffame: halloffameEn, races: racesEn, results: resultsEn, seasonEnd: seasonEndEn, founder: founderEn, achievements: achievementsEn, roadmap: roadmapEn, training: trainingEn, academy: academyEn, landing: landingEn, rules: rulesEn, calendar: calendarEn },
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

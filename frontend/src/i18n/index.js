// i18n foundation — Refs #410.
//
// Setup:
//   • react-i18next + i18next-icu (ICU MessageFormat plurals)
//   • HTTP backend lazy-loader namespaces fra /locales/{lng}/{ns}.json
//     (filer i frontend/public/locales/ — served af Vite på begge
//      dev og prod via samme URL)
//   • common.json + auth.json + errors.json bundles inline (FOUC-fri
//     first paint på NavBar + Login/Signup/Onboarding/Errors — Refs #411)
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
    ns: ["common", "auth", "dashboard", "auctions", "admin", "errors", "patchnotes"],
    defaultNS: "common",
    resources: {
      da: { common: commonDa, auth: authDa, errors: errorsDa },
      en: { common: commonEn, auth: authEn, errors: errorsEn },
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

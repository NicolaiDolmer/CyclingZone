// Ét sted at tilføje et sprog — Refs #4733 (#4110 Trin 1, punkt 4).
//
// Al kode der i dag hardcoder ['en','da'] (i18n-init's supportedLngs,
// LanguageProvider's SUPPORTED, LanguageSwitcher's OPTIONS, LandingPage's
// toggle) importerer nu fra HER i stedet. Et nyt sprog kræver kun én ny
// entry i LANGUAGES + de matchende locale-JSON-filer under
// frontend/public/locales/<code>/ + den matchende værdi i
// users_language_check (se database/2026-09-03-4733-users-language-
// constraint-config.sql, som holder samme liste og skal udvides sammen med
// denne fil).
//
// Flag-koder matcher de faktiske `fi fi-<code>`-klasser fra flag-icons, som
// LanguageSwitcher.jsx og Flag.jsx allerede bruger i dag (en → gb, da → dk).
export const LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English", flag: "gb" },
  { code: "da", label: "Danish", nativeLabel: "Dansk", flag: "dk" },
];

export const SUPPORTED_LANGS = LANGUAGES.map((l) => l.code);

export const DEFAULT_LANG = "en";

// Pseudo-locale til layout-stress-test (?pseudo=1) — findes ikke som en rigtig
// sprog-entry i LANGUAGES (ingen locale-JSON, intet flag, ikke valgbar i UI).
export const PSEUDO_LANG = "en-XA";

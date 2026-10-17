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
// #6802: `beta: true` skjuler sproget for almindelige spillere. Et beta-sprog er
// kun valgbart i sprogvaelgeren for ejer + beta-testere (lib/languageAccess.js),
// og browser-detektionen vaelger det ALDRIG automatisk (i18n/index.js). Et
// sprog uden `beta` (eller med `beta: false`) er offentligt. Et registreret
// beta-sprog skal bestaa paritetsgaten (#6597) og have en lazy bundle i
// localeBundleBackend.js (testet), saa EN/DA-bundlen aldrig vokser.
//
// Flag-koder matcher de faktiske `fi fi-<code>`-klasser fra flag-icons, som
// LanguageSwitcher.jsx og Flag.jsx allerede bruger i dag (en → gb, da → dk).
export const LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English", flag: "gb", beta: false },
  { code: "da", label: "Danish", nativeLabel: "Dansk", flag: "dk", beta: false },
  // #6836: fr/es/nl er skjulte beta-sprog (ejer + beta-testere), aldrig offentlige.
  { code: "fr", label: "French", nativeLabel: "Français", flag: "fr", beta: true },
  { code: "es", label: "Spanish", nativeLabel: "Español", flag: "es", beta: true },
  { code: "nl", label: "Dutch", nativeLabel: "Nederlands", flag: "nl", beta: true },
];

export const SUPPORTED_LANGS = LANGUAGES.map((l) => l.code);

export const DEFAULT_LANG = "en";

// #6802: offentlige sprog (alle uden beta-flag) — det landing-toggle, browser-
// detektion og anonyme besoegende maa se.
export const PUBLIC_LANGS = LANGUAGES.filter((l) => !l.beta).map((l) => l.code);

/** Er koden et registreret beta-sprog? (basis-kode, case-insensitiv) */
export function isBetaLang(code) {
  if (typeof code !== "string") return false;
  const base = code.trim().toLowerCase().split("-")[0];
  return LANGUAGES.some((l) => l.code === base && l.beta === true);
}

/** Findes der overhovedet et beta-sprog? Falsk i dag => ingen netvaerkskald. */
export const HAS_BETA_LANGS = LANGUAGES.some((l) => l.beta === true);


// Pseudo-locale til layout-stress-test (?pseudo=1) — findes ikke som en rigtig
// sprog-entry i LANGUAGES (ingen locale-JSON, intet flag, ikke valgbar i UI).
export const PSEUDO_LANG = "en-XA";

// Browser-sprogdetektion der aldrig vaelger et beta-sprog — Refs #6802.
//
// i18next-browser-languagedetector sender navigator.languages til i18next, som
// vaelger det foerste SUPPORTED. Er et beta-sprog (fx fransk) registreret i
// languages.js, ville enhver spiller med fransk browser derfor lande paa det
// skjulte sprog. Beta-sprog maa kun vaelges bevidst i sprogvaelgeren (ejer +
// beta-testere), saa navigator-opslaget filtrerer dem fra. localStorage
// (`cz_lang`, sat af LanguageProvider efter et bevidst valg) roeres ikke.

import LanguageDetector from "i18next-browser-languagedetector";
import { isBetaLang } from "./languages.js";

/**
 * Fjern beta-sprog fra en liste af browser-sprogkoder. Ren funktion.
 * @param {unknown} codes
 * @returns {string[]}
 */
export function publicLanguageCandidates(codes) {
  if (!Array.isArray(codes)) return [];
  return codes.filter((c) => typeof c === "string" && c && !isBetaLang(c));
}

function navigatorPublicLookup() {
  if (typeof navigator === "undefined") return undefined;
  const found = [];
  if (Array.isArray(navigator.languages)) found.push(...navigator.languages);
  if (navigator.userLanguage) found.push(navigator.userLanguage);
  if (navigator.language) found.push(navigator.language);
  const out = publicLanguageCandidates(found);
  return out.length > 0 ? out : undefined;
}

export default class PublicLanguageDetector extends LanguageDetector {
  init(...args) {
    super.init(...args);
    this.addDetector({ name: "navigatorPublic", lookup: navigatorPublicLookup });
  }
}

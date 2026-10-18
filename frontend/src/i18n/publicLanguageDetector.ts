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

/** Fjern beta-sprog fra en liste af browser-sprogkoder. Ren funktion. */
export function publicLanguageCandidates(codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];
  return codes.filter((c): c is string => typeof c === "string" && c !== "" && !isBetaLang(c));
}

function navigatorPublicLookup(): string[] | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & { userLanguage?: string };
  const found: string[] = [];
  if (Array.isArray(nav.languages)) found.push(...nav.languages);
  if (nav.userLanguage) found.push(nav.userLanguage);
  if (nav.language) found.push(nav.language);
  const out = publicLanguageCandidates(found);
  return out.length > 0 ? out : undefined;
}

export default class PublicLanguageDetector extends LanguageDetector {
  override init(...args: Parameters<LanguageDetector["init"]>): void {
    super.init(...args);
    this.addDetector({ name: "navigatorPublic", lookup: navigatorPublicLookup });
  }
}

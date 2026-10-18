// Hvem maa se/vaelge beta-sprog? — Refs #6802.
//
// Ren logik (ingen React, ingen netvaerk) saa den kan testes med node:test.
// Beta-adgang er den EKSISTERENDE adgang: users.is_beta_tester (laeses via
// GET /api/me/beta-access, #5259) eller ejeren (GET /api/admin/owner-check,
// #3750). Gaten her er kun SYNLIGHED i sprogvaelgeren — der er ingen
// serverside-hemmelighed i en oversaettelse, og en bevidst valgt `cz_lang` i
// localStorage er spillerens eget valg.

import { DEFAULT_LANG, isBetaLang } from "../i18n/languages.js";

export interface LanguageLike {
  code: string;
  beta?: boolean;
}

/** Kun et aegte `true` giver adgang (fail-closed). */
export function hasBetaLanguageAccess(
  { isBetaTester, isOwner }: { isBetaTester?: unknown; isOwner?: unknown } = {}
): boolean {
  return isBetaTester === true || isOwner === true;
}

/**
 * Valgmuligheder til sprogvaelgeren. `access`: true = beta-adgang; false/null
 * (ukendt eller ingen) = kun offentlige sprog. Fail-closed.
 */
export function selectableLanguages<L extends LanguageLike>(languages: L[], access: boolean | null): L[] {
  return languages.filter((l) => !l.beta || access === true);
}

/**
 * Skal det aktive sprog rulles tilbage til standardsproget? Kun naar vi VED
 * (access === false, ikke null) at viewer ikke har beta-adgang, og sproget er
 * beta. `null` (ikke hentet endnu) rulles aldrig tilbage — ellers ville en
 * beta-tester blive kastet til engelsk ved hver sideindlaesning.
 *
 * Returnerer sproget der skal skiftes til, eller null.
 */
export function languageToRevertTo(activeCode: string, access: boolean | null): string | null {
  return access === false && isBetaLang(activeCode) ? DEFAULT_LANG : null;
}

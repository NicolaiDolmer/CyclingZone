// #5742 (Discord 24/9, beta-forummet): flyt-knappen på rytterprofilen og My
// Team hed stadig "Move to academy" / "To academy", selvom akademiet er
// erstattet af U23- og juniortrupper (#5626). Denne fil afgør hvilken trup en
// SENIOR-rytter reelt rykker NED i, og om han overhovedet må flyttes.
//
// SPEJL af backend/lib/squads.js SQUAD_MAX_AGE (samme mønster som
// squadCaps.ts's JUNIOR_MAX_SEASON_AGE): junior sæsonalder 16-18, U23 19-22,
// senior 23+ har intet ungdomstrup at rykke ned i. Ret squads.js og denne fil
// i samme PR, hvis grænserne nogensinde ændres.
//
// YOUTH_RULES.md §2 (ejer 2/9, LÅST): "Opad er altid tilladt (en 17-årig må
// stå på U23-holdet), nedad kun inden for aldersloftet." En senior-rytter der
// er junior-alder (≤18) må derfor godt vælge ENTEN junior (hans naturlige
// trup) ELLER U23 (opad) — aldrig kun ét valg gemt væk. En U23-alder rytter
// (19-22) har kun ét muligt mål: U23 (nedad i junior ville bryde aldersloftet).
//
// Ren .ts uden React-import, så node --test kan loade den (samme kontrakt som
// squadCaps.ts).

import { JUNIOR_MAX_SEASON_AGE } from "./squadCaps.ts";
import type { YouthSquad } from "./youthSquadPages.ts";

/** Højeste sæsonalder i U23-truppen. Spejl af backend/lib/squads.js SQUAD_MAX_AGE.u23.
 *  Samme grænse som riderAge.js' isU23 (alder < 23) bruger til at vise/skjule
 *  flyt-knappen — denne konstant er den TRUP-navngivende side af samme regel. */
export const U23_MAX_SEASON_AGE = 22;

/**
 * Ungdomstruppen en SENIOR-rytter rykker ned i, ud fra sæsonalderen alene —
 * junior ≤ 18, U23 19-22, `null` ved 23+ (ikke berettiget) eller ukendt alder.
 * Matcher backend academyTransfer.js' demoteTargetSquad() uden et eksplicit
 * ønsket-trup-argument (dvs. samme trup RPC'en selv vælger som default).
 */
export function demoteNaturalTargetSquad(seasonAge: number | null | undefined): YouthSquad | null {
  if (!Number.isFinite(seasonAge as number)) return null;
  const age = seasonAge as number;
  if (age <= JUNIOR_MAX_SEASON_AGE) return "junior";
  if (age <= U23_MAX_SEASON_AGE) return "u23";
  return null;
}

export interface DemoteSquadOption {
  squad: YouthSquad;
  isDefault: boolean;
}

/**
 * De trupper en manager kan vælge imellem for en given sæsonalder, i fast
 * rækkefølge (naturlig trup først). Tom liste = rytteren kan slet ikke
 * flyttes ned (23+ eller ukendt alder).
 *
 * junior-alder (≤18): [junior (default), u23] — opad er altid tilladt.
 * U23-alder (19-22):  [u23 (default)] — nedad i junior ville bryde aldersloftet
 *                      (fitsSquadAge i squads.js), og der er intet andet at
 *                      vælge opad til herfra (senior er ikke en "ungdomstrup").
 */
export function demoteSquadOptions(seasonAge: number | null | undefined): DemoteSquadOption[] {
  const natural = demoteNaturalTargetSquad(seasonAge);
  if (natural === null) return [];
  // Naturlig trup altid først (den forudvalgte default), "opad"-alternativet
  // (u23) sidst — IKKE blot YOUTH_SQUADS' faste rækkefølge (u23, junior).
  const squads: YouthSquad[] = natural === "junior" ? ["junior", "u23"] : ["u23"];
  return squads.map((squad) => ({ squad, isDefault: squad === natural }));
}

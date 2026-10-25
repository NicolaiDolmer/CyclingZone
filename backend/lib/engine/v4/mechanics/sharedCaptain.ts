// backend/lib/engine/v4/mechanics/sharedCaptain.ts
// #5981 (KUN s5_profiles_v3, SLUKKET): DELT KAPTAJN — den sjette rolle.
//
// SSOT: docs/superpowers/specs/2026-10-25-taktik-roller-design.md §5 + §11
// (ejer-beslutninger 25/10) og docs/RACE_ENGINE_RULES.md §1 ("Delt kaptajn").
//
// Ejer-beslutninger 25/10 (ordret valgt):
//  1. Delt kaptajn er en ny rolle. I SAMME gruppe faar kaptajnen hjaelpen
//     FOERST, og det hjaelperne har tilovers gaar til den delte kaptajn. Et
//     stort hold kan beskytte to, et lille kan ikke (som i virkeligheden).
//  3. Et hold maa stille op med kun en spurtkaptajn som leder (#6321). Det kan
//     motoren allerede (protectedRoleOrder falder tilbage); ingen motor-aendring.
//  4. Hoejst én delt kaptajn pr. hold (valideringen, raceSelection.js).
//  5. Med i samme taending som v3 (s5_profiles_v3).
//
// Hvad rollen goer i motoren:
//  - Holdspil (M16, teamPlay.ts): beskyttet, betaler ingen hjaelperpris og
//    arbejder aldrig. Hjaelpen DELES fra de hjaelpere der allerede koerer
//    (splitLeaderBonus); bevarelses-garantien gaelder uaendret: kaptajnens og
//    den delte kaptajns samlede bonus overstiger aldrig det holdet betalte.
//  - Vejen afgoer: sidder de to i hver sin gruppe, koerer hver gruppes
//    hjaelpere for den leder der sidder i DERES gruppe. Er kaptajnen ude
//    (styrt, udgaaet, sat af), faar den delte kaptajn hele hjaelpen i sin gruppe.
//  - Morgenudbrud: som kaptajnen, kun med "Forsoeg udbrud" (breakawayPermission.ts).
//  - `protect`: som kaptajnen, foelger angreb (breakaway.ts effortJoinBoost).
//  - Jagt og klassementsreaktion: aldrig jagt-arbejder (breakaway.ts,
//    teamChaseReaction.ts, breakawayPermission.ts's modreaktion).
//  - Klassementsreaktion i etapeloeb: uaendret regel (holdets bedst placerede).
//  - Endagsloeb: holdets beskyttede rytter er den af lederne der passer bedst
//    til dagens rute (gcThreat.oneDayProtectedRider).
//  - Bjergpoint i favoritgruppen (#6937): ruller over toppen som en kaptajn.
//  - AI-hold (aiCoCaptainId): i etapeloeb faar et AI-hold en delt kaptajn naar
//    holdets naestbedste klassementsrytter er taet paa kaptajnen. Samme rolle,
//    ingen side-kanal.
//
// AELDRE REVISIONER: rollen tilbydes ikke og API'et afviser den
// (raceSelection.js / raceStageRolesApi.js). En stray raekke koeres uden
// beskyttelse og uden pris (teamPlay.ts vaelger ham kun under v3) og uden
// spontane udbrud. Et hold UDEN delt kaptajn er byte-identisk i alle revisioner.
//
// REN — ingen IO, ingen Date, ingen rng.

import type { AbilityKey } from "../types.ts";

/** Den sjette rolle. Samme streng i DB, API, ordre-kontrakten og motoren. */
export const CO_CAPTAIN_ROLE = "co_captain" as const;

/**
 * #5981 (KUN s5_profiles_v3): lederraekkefoelgen med den delte kaptajn. Han
 * staar lige efter kaptajnen: paa en flad etape er spurtkaptajnen stadig
 * foerst, ellers kommer den delte kaptajn foer spurtkaptajnen (en
 * klassementsrytter er vigtigere end sprinteren paa en bjergetape).
 * `base` er teamPlay.protectedRoleOrder(profil).
 */
export function protectedRoleOrderWithCoCaptain(base: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const role of base) {
    out.push(role);
    if (role === "captain") out.push(CO_CAPTAIN_ROLE);
  }
  if (!out.includes(CO_CAPTAIN_ROLE)) out.push(CO_CAPTAIN_ROLE);
  return out;
}

/**
 * #5981 (ejer-valg 1 A): fordelingen naar den delte kaptajn sidder i SAMME
 * gruppe som holdets leder. Lederen faar hjaelpen foerst (op til sit eget
 * loft); det hjaelperne har tilovers (`fromTeam` minus lederens del) gaar til
 * den delte kaptajn, op til hans eget loft.
 *
 * Garantier (konstruktion): begge >= 0; summen <= `fromTeam` (bevarelse);
 * lederens del er PRAECIS den han ville faa uden delt kaptajn (kaptajnen taber
 * intet til ham i holdspillet).
 */
export function splitLeaderBonus(input: {
  fromTeam: number;
  leaderCeiling: number;
  coLeaderCeiling: number;
  hasCoLeader: boolean;
}): { leader: number; coLeader: number } {
  // Lederens del er udtrykket teamPlay brugte foer #5981, uaendret (bit-identisk uden delt kaptajn).
  const leader = Math.max(0, Math.min(input.fromTeam, input.leaderCeiling));
  if (!input.hasCoLeader) return { leader, coLeader: 0 };
  const leftover = Number.isFinite(input.fromTeam) ? Math.max(0, input.fromTeam - leader) : 0;
  const coLeader = Math.max(0, Math.min(leftover, input.coLeaderCeiling));
  return { leader, coLeader };
}

// ── AI-hold (#5981, spec §5 "AI-hold") ───────────────────────────────────────

/** Klassementsevnen AI'en vaelger paa: samme faste akser som gcThreat.gcAbility. */
const AI_GC_KEYS: readonly AbilityKey[] = ["climbing", "tempo", "time_trial"];

/**
 * #5981 (KUN s5_profiles_v3, deep-frosset): hvornaar et AI-hold faar en delt
 * kaptajn. Kalibrering og maalinger: balance-internals/5981/ (privat).
 */
export const SHARED_CAPTAIN_AI_TUNING = Object.freeze({
  /** Kandidatens klassementsevne som andel af kaptajnens, for at blive delt kaptajn. */
  closeToCaptainShare: 0.95,
  /**
   * Holdets stoerrelse i loebet, for at AI'en deler kaptajnrollen: kun et hold med
   * hjaelpere nok til to (grand tour-stoerrelse). Et lille hold koerer for én.
   */
  minRosterSize: 7,
});

/** Roller AI'en kan goere til delt kaptajn (ikke jaeger, ikke spurtkaptajn). */
const AI_CO_CAPTAIN_CANDIDATE_ROLES: ReadonlySet<string> = new Set(["helper", "free_role"]);

function gcAbility(abilities: Readonly<Partial<Record<AbilityKey, number>>> | null | undefined): number {
  if (!abilities) return 0;
  let sum = 0;
  for (const key of AI_GC_KEYS) {
    const v = Number(abilities[key]);
    sum += Number.isFinite(v) ? Math.max(0, Math.min(99, v)) / 99 : 0;
  }
  return sum / AI_GC_KEYS.length;
}

/**
 * #5981 (KUN s5_profiles_v3, KUN etapeloeb): AI-holdets delte kaptajn, eller
 * null. Holdet skal vaere stort nok til to ledere (minRosterSize), have en kaptajn (en delt kaptajn kraever en kaptajn), ingen
 * delt kaptajn i forvejen, og holdets bedste hjaelper/fri rolle paa
 * klassementsevne skal ligge taet paa kaptajnen. Deterministisk: lige evne
 * afgoeres paa rider_id. Evnerne er loebets faste, saa valget er det samme paa
 * alle etaper (en rolle gaelder hele loebet).
 */
export function aiCoCaptainId(
  roster: readonly { rider_id: string; role: string }[],
  abilitiesOf: (riderId: string) => Readonly<Partial<Record<AbilityKey, number>>> | null | undefined,
  tuning: typeof SHARED_CAPTAIN_AI_TUNING = SHARED_CAPTAIN_AI_TUNING,
): string | null {
  if (roster.length < tuning.minRosterSize) return null;
  if (roster.some((r) => r.role === CO_CAPTAIN_ROLE)) return null;
  const captain = roster.find((r) => r.role === "captain");
  if (!captain) return null;
  const captainAbility = gcAbility(abilitiesOf(captain.rider_id));
  if (!(captainAbility > 0)) return null;
  let pick: { id: string; ability: number } | null = null;
  for (const r of roster) {
    if (!AI_CO_CAPTAIN_CANDIDATE_ROLES.has(r.role)) continue;
    const ability = gcAbility(abilitiesOf(r.rider_id));
    if (!pick || ability > pick.ability || (ability === pick.ability && r.rider_id < pick.id)) pick = { id: r.rider_id, ability };
  }
  return pick && pick.ability >= tuning.closeToCaptainShare * captainAbility ? pick.id : null;
}

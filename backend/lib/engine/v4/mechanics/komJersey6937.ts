// backend/lib/engine/v4/mechanics/komJersey6937.ts
// #6937 B1 (KUN s5_profiles_v3): bjergjaegeren der jagter troejen over flere dage.
// Spec: docs/superpowers/specs/2026-10-23-6804-v3-tilvalg-design.md §2.1.
//
// Rod-aarsagen (maalt): bjergpointene undervejs gaar mest til udbrud, men til en
// ny rytter hver dag, saa ingen samler nok til at slaa klassementsvinderens
// topankomst-point (ejer-laast skala, maalorden). I virkeligheden er det de
// samme faa ryttere der gaar efter troejen dag efter dag. Derfor:
//   1. Bjergjaegerne foer etapen = de forreste i bjergkonkurrencen (point > 0),
//      som runneren sender med i `jersey_leaders.kom_hunters` (broen: kun v3). Kaptajner er aldrig
//      jaegere: de koerer for klassementet (som B2).
//   2. En jaeger kaemper om hver bjergtop undervejs, ogsaa i feltet (som
//      troejefoereren goer i dag). Topankomsten er uaendret (maalordenen).
//   3. Et AI-hold der ikke selv jager, sender sin jaeger i morgenudbruddet paa en
//      dag med bjergpoint undervejs (bjerg/kuperet). Aldrig en garanti: motoren
//      afgoer stadig hvem der kommer afsted. Menneskeholdenes ordrer er uroerte.
// Skalaerne roeres ikke. v1/v2 og aeldre: intet her kaldes (bit-identisk).
//
// REN: ingen IO, ingen rng. Refs #6937 #6804

import type { Entrant, JerseyLeaders } from "../types.ts";

// Hvor mange af konkurrencens forreste der er jaegere, bestemmer runneren
// (raceClassifications.KOM_HUNTERS_TOP_N, via jerseyLeadersFromComps).
export const KOM_JERSEY_6937_TUNING = Object.freeze({
  /** Roller der aldrig er bjergjaegere (de koerer for klassementet/spurten). */
  neverHunterRoles: Object.freeze(["captain", "sprint_captain"]) as readonly string[],
  /** Profiler hvor et AI-hold sender sin jaeger i udbrud (dage med bjergpoint undervejs). */
  hunterBreakProfiles: Object.freeze(["mountain", "high_mountain", "medium_mountain", "hilly"]) as readonly string[],
});

/** Motor-siden: dagens bjergjaegere (kaptajner fraregnet). Tom uden input. */
export function komHunterSet(
  jerseyLeaders: JerseyLeaders | null | undefined,
  entrants: Readonly<Record<string, Entrant>>,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const id of jerseyLeaders?.kom_hunters ?? []) {
    const role = String(entrants[id]?.role ?? "");
    if (entrants[id] && !KOM_JERSEY_6937_TUNING.neverHunterRoles.includes(role)) out.add(id);
  }
  return out;
}

/**
 * AI-siden: holdets bjergjaeger der skal i udbrud i dag, eller null. Kun paa en
 * profil med bjergpoint undervejs, kun en jaeger fra holdets egen trup, aldrig en
 * kaptajn og aldrig en rytter holdet ikke maa sende (grupetto/blokeret).
 */
export function aiKomHunterForBreak(args: {
  profileType: string;
  isStageRace: boolean;
  roster: readonly { rider_id: string; role: string }[];
  komHunterIds: readonly string[] | null | undefined;
  noBreakIds: ReadonlySet<string>;
}): string | null {
  if (!args.isStageRace || !KOM_JERSEY_6937_TUNING.hunterBreakProfiles.includes(args.profileType)) return null;
  const order = args.komHunterIds ?? [];
  for (const id of order) {
    const r = args.roster.find((x) => x.rider_id === id);
    if (!r || args.noBreakIds.has(id) || KOM_JERSEY_6937_TUNING.neverHunterRoles.includes(String(r.role))) continue;
    return id;
  }
  return null;
}

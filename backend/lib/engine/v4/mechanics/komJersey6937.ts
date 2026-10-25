// backend/lib/engine/v4/mechanics/komJersey6937.ts
// #6937 B1 (KUN s5_profiles_v3): bjergjaegeren der jagter troejen over flere dage.
// Spec: docs/superpowers/specs/2026-10-23-6804-v3-tilvalg-design.md §2.1.
//
// Rod-aarsagen (maalt): bjergpointene undervejs gaar mest til udbrud, men til en
// ny rytter hver dag, saa ingen samler nok til at slaa klassementsvinderens
// topankomst-point (dobbelt skala, maalorden; se 4.). I virkeligheden er det de
// samme faa ryttere der gaar efter troejen dag efter dag. Derfor:
//   1. Bjergjaegerne foer etapen = de forreste i bjergkonkurrencen (point > 0),
//      som runneren sender med i `jersey_leaders.kom_hunters` (broen: kun v3). Kaptajner er aldrig
//      jaegere: de koerer for klassementet (som B2).
//   2. En jaeger kaemper om hver bjergtop undervejs, ogsaa i feltet (som
//      troejefoereren goer i dag). Topankomsten afgoeres af maalordenen.
//   3. Et AI-hold der ikke selv jager, sender sin jaeger i morgenudbruddet paa en
//      dag med bjergpoint undervejs (bjerg/kuperet). Aldrig en garanti: motoren
//      afgoer stadig hvem der kommer afsted. Menneskeholdenes ordrer er uroerte.
//   4. Ejer 25/10: topankomsten giver stigningens almindelige point, ikke dobbelt
//      (summitFinishSingleFor). v1/v2 og aeldre: intet her kaldes (bit-identisk).
//   5. Ejer 25/10 ordret ("Bjergtroeje-jaeger"): jaegeren er den der foerer eller
//      jager bjergtroejen, taet paa i bjergkonkurrencen og IKKE klassementsrytter.
//      Runneren sender konkurrencens forreste; motoren og AI'en tager de forreste af
//      dem der hverken er kaptajn eller klassementsrytter (samme graense som #6818's
//      morgenblokering, s5MorningGcBlockedRiders).
//
// REN: ingen IO, ingen rng. Refs #6937 #6804

import type { Entrant, JerseyLeaders } from "../types.ts";
import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";
import { s5MorningGcBlockedRiders } from "./breakaway.ts";

/**
 * #6937 (KUN s5_profiles_v3, ejer 25/10 ordret: "Ja: almindelige point paa
 * topankomst"): en topankomst giver samme bjergpoint som stigningen ellers ville,
 * ikke dobbelt (som Giroen og Vueltaen). Aeldre revisioner: dobbelt som foer.
 * Bruges af alle tre maalpassage-veje (vejetape, holdtidskoersel, enkeltstart).
 */
export function summitFinishSingleFor(rulesRevision: unknown): { summitFinishSingle?: true } {
  return isS5ProfilesV3OrLater(rulesRevision) ? { summitFinishSingle: true } : {};
}

// Hvor mange af konkurrencens forreste der er jaegere, bestemmer runneren
// (raceClassifications.KOM_HUNTERS_TOP_N, via jerseyLeadersFromComps).
export const KOM_JERSEY_6937_TUNING = Object.freeze({
  /** Roller der aldrig er bjergjaegere (de koerer for klassementet/spurten). */
  neverHunterRoles: Object.freeze(["captain", "sprint_captain"]) as readonly string[],
  /** Profiler hvor et AI-hold sender sin jaeger i udbrud (dage med bjergpoint undervejs). */
  hunterBreakProfiles: Object.freeze(["mountain", "high_mountain", "medium_mountain", "hilly"]) as readonly string[],
});

/**
 * Ejer 25/10 ("Bjergtroeje-jaeger"): de forreste i bjergkonkurrencen (`ids` i
 * konkurrencens orden) der er med i dagens felt (`roleOf` kender dem), ikke er kaptajn
 * og ikke er klassementsrytter (`gcRiderIds`), i konkurrencens orden. REN.
 */
export function eligibleKomHunters(
  ids: readonly string[] | null | undefined,
  roleOf: (id: string) => string | null | undefined,
  gcRiderIds: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    const role = roleOf(id);
    if (role === undefined || KOM_JERSEY_6937_TUNING.neverHunterRoles.includes(String(role)) || gcRiderIds.has(id)) continue;
    out.push(id);
  }
  return out;
}

/** Klassementsrytterne (#6818's morgenblokering) ud fra GC-konteksten; tom uden en stilling. */
export function komHunterGcRiders(gcContext: unknown, entrants: Readonly<Record<string, Entrant>>): ReadonlySet<string> {
  return gcContext ? s5MorningGcBlockedRiders({ gcContext: gcContext as never, entrants }, Object.keys(entrants)) : new Set<string>();
}

/** Motor-siden: dagens bjergjaegere (kaptajner og klassementsryttere fraregnet). Tom uden input. */
export function komHunterSet(
  jerseyLeaders: JerseyLeaders | null | undefined,
  entrants: Readonly<Record<string, Entrant>>,
  gcContext?: unknown,
): ReadonlySet<string> {
  if (!jerseyLeaders?.kom_hunters?.length) return new Set<string>();
  const roleOf = (id: string) => (entrants[id] ? String(entrants[id].role ?? "") : undefined);
  return new Set(eligibleKomHunters(jerseyLeaders.kom_hunters, roleOf, komHunterGcRiders(gcContext, entrants)));
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

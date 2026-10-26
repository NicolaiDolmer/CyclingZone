// backend/lib/engine/v4/mechanics/gcBreakawayLeash7258.ts
// #7258 (KUN s5_profiles_v3): klassementet maa ikke afgoeres af et morgenudbrud.
//
// Rod-aarsagen (verificeret paa testportens tilfaelde, balance-internals/7258/): S5-modellen
// (gcThreat.dangerOf) maaler fare som klassementsevne mod holdets EGEN klassementsrytter.
// Under dangerFloor er en rytter "ingen rival", og saa jages han slet ikke, uanset hvor stort
// forspringet bliver. Men motoren giver en svagere rytter et lille tidstab paa resten af loebet
// (paa kuperet og mellembjerg intet), saa et udbrud med mange minutter afgjorde klassementet.
//
// Rettelsen er fremskrivningen, brugt konsekvent: evne x resterende etaper. For hver etape
// efter i dag taber en svagere rytter (1 - styrkeforhold) x etapetypens tab (kalibreret mod
// motorens egne etaper). En rytter der fremskrevet kan staa foran holdets klassementsrytter ved
// loebets slutning, er en trussel, og forspringet holdes paa snor: hans afstand plus det
// fremskrevne tab (plus et lille tillaeg). Ufarlige udbrud (langt nede, eller med et stort
// fremskrevet tab paa bjergene) koerer som foer.
//
// REN: ingen IO, ingen rng.

import type { AbilityKey, Entrant, GcContext, ProfileType } from "../types.ts";
import { S5_V3_GC_LEASH_7258_TUNING } from "../tuning.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Summen af etapetypernes tab pr. evne-enhed for etaperne EFTER dagens (race_gc_stages). 0 uden etaper. */
export function remainingLossWeightSeconds(gc: GcContext | null | undefined): number {
  if (!gc || gc.status !== "standings" || !Array.isArray(gc.race_gc_stages)) return 0;
  const table = S5_V3_GC_LEASH_7258_TUNING.lossSecondsPerAbilityByProfile;
  let sum = 0;
  for (const s of gc.race_gc_stages) {
    if (!(Number(s.stage_number) > gc.stage_number)) continue;
    const w = Number(table[s.profile_type as ProfileType]);
    if (Number.isFinite(w) && w > 0) sum += w;
  }
  return sum;
}

/**
 * Det fremskrevne tidstab (sekunder, >= 0) paa resten af loebet for en rytter med
 * styrkeforholdet `strengthRatio` (hans loebsspecifikke klassementsevne / holdets
 * klassementsrytters). En staerkere rytter taber intet (0).
 */
export function projectedLossSeconds(gc: GcContext | null | undefined, strengthRatio: number): number {
  if (!Number.isFinite(strengthRatio)) return 0;
  const ratio = clamp(strengthRatio, S5_V3_GC_LEASH_7258_TUNING.minStrengthRatio, 1);
  return (1 - ratio) * remainingLossWeightSeconds(gc);
}

/**
 * Den fremskrevne tidsgevinst (sekunder, >= 0) paa resten af loebet for en staerkere rytter
 * (samme tabel, spejlet; styrkeforholdet hoejst 1 / minStrengthRatio). En svagere vinder intet.
 */
export function projectedGainSeconds(gc: GcContext | null | undefined, strengthRatio: number): number {
  if (!Number.isFinite(strengthRatio) || strengthRatio <= 1) return 0;
  const ratio = Math.min(strengthRatio, 1 / S5_V3_GC_LEASH_7258_TUNING.minStrengthRatio);
  return (ratio - 1) * remainingLossWeightSeconds(gc);
}

/**
 * Snoren jagten holder et udbrud paa, naar holdene kun reagerer paa fremskrevne trusler: det
 * mindste tolererede forspring, aldrig under projectedMinLeashSeconds (snoren brydes ikke; det
 * lille forspring er det feltet uanset giver). null uden tolerance.
 */
export function s5V3ProjectedControlTargetSeconds(toleratedSeconds: readonly (number | undefined)[]): number | null {
  const finite = toleratedSeconds.filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (finite.length === 0) return null;
  const floor = S5_V3_GC_LEASH_7258_TUNING.projectedMinLeashSeconds;
  return Math.max(Number.isFinite(floor) && floor > 0 ? floor : 0, Math.min(...finite));
}

/** Tillaegget paa snoren for en fremskrevet trussel (ugyldig tuning = 0). */
export function projectedAllowanceSeconds(): number {
  const a = S5_V3_GC_LEASH_7258_TUNING.projectedAllowanceSeconds;
  return Number.isFinite(a) && a > 0 ? a : 0;
}

/**
 * Den faelles fremskrivning: hver rytters forventede slutafstand (sekunder) = hans afstand i
 * klassementet plus det fremskrevne tab paa resten af loebet mod feltets bedste paa loebsspecifik
 * klassementsevne. Kun ryttere i stillingen og blandt `racingRiderIds`. Tom uden stilling eller evnemodel.
 */
export function projectedFinalGaps(input: {
  gc: GcContext | null | undefined;
  entrants: Readonly<Record<string, Entrant>>;
  racingRiderIds: ReadonlySet<string>;
  abilityOf: ((entrant: Entrant | undefined) => number) | null;
}): Map<string, number> {
  const out = new Map<string, number>();
  const gc = input.gc;
  if (!gc || gc.status !== "standings" || !input.abilityOf) return out;
  const rows = gc.standings.filter((s) => input.racingRiderIds.has(s.rider_id));
  let best = 0;
  for (const s of rows) best = Math.max(best, input.abilityOf(input.entrants[s.rider_id]));
  if (!(best > 0)) return out;
  for (const s of rows) out.set(s.rider_id, s.gap_seconds + projectedLossSeconds(gc, input.abilityOf(input.entrants[s.rider_id]) / best));
  return out;
}

/**
 * (B) Feltets `topN` bedste paa fremskrevet slutklassement (projectedFinalGaps). Fast raekkefoelge
 * (lige: rider_id). Ingen stilling, ingen evnemodel eller foerste etape (alle lige) = tom (de har
 * deres egen regel).
 */
export function projectedTopRiders(input: {
  gc: GcContext | null | undefined;
  entrants: Readonly<Record<string, Entrant>>;
  racingRiderIds: ReadonlySet<string>;
  abilityOf: ((entrant: Entrant | undefined) => number) | null;
  topN: number;
  syntheticFirstStage: boolean;
}): Set<string> {
  if (input.syntheticFirstStage || !(input.topN > 0)) return new Set();
  const projected = [...projectedFinalGaps(input)].map(([id, t]) => ({ id, t }));
  projected.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  return new Set(projected.slice(0, input.topN).map((p) => p.id));
}

type LeashField = { top: Set<string>; gaps: Map<string, number>; winner: number | null };
const FIELD_CACHE = new WeakMap<object, Map<string, LeashField>>();

/** Fremskrivningen for dagens felt (alle i stillingen der starter), gemt pr. startfelt og klassement. */
function leashField(gc: GcContext & { status: "standings" }, entrants: Readonly<Record<string, Entrant>>, abilityOf: ((entrant: Entrant | undefined) => number) | null, syntheticFirstStage: boolean, racingRiderIds?: ReadonlySet<string>): LeashField {
  // Kun ryttere der stadig koerer (Codex #7258: en udgaaet favorit maa ikke staa som fremskrevet vinder).
  const ids = gc.standings.map((s) => s.rider_id).filter((id) => entrants[id] !== undefined && (!racingRiderIds || racingRiderIds.has(id)));
  const key = `${gc.stage_number}:${gc.leader_id ?? ""}:${syntheticFirstStage ? 1 : 0}:${ids.join(",")}`;
  let byKey = FIELD_CACHE.get(entrants);
  if (!byKey) { byKey = new Map(); FIELD_CACHE.set(entrants, byKey); }
  let field = byKey.get(key);
  if (!field) {
    const racing = new Set(ids);
    const top = projectedGcFavourites({ gc, entrants, racingRiderIds: racing, abilityOf, topN: S5_V3_GC_LEASH_7258_TUNING.projectedContenderTopN, syntheticFirstStage });
    const gaps = projectedFinalGaps({ gc, entrants, racingRiderIds: racing, abilityOf });
    field = { top, gaps, winner: gaps.size > 0 ? Math.min(...gaps.values()) : null };
    byKey.set(key, field);
  }
  return field;
}

/**
 * Er holdets klassementsrytter en reel kandidat til at vinde loebet: blandt de
 * `projectedContenderTopN` bedste paa fremskrevet slutklassement (eller foereren)? Kun de hold
 * holder en fremskreven trussel paa snor: et udbrud der kun truer en 8.-plads afgoer ikke loebet.
 */
export function isProjectedContender(gc: GcContext | null | undefined, entrants: Readonly<Record<string, Entrant>>, riderId: string, abilityOf: ((entrant: Entrant | undefined) => number) | null, syntheticFirstStage: boolean, racingRiderIds?: ReadonlySet<string>): boolean {
  if (!gc || gc.status !== "standings") return false;
  if (gc.leader_id === riderId && !syntheticFirstStage) return true;
  if (!(S5_V3_GC_LEASH_7258_TUNING.projectedContenderTopN > 0)) return true;
  const top = leashField(gc, entrants, abilityOf, syntheticFirstStage, racingRiderIds).top;
  return top.size === 0 || top.has(riderId);
}

/**
 * Hvor langt (sekunder) en rytter fremskrevet ligger efter den fremskrevne vinder ved loebets
 * slutning (>= 0). Det er den afstand et udbrud med ham maa faa, foer han kan vinde LOEBET
 * (ikke blot passere et bestemt holds rytter). null uden fremskrivning eller uden rytteren.
 */
export function projectedGapToWinnerSeconds(gc: GcContext | null | undefined, entrants: Readonly<Record<string, Entrant>>, riderId: string, abilityOf: ((entrant: Entrant | undefined) => number) | null, syntheticFirstStage: boolean, racingRiderIds?: ReadonlySet<string>): number | null {
  if (!gc || gc.status !== "standings" || !abilityOf) return null;
  const field = leashField(gc, entrants, abilityOf, syntheticFirstStage, racingRiderIds);
  const own = field.gaps.get(riderId);
  if (own === undefined || field.winner === null) return null;
  return Math.max(0, own - field.winner);
}

/**
 * Den faelles fremskrivnings favoritter: feltets `topN` bedste paa fremskrevet slutklassement
 * (projectedTopRiders); paa det syntetiske foerste-etape-klassement (alle lige) de bedste paa
 * loebsspecifik klassementsevne. Samme funktion bruges af snoren (isProjectedContender) og af
 * testportens maaling (S4, tourScorecard), saa motor og maaling er enige om hvem der er farlig.
 */
export function projectedGcFavourites(input: {
  gc: GcContext | null | undefined;
  entrants: Readonly<Record<string, Entrant>>;
  racingRiderIds: ReadonlySet<string>;
  abilityOf: ((entrant: Entrant | undefined) => number) | null;
  topN: number;
  syntheticFirstStage: boolean;
}): Set<string> {
  const { gc, entrants, racingRiderIds, abilityOf, topN } = input;
  if (!gc || gc.status !== "standings" || !abilityOf || !(topN > 0)) return new Set();
  if (input.syntheticFirstStage) {
    const ids = gc.standings.map((s) => s.rider_id).filter((id) => racingRiderIds.has(id));
    return new Set(ids.sort((a, b) => abilityOf(entrants[b]) - abilityOf(entrants[a]) || a.localeCompare(b)).slice(0, topN));
  }
  return projectedTopRiders({ gc, entrants, racingRiderIds, abilityOf, topN, syntheticFirstStage: false });
}

/** (C) Rytterens evne paa dagens finale (sum af krav-vaegt x normaliseret evne), som gcThreat.routeAbility. */
function finaleAbility(entrant: Entrant | undefined, demand: Readonly<Partial<Record<AbilityKey, number>>>): number {
  const abilities = entrant?.abilities;
  if (!abilities) return 0;
  let sum = 0;
  for (const key of Object.keys(demand) as AbilityKey[]) {
    const w = Number(demand[key]) || 0;
    if (w > 0) sum += w * (clamp(Number(abilities[key]) || 0, 0, 99) / 99);
  }
  return sum;
}

/**
 * (C) Dagens favoritter: de `stageFavouriteTopN` bedste blandt `riderIds` paa dagens
 * finale-evne (finalens demand_vector). Fast raekkefoelge (lige evne: rider_id). Tom uden krav.
 */
export function stageFavourites(input: {
  riderIds: readonly string[];
  entrants: Readonly<Record<string, Entrant>>;
  demand: Readonly<Partial<Record<AbilityKey, number>>> | null | undefined;
}): Set<string> {
  const demand = input.demand;
  const n = S5_V3_GC_LEASH_7258_TUNING.stageFavouriteTopN;
  if (!demand || !(n > 0)) return new Set();
  const scored = input.riderIds.map((id) => ({ id, v: finaleAbility(input.entrants[id], demand) })).filter((x) => x.v > 0);
  scored.sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  return new Set(scored.slice(0, n).map((x) => x.id));
}

/** (C) Faktoren paa et spontant forsoeg fra en af dagens favoritter, i [0, 1] (ugyldig = 1). */
export function stageFavouriteSpontaneousScale(): number {
  const s = S5_V3_GC_LEASH_7258_TUNING.stageFavouriteSpontaneousScale;
  return Number.isFinite(s) && s >= 0 && s <= 1 ? s : 1;
}

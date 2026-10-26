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
 * (B) Feltets `topN` bedste paa fremskrevet slutklassement: afstand til foereren plus det
 * fremskrevne tab mod feltets bedste paa loebsspecifik klassementsevne. Kun ryttere i
 * stillingen og blandt `racingRiderIds`. Fast raekkefoelge (lige: rider_id). Ingen stilling,
 * ingen evnemodel eller foerste etape (alle lige) = tom (de har deres egen regel).
 */
export function projectedTopRiders(input: {
  gc: GcContext | null | undefined;
  entrants: Readonly<Record<string, Entrant>>;
  racingRiderIds: ReadonlySet<string>;
  abilityOf: ((entrant: Entrant | undefined) => number) | null;
  topN: number;
  syntheticFirstStage: boolean;
}): Set<string> {
  const out = new Set<string>();
  const gc = input.gc;
  if (!gc || gc.status !== "standings" || !input.abilityOf || input.syntheticFirstStage || !(input.topN > 0)) return out;
  const rows = gc.standings.filter((s) => input.racingRiderIds.has(s.rider_id));
  let best = 0;
  for (const s of rows) best = Math.max(best, input.abilityOf(input.entrants[s.rider_id]));
  if (!(best > 0)) return out;
  const projected = rows.map((s) => ({ id: s.rider_id, t: s.gap_seconds + projectedLossSeconds(gc, input.abilityOf!(input.entrants[s.rider_id]) / best) }));
  projected.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  for (const p of projected.slice(0, input.topN)) out.add(p.id);
  return out;
}

const CONTENDER_CACHE = new WeakMap<object, Map<string, Set<string>>>();

/**
 * Er holdets klassementsrytter en reel kandidat til at vinde loebet: blandt de
 * `projectedContenderTopN` bedste paa fremskrevet slutklassement (eller foereren)? Kun de hold
 * holder en fremskreven trussel paa snor: et udbrud der kun truer en 8.-plads afgoer ikke loebet.
 * Gemt pr. startfelt og klassement (samme svar hele etapen).
 */
export function isProjectedContender(gc: GcContext | null | undefined, entrants: Readonly<Record<string, Entrant>>, riderId: string, abilityOf: ((entrant: Entrant | undefined) => number) | null, syntheticFirstStage: boolean): boolean {
  if (!gc || gc.status !== "standings") return false;
  if (gc.leader_id === riderId && !syntheticFirstStage) return true;
  const topN = S5_V3_GC_LEASH_7258_TUNING.projectedContenderTopN;
  if (!(topN > 0)) return true;
  const key = `${gc.stage_number}:${gc.standings.length}:${gc.leader_id ?? ""}:${gc.standings[0]?.rider_id ?? ""}`;
  let byKey = CONTENDER_CACHE.get(entrants);
  if (!byKey) { byKey = new Map(); CONTENDER_CACHE.set(entrants, byKey); }
  let top = byKey.get(key);
  if (!top) {
    const racing = new Set(gc.standings.map((s) => s.rider_id).filter((id) => entrants[id] !== undefined));
    top = syntheticFirstStage && abilityOf
      // Foerste etape (alle lige): de bedste paa loebsspecifik klassementsevne.
      ? new Set([...racing].sort((a, b) => abilityOf(entrants[b]) - abilityOf(entrants[a]) || a.localeCompare(b)).slice(0, topN))
      : projectedTopRiders({ gc, entrants, racingRiderIds: racing, abilityOf, topN, syntheticFirstStage: false });
    byKey.set(key, top);
  }
  return top.size === 0 || top.has(riderId);
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

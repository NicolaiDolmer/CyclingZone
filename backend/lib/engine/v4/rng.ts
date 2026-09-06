// backend/lib/engine/v4/rng.ts
// Race Engine v4 F2 (#4030): seeded rng-fundament.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §3, §1 (renhed).
//
// REN kopi-implementering — INGEN import fra oevrigt backend (undgaar cyklisk
// import + bevarer renheds-graensen, jf. designdoc §1 "renhed"-raekken). Samme
// algoritme/kontrakt som backend/lib/raceSimulator.js:463 (stableSeed, FNV-1a)
// og backend/lib/fictionalRiderGenerator.js (makeRng = mulberry32, gaussian) —
// duplikeret bevidst, samme moenster som raceDayForm.js's lokale fnv1a32.

import type { RngFn, RngForFn } from "./types.ts";

/** FNV-1a 32-bit — samme algoritme/kontrakt som raceSimulator.stableSeed. */
export function stableSeed(str: string): number {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — samme algoritme/kontrakt som fictionalRiderGenerator.makeRng. */
export function mulberry32(seed: number): RngFn {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller — samme algoritme/kontrakt som fictionalRiderGenerator.gaussian. */
export function gaussian(rng: RngFn, mean: number, sd: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Navngiven rng-stream: dedikeret per (seed, mechanic[, riderId]) — mekanikker
 * deler ALDRIG rng-forbrug, og per-rytter-streams (riderId angivet) garanterer
 * determinisme-invarianten "én ekstra tilmelding flytter ikke andres udfald"
 * (§2 invariant 1): kun streams der reelt indekserer paa riderId kan paavirkes
 * af hvilke andre ryttere der findes i feltet, og selv de er upaavirkede af
 * REKKEFOELGEN andre ryttere behandles i (hashet er noeglet, ikke positions-baseret).
 */
export function rngFor(seed: string, mechanic: string, riderId?: string): RngFn {
  const key = riderId != null ? `${seed}:${mechanic}:${riderId}` : `${seed}:${mechanic}`;
  return mulberry32(stableSeed(key));
}

/**
 * Seed-bundet variant af rngFor — segmentLoop.ts/index.ts partial-applier
 * etapens seed én gang og giver mekanik-hooks en RngForFn (types.ts's
 * SegmentHookContext.rngFor), saa raa seed-strengen aldrig laekker til
 * mekanik-moduler der ikke skal kende den.
 */
export function boundRngFor(seed: string): RngForFn {
  return (mechanic: string, riderId?: string): RngFn => rngFor(seed, mechanic, riderId);
}

/**
 * Stream-nøglen for én mekanik på ét segment (#4886). Formen `<mekanik>:s<n>`
 * er den samme som `mechanics/incidents.ts` og `mechanics/cobbles.ts` selv
 * indførte 6/9 — den bor nu her, så konventionen kun findes ét sted.
 */
export function segmentStreamKey(mechanic: string, segmentIndex: number): string {
  return `${mechanic}:s${segmentIndex}`;
}

/**
 * Segment-nøglet indpakning af en etape-bundet `RngForFn` (#4886).
 *
 * KONTRAKT: `SegmentHookContext.rngFor` er ALTID segment-nøglet — segmentLoop
 * pakker etapens stream ind i denne før hvert hook-kald. Uden den er en stream
 * nøglet på (seed, mekanik, rider_id) alene, og en mekanik der kaldes PR.
 * SEGMENT får derfor den SAMME første lodtrækning på hvert eneste segment:
 * rytteren der ruller styrt på dagens første nedkørsel styrter på dem alle, og
 * selektions-støjen er identisk stigning for stigning. Fejlen blev fundet i
 * uheldsmodulet 6/9 (#2944/PR #4882) og gælder efter sin natur ENHVER mekanik
 * der kaldes pr. segment — derfor er nøglingen nu en default i kernen frem for
 * en disciplin hver mekanik skal huske.
 *
 * Per-rytter-hash-egenskaben er uberørt (§3 invariant 1): udfaldet afhænger
 * stadig kun af (seed, segment, mekanik, rider_id) — aldrig af hvem andre der
 * er med i feltet eller af hvilken rækkefølge rytterne behandles i.
 *
 * En mekanik der LEGITIMT skal have én etape-stabil stream — fordi dens
 * lodtrækning hører til et vejpunkt eller til målstregen og ikke må skifte hvis
 * rutens segmentinddeling ændres — bruger `SegmentHookContext.rngForStage` i
 * stedet, med en begrundelse på kaldstedet.
 */
export function segmentRngFor(rngForStage: RngForFn, segmentIndex: number): RngForFn {
  return (mechanic: string, riderId?: string): RngFn => rngForStage(segmentStreamKey(mechanic, segmentIndex), riderId);
}

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

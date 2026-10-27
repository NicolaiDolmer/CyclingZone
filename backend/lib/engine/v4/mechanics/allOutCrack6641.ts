// backend/lib/engine/v4/mechanics/allOutCrack6641.ts
// #6641/#7280 (SLUKKET bag effortCost.ALL_OUT_7280_ACTIVE, KUN s5_profiles_v3): Alt ud
// paa den afgoerende stigning efter ejerens design 27/10.
// Spec: docs/superpowers/specs/2026-10-27-6641-alt-ud-design.md.
//
//   1. Alle vinder tid, mest de staerke: gevinsten er et relativt tab der tages af
//      rytterens eget hul, vaegtet af evnen paa dagen (underskuddet til gruppens
//      bedste klatrer) og af reserven. Sekunderne foelger stigningens egen tid,
//      saa en lang, stejl stigning giver mere end en kort bakke (terraenet).
//   4. Med lav reserve kan rytteren knaekke: under en taerskel vokser risikoen,
//      seedet pr. rytter og segment (ingen Math.random). Knaekker han, saettes han
//      af og taber et ekstra relativt tab oven i sit hul.
//   5. Kun det motoren faktisk gjorde bliver til et event: sekunderne er forskellen
//      paa det hul motoren ville have givet ham uden alt ud og det han fik.
//
// Reserven er W'-andelen gange dagens friskhed (Entrant.condition): en traet rytter
// (traethed der hober sig op, conditionModelV2) har mindre at give af, vinder mindre
// og knaekker oftere. Det er sammenhaengen der goer flere alt ud-dage i traek dyre.
//
// REN: ingen IO, ingen Date, ingen Math.random. Konstanterne er balance (hard rule
// 17); maalinger kun i balance-internals/.

import type { AllOut7280Tuning } from "./effortCost.ts";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Reserven alt ud regner med (0-1): dagens friskhed x (W'-andelen vaegtet med
 * `wprimeWeight`). En frisk rytter paa kanten af feltet har stadig noget at give af;
 * en traet rytter med tom W' har intet.
 */
export function allOutReserve01(wprime: number, wprimeMax: number, condition: number, wprimeWeight = 1): number {
  const w = wprimeMax > 0 && Number.isFinite(wprime) ? clamp(wprime / wprimeMax, 0, 1) : 0;
  const c = Number.isFinite(condition) ? clamp(condition, 0, 1) : 1;
  const k = Number.isFinite(wprimeWeight) ? clamp(wprimeWeight, 0, 1) : 1;
  return c * (1 - k + k * w);
}

/** Evne-vaegten (0-1): 1 for gruppens bedste klatrer, faldende med underskuddet. */
export function allOutLevel01(deficit01: number, levelPower: number): number {
  const d = Number.isFinite(deficit01) ? clamp(deficit01, 0, 1) : 1;
  return Math.pow(1 - d, Math.max(0, levelPower));
}

/** Det relative tab alt ud tager af hullet (>= 0). Tom reserve = ingen gevinst. */
export function allOutGainLoss(deficit01: number, reserve01: number, t: Pick<AllOut7280Tuning, "gainLoss" | "levelPower">): number {
  const r = Number.isFinite(reserve01) ? clamp(reserve01, 0, 1) : 0;
  return Math.max(0, t.gainLoss) * allOutLevel01(deficit01, t.levelPower) * r;
}

/**
 * Risikoen for at knaekke over HELE den afgoerende stigning (0-1): 0 over taersklen,
 * voksende (kvadratisk) mod crackMaxProbability ved tom reserve.
 */
export function allOutCrackProbability(reserve01: number, t: Pick<AllOut7280Tuning, "crackReserve" | "crackMaxProbability">): number {
  const r = Number.isFinite(reserve01) ? clamp(reserve01, 0, 1) : 0;
  const threshold = clamp(t.crackReserve, 0, 1);
  if (!(threshold > 0) || r >= threshold) return 0;
  const x = (threshold - r) / threshold;
  return clamp(t.crackMaxProbability, 0, 1) * x * x;
}

/**
 * Risikoen paa ét segment, saa summen over stigningens segmenter er stigningens risiko
 * uanset hvordan den er delt op: 1 - (1 - p)^(segmentets andel af laengden).
 */
export function segmentCrackProbability(blockProbability: number, segmentShare01: number): number {
  const p = clamp(Number.isFinite(blockProbability) ? blockProbability : 0, 0, 1);
  const s = clamp(Number.isFinite(segmentShare01) ? segmentShare01 : 1, 0, 1);
  if (p <= 0 || s <= 0) return 0;
  return 1 - Math.pow(1 - p, s);
}

/** Den sammenhaengende stigningsblok segmentet ligger i: [start, end] (indekser). */
export function climbBlockOf(segments: ReadonlyArray<{ kind: string; from_km: number; to_km: number }>, index: number): { start: number; end: number; lengthKm: number } | null {
  if (!segments[index] || segments[index].kind !== "climb") return null;
  let start = index;
  while (start > 0 && segments[start - 1].kind === "climb") start--;
  let end = index;
  while (end + 1 < segments.length && segments[end + 1].kind === "climb") end++;
  let lengthKm = 0;
  for (let i = start; i <= end; i++) lengthKm += Math.max(0, segments[i].to_km - segments[i].from_km);
  return { start, end, lengthKm };
}

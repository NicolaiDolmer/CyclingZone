// backend/lib/engine/v4/mechanics/abandons.ts
// #6938 (KUN s5_profiles_v3, slukket): flere udgaaede. Ejer 15/10 "Der er ikke
// nok ryttere der udgaar fra loeb. - Det bliver haevet."
// Spec: docs/superpowers/specs/2026-10-23-6804-v3-tilvalg-design.md §2.2
// (U1 ikke-start mellem etaper, U3 hjaelper stiger af i endagsloeb; U2 styrt
// pr. terraen bor i mechanics/incidents.ts). Regler i klartekst:
// docs/RACE_ENGINE_RULES.md "Udgaaede under s5_profiles_v3".
//
// REN: ingen IO/Date/Math.random, intet input muteres. Lodtraekningerne er
// seedede pr. (etape-seed, mekanik, rider_id), saa udfaldet afhaenger kun af
// rytteren selv og ikke af hvem andre der starter.
//
// Ingen af de to veje giver skade eller straf: rytteren er bare ude af loebet
// (status "abandoned"). Skadedage kommer stadig KUN fra et styrt (#4520).
//
// Tallene er startgaet og kalibreres mod G17's private baand (balance-internals/
// 6804-tilvalg/, hard rule 17). Maalefunktionen er backend/scripts/dev/lib/
// motorTestportReport.mjs abandonGateG17.

import type { Entrant, GcContext, ProfileType, StageIncident, StageResult } from "../types.ts";
import { rngFor } from "../rng.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── U1: ikke-start mellem etaper ─────────────────────────────────────────────

export type NonStartTuning = Readonly<{
  fatigueFloor: number;
  maxPerStage: number;
  formWeight: number;
  formFactorRange: readonly [number, number];
  longRaceStages: number;
  minLengthFactor: number;
  afterProfileFactor: Readonly<Partial<Record<ProfileType, number>>>;
  captainFactor: number;
  maxFieldShare: number;
}>;

export const NON_START_V3_TUNING: NonStartTuning = Object.freeze({
  // Traethed (1 - condition, 0-1) under gulvet giver ingen risiko. Over gulvet
  // stiger risikoen kvadratisk op til maxPerStage ved fuld traethed.
  fatigueFloor: 0.3,
  maxPerStage: 0.08,
  // Formen (0-100, 50 = neutral): lav form haever risikoen, hoej saenker den.
  formWeight: 0.8,
  formFactorRange: Object.freeze([0.4, 1.8]) as readonly [number, number],
  // "Hoejest i lange loeb": loebets laengde i etaper mod en Grand Tour.
  longRaceStages: 21,
  minLengthFactor: 0.35,
  // "...og efter bjergetaper": faktor efter gaarsdagens profil.
  afterProfileFactor: Object.freeze({ high_mountain: 1.6, mountain: 1.6, medium_mountain: 1.25 }) as Readonly<
    Partial<Record<ProfileType, number>>
  >,
  // G17: kaptajner udgaar ikke oftere end hjaelpere. En kaptajn koerer sjaeldent
  // sig selv i stykker for andre, saa hans risiko daempes.
  captainFactor: 0.5,
  // Haardt loft pr. etape (andel af startlisten), samme princip som M10's loft.
  maxFieldShare: 0.05,
});

/** Etapeloebets laengde og gaarsdagens profil, laest af GC-konteksten. null = ikke en etape efter den foerste. */
export type NonStartRaceContext = {
  stageNumber: number;
  totalStages: number;
  previousProfile: ProfileType | null;
};

/**
 * U1 gaelder kun i et etapeloeb fra etape 2: GC-konteksten skal vaere et
 * rigtigt klassement (ikke foerste etape, ikke endagsloeb, ikke manglende data).
 */
export function nonStartRaceContext(gc: GcContext | null | undefined): NonStartRaceContext | null {
  if (!gc || gc.status !== "standings") return null;
  if ((gc as { first_stage?: boolean }).first_stage === true) return null;
  const stageNumber = Math.floor(Number(gc.stage_number));
  if (!Number.isFinite(stageNumber) || stageNumber < 2) return null;
  const stages = gc.race_gc_stages ?? [];
  const lastKnown = stages.reduce((m, s) => Math.max(m, Number(s.stage_number) || 0), 0);
  const remaining = Number(gc.stages_remaining);
  const totalStages = Math.max(stageNumber, lastKnown, Number.isFinite(remaining) ? stageNumber + remaining : 0);
  const previous = stages.find((s) => Number(s.stage_number) === stageNumber - 1);
  return { stageNumber, totalStages, previousProfile: (previous?.profile_type as ProfileType | undefined) ?? null };
}

/**
 * U1: sandsynligheden for at én rytter ikke starter dagens etape. REN.
 * Monoton: mere traethed eller lavere form giver aldrig mindre risiko.
 */
export function nonStartProbability(
  entrant: Pick<Entrant, "condition" | "form" | "role">,
  race: NonStartRaceContext,
  tuning: NonStartTuning = NON_START_V3_TUNING,
): number {
  const condition = Number(entrant.condition);
  const fatigue = clamp(1 - (Number.isFinite(condition) ? condition : 1), 0, 1);
  if (fatigue <= tuning.fatigueFloor) return 0;
  const excess = (fatigue - tuning.fatigueFloor) / (1 - tuning.fatigueFloor);
  const form = Number(entrant.form);
  const formValue = Number.isFinite(form) ? clamp(form, 0, 100) : 50;
  const formFactor = clamp(1 + (tuning.formWeight * (50 - formValue)) / 50, tuning.formFactorRange[0], tuning.formFactorRange[1]);
  const lengthFactor = clamp(race.totalStages / tuning.longRaceStages, tuning.minLengthFactor, 1);
  const afterFactor = (race.previousProfile && tuning.afterProfileFactor[race.previousProfile]) || 1;
  const roleFactor = entrant.role === "captain" || entrant.role === "sprint_captain" ? tuning.captainFactor : 1;
  return clamp(tuning.maxPerStage * excess * excess * formFactor * lengthFactor * afterFactor * roleFactor, 0, 1);
}

/**
 * U1: hvem starter ikke i dag? Seedet pr. rytter (mekanik "non_start"). Loftet
 * beholder de mest afgoerende lodtraekninger (laveste u/p), saa udfaldet ikke
 * afhaenger af startlistens raekkefoelge. Mindst to ryttere starter altid.
 */
export function rollNonStarters(
  startlist: readonly Entrant[],
  gc: GcContext | null | undefined,
  seed: string,
  tuning: NonStartTuning = NON_START_V3_TUNING,
): string[] {
  const race = nonStartRaceContext(gc);
  if (!race) return [];
  const hits: Array<{ riderId: string; score: number }> = [];
  for (const entrant of startlist) {
    const p = nonStartProbability(entrant, race, tuning);
    if (p <= 0) continue;
    const u = rngFor(seed, "non_start", entrant.rider_id)();
    if (u < p) hits.push({ riderId: entrant.rider_id, score: u / p });
  }
  const cap = Math.min(Math.ceil(tuning.maxFieldShare * startlist.length), Math.max(0, startlist.length - 2));
  return hits
    .sort((a, b) => a.score - b.score || a.riderId.localeCompare(b.riderId))
    .slice(0, cap)
    .map((h) => h.riderId)
    .sort((a, b) => a.localeCompare(b));
}

/** U1-protokollen: én "illness"-udgaaelse ved km 0 pr. ikke-starter. Ingen skade. */
export function nonStartIncidents(riderIds: readonly string[]): StageIncident[] {
  return riderIds.map((riderId) => ({
    rider_id: riderId,
    km: 0,
    kind: "illness" as const,
    severity: null,
    outcome: "abandoned" as const,
    time_loss_seconds: null,
    injury_days: null,
    helper_assist: false,
  }));
}

/**
 * U1: ikke-starterne laegges sidst i resultatlisten som "abandoned" (resultatet
 * forbliver en komplet permutation af startlisten). Tiden er en repraesentation
 * af "ingen maaltid", som M10's udgaaede (abandonedGapSeconds over den sidste).
 */
export function appendNonStarterResults(
  results: readonly StageResult[],
  riderIds: readonly string[],
  abandonedGapSeconds: number,
): StageResult[] {
  if (riderIds.length === 0) return [...results];
  const lastTime = results.reduce((m, r) => Math.max(m, Number(r.time_seconds) || 0), 0);
  const appended: StageResult[] = riderIds.map((riderId, i) => ({
    rider_id: riderId,
    rank: results.length + i + 1,
    time_seconds: round2(lastTime + abandonedGapSeconds),
    group_id: "non_start",
    status: "abandoned",
    injury_days: null,
  }));
  return [...results, ...appended];
}

// ── U3: hjaelperen stiger af i et endagsloeb ─────────────────────────────────

export type HelperWithdrawalTuning = Readonly<{
  minGapSeconds: number;
  fullGapSeconds: number;
  maxShare: number;
  roles: readonly string[];
}>;

export const HELPER_WITHDRAWAL_V3_TUNING: HelperWithdrawalTuning = Object.freeze({
  // En hjaelper der kommer i maal mere end minGapSeconds efter vinderen, er sat
  // og har ingen opgave tilbage. Risikoen stiger lineaert fra 0 op til maxShare
  // ved fullGapSeconds.
  minGapSeconds: 180,
  fullGapSeconds: 600,
  maxShare: 0.7,
  roles: Object.freeze(["helper"]) as readonly string[],
});

/** U3: sandsynligheden for at en sat hjaelper stiger af. REN, monoton i gabet. */
export function helperWithdrawalProbability(
  gapSeconds: number,
  tuning: HelperWithdrawalTuning = HELPER_WITHDRAWAL_V3_TUNING,
): number {
  const gap = Number(gapSeconds);
  if (!Number.isFinite(gap) || gap <= tuning.minGapSeconds) return 0;
  const span = Math.max(1, tuning.fullGapSeconds - tuning.minGapSeconds);
  return clamp(tuning.maxShare * ((gap - tuning.minGapSeconds) / span), 0, tuning.maxShare);
}

/**
 * U3 (KUN endagsloeb): sat hjaelpere stiger af. Kun ryttere der stadig er
 * "finished" efter tidsgraensen; vinderens tid er referencen. De udgaaede
 * flyttes sidst (efter alle der gennemfoerte, som M10's udgaaede) og
 * placeringerne nummereres om. Ingen skade, ingen straf.
 */
export function applyHelperWithdrawals(
  results: readonly StageResult[],
  entrants: readonly Entrant[],
  options: { seed: string; distanceKm: number; gc: GcContext | null | undefined; tuning?: HelperWithdrawalTuning },
): { results: StageResult[]; incidents: StageIncident[] } {
  const tuning = options.tuning ?? HELPER_WITHDRAWAL_V3_TUNING;
  if (options.gc?.status !== "one_day" || results.length === 0) return { results: [...results], incidents: [] };
  const roleByRider = new Map(entrants.map((e) => [e.rider_id, e.role as string]));
  const winnerTime = Number(results.find((r) => r.status === "finished")?.time_seconds);
  if (!Number.isFinite(winnerTime)) return { results: [...results], incidents: [] };
  const withdrawn = new Set<string>();
  for (const r of results) {
    if (r.status !== "finished") continue;
    if (!tuning.roles.includes(roleByRider.get(r.rider_id) ?? "")) continue;
    const p = helperWithdrawalProbability(r.time_seconds - winnerTime, tuning);
    if (p <= 0) continue;
    if (rngFor(options.seed, "helper_withdrawal", r.rider_id)() < p) withdrawn.add(r.rider_id);
  }
  if (withdrawn.size === 0) return { results: [...results], incidents: [] };
  const kept = results.filter((r) => !withdrawn.has(r.rider_id));
  const out = results.filter((r) => withdrawn.has(r.rider_id)).map((r) => ({ ...r, status: "abandoned" as const }));
  const reordered = [...kept, ...out].map((r, index) => ({ ...r, rank: index + 1 }));
  const km = round2(Math.max(0, Number(options.distanceKm) || 0));
  const incidents: StageIncident[] = [...withdrawn].sort((a, b) => a.localeCompare(b)).map((riderId) => ({
    rider_id: riderId,
    km,
    kind: "withdrawal" as const,
    severity: null,
    outcome: "abandoned" as const,
    time_loss_seconds: null,
    injury_days: null,
    helper_assist: false,
  }));
  return { results: reordered, incidents };
}

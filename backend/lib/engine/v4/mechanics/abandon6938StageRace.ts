// backend/lib/engine/v4/mechanics/abandon6938StageRace.ts
// #6938 U4 (KUN s5_profiles_v3, slukket): en slidt og sat hjaelper stiger af i et
// etapeloeb. Spec: docs/superpowers/specs/2026-10-23-6804-v3-tilvalg-design.md §2.2
// (G17: udgaaede pr. loebsgruppe; kaptajner udgaar ikke oftere end hjaelpere).
//
// HVORFOR. Testporten 25/10 (s5_profiles_v3, traethed mellem etaperne) viste at
// motorens veje ud (styrt, tidsgraensen, sygdom) kun tager en lille brøkdel af
// feltet i etapeloeb, og at de rammer kaptajnerne (isaer spurtkaptajnerne paa
// bjergetaperne) mindst lige saa haardt som hjaelperne. I virkeligheden er det
// hjaelperne der staar af: de har lavet arbejdet, er slidte, og naar de ruller
// ind langt efter paa en haard etape uden en opgave tilbage, stiger de af.
//
// REGLEN (pr. etape, efter tidsgraensen, samme kaldssted som U3):
//   - kun i etapeloeb (klassementskonteksten er et klassement eller etape 1),
//   - kun ryttere uden kaptajnrolle (hjaelper, jaeger, fri rolle),
//   - kun en rytter der kom i maal langt efter vinderen (sat), og ikke en rytter
//     der ligger fremme i klassementet,
//   - risikoen stiger med hullet og med slidet (rytterens dag-til-dag-tilstand),
//     og har et loft pr. etape.
// Ingen skade og ingen straf: rytteren er bare ude af loebet ("abandoned",
// incident-art "withdrawal", som U3). Kaptajnernes veje ud er uaendrede.
//
// REN: ingen IO/Date/Math.random, intet input muteres. Lodtraekningen er seedet
// pr. (etape-seed, mekanik, rider_id), saa udfaldet kun afhaenger af rytteren selv.
//
// Tallene er kalibreret mod G17's private baand (balance-internals/6938/, hard
// rule 17); her staar kun startvaerdierne for formen.

import type { Entrant, GcContext, StageIncident, StageResult } from "../types.ts";
import { rngFor } from "../rng.ts";

export type StageRaceWithdrawalTuning = Readonly<{
  /** Hul til vinderen (sekunder) hvor risikoen begynder. */
  minGapSeconds: number;
  /** Hul hvor hulfaktoren er fuld. */
  fullGapSeconds: number;
  /** Risiko ved fuldt hul for en udhvilet rytter. */
  baseShare: number;
  /** Ekstra risiko ved fuldt hul pr. slid (1 - tilstand, 0..1). */
  wearShare: number;
  /** Loft pr. etape. */
  maxShare: number;
  /** Loebslaengden (etaper) hvor laengdefaktoren er fuld; laengere loeb deler med laengden. */
  refStages: number;
  /** Ryttere i klassementets top N staar ikke af (de koerer for noget). */
  gcProtectedTop: number;
  roles: readonly string[];
}>;

export const STAGE_RACE_WITHDRAWAL_V3_TUNING: StageRaceWithdrawalTuning = Object.freeze({
  minGapSeconds: 420,
  refStages: 5,
  fullGapSeconds: 1500,
  baseShare: 0.22,
  wearShare: 0.3,
  maxShare: 0.3,
  gcProtectedTop: 25,
  roles: Object.freeze(["helper", "hunter", "free_role"]) as readonly string[],
});

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Slidet 0..1 ud fra tilstanden (1 = udhvilet). Manglende tilstand = udhvilet. */
export function wearOf(condition: unknown): number {
  const c = Number(condition);
  return Number.isFinite(c) ? clamp(1 - c, 0, 1) : 0;
}

/** U4: sandsynligheden for at en sat, slidt rytter uden kaptajnrolle stiger af. REN, monoton i hul og slid. */
export function stageRaceWithdrawalProbability(
  gapSeconds: number,
  wear: number,
  tuning: StageRaceWithdrawalTuning = STAGE_RACE_WITHDRAWAL_V3_TUNING,
): number {
  const gap = Number(gapSeconds);
  if (!Number.isFinite(gap) || gap <= tuning.minGapSeconds) return 0;
  const span = Math.max(1, tuning.fullGapSeconds - tuning.minGapSeconds);
  const gapFactor = clamp((gap - tuning.minGapSeconds) / span, 0, 1);
  const w = clamp(Number(wear) || 0, 0, 1);
  return clamp(gapFactor * (tuning.baseShare + tuning.wearShare * w), 0, tuning.maxShare);
}

/**
 * Laengdefaktoren 0..1: i et langt etapeloeb er hjaelperen kommet for at koere det
 * hele og holder ud gennem flere sate dage; i et ugeloeb staar han lettere af.
 * Ukendt laengde = fuld faktor. REN.
 */
export function raceLengthFactor(gc: GcContext | null | undefined, tuning: StageRaceWithdrawalTuning = STAGE_RACE_WITHDRAWAL_V3_TUNING): number {
  if (gc?.status !== "standings") return 1;
  const total = Number(gc.stage_number) + Number(gc.stages_remaining);
  if (!Number.isFinite(total) || total <= 0) return 1;
  return clamp(tuning.refStages / total, 0, 1);
}

/** Er konteksten et etapeloeb (klassement eller etape 1)? */
export function isStageRaceContext(gc: GcContext | null | undefined): boolean {
  return gc?.status === "standings" || gc?.status === "first_stage";
}

/**
 * U4 (KUN etapeloeb): slidte, sate ryttere uden kaptajnrolle stiger af. Samme form
 * som U3 (abandons.ts applyHelperWithdrawals): de udgaaede flyttes sidst og
 * placeringerne nummereres om. Ingen skade, ingen straf.
 */
export function applyStageRaceWithdrawals(
  results: readonly StageResult[],
  entrants: readonly Entrant[],
  options: { seed: string; distanceKm: number; gc: GcContext | null | undefined; tuning?: StageRaceWithdrawalTuning },
): { results: StageResult[]; incidents: StageIncident[] } {
  const tuning = options.tuning ?? STAGE_RACE_WITHDRAWAL_V3_TUNING;
  if (!isStageRaceContext(options.gc) || results.length === 0) return { results: [...results], incidents: [] };
  const byRider = new Map(entrants.map((e) => [e.rider_id, e]));
  const winnerTime = Number(results.find((r) => r.status === "finished")?.time_seconds);
  if (!Number.isFinite(winnerTime)) return { results: [...results], incidents: [] };
  const gc = options.gc;
  const gcRank = new Map<string, number>();
  if (gc?.status === "standings" && (gc as { first_stage?: boolean }).first_stage !== true) {
    for (const s of gc.standings) gcRank.set(s.rider_id, s.rank);
  }
  const lengthFactor = raceLengthFactor(gc, tuning);
  const withdrawn = new Set<string>();
  for (const r of results) {
    if (r.status !== "finished") continue;
    const entrant = byRider.get(r.rider_id);
    if (!entrant || !tuning.roles.includes(entrant.role as string)) continue;
    const rank = gcRank.get(r.rider_id);
    if (rank !== undefined && rank <= tuning.gcProtectedTop) continue;
    const p = lengthFactor * stageRaceWithdrawalProbability(r.time_seconds - winnerTime, wearOf(entrant.condition), tuning);
    if (p <= 0) continue;
    if (rngFor(options.seed, "stage_race_withdrawal", r.rider_id)() < p) withdrawn.add(r.rider_id);
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

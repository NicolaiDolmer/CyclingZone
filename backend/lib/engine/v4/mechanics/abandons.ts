// backend/lib/engine/v4/mechanics/abandons.ts
// #6938 (KUN s5_profiles_v3, slukket): flere udgaaede. Ejer 15/10 "Der er ikke
// nok ryttere der udgaar fra loeb. - Det bliver haevet."
// Spec: docs/superpowers/specs/2026-10-23-6804-v3-tilvalg-design.md §2.2
// (U3 hjaelper stiger af i endagsloeb; U2 styrt pr. terraen bor i
// mechanics/incidents.ts). U1 "ikke-start af traethed" er erstattet af sygdom af
// langvarig ekstrem traethed (ejer 24/10), som bygges i sin egen PR. Regler i klartekst:
// docs/RACE_ENGINE_RULES.md "Udgaaede under s5_profiles_v3".
//
// REN: ingen IO/Date/Math.random, intet input muteres. Lodtraekningerne er
// seedede pr. (etape-seed, mekanik, rider_id), saa udfaldet afhaenger kun af
// rytteren selv og ikke af hvem andre der starter.
//
// Ingen af vejene giver skade eller straf: rytteren er bare ude af loebet
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

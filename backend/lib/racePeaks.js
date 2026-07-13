// Race Engine v3 (#2224), slice S5 — form-peaks som spillerens våben.
// Spec: docs/superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md (§10)
//   + docs/superpowers/specs/2026-07-13-s5-peak-planner-cockpit-addendum.md (§2).
//
// Ren lib (samme kontrakt som raceRoles/raceDayForm/raceIncidents): ingen
// DB/fs/Math.random/Date. DETERMINISTISK FRA DATA (peak-vindue + træningskvalitet),
// IKKE fra seed — en peak er en spillervalgt, forklarlig effekt, ikke en tilfældig
// varians-kilde. Den impure orkestrering (backend/lib/raceRunner.js) resolver pr.
// rytter: aktive peak-planer (window_start/end) + traeningskvalitet, og sender de
// FÆRDIGE inputs herind — præcis som raceSimulator kalder dayFormComponent med
// allerede-resolvede (riderId, stageSeed). Kaldes KUN når v3=true (flag-off →
// peak=0 → bit-identisk).
//
// Enheds-agnostisk: stageDay/window.start/window.end + paybackDays skal blot være
// SAMME sammenlignelige dag-enhed (fx dags-indeks / days-since-epoch). Kalenderen
// mapper game-day→ISO-dato server-side; raceRunner konverterer til dag-indeks.
//
// Alle balance-konstanter bor i RACE_V3_TUNING (raceRoles.js) — én tunings-flade.

import { RACE_V3_TUNING } from "./raceRoles.js";

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// Signal ∈ [0,1] med default når det mangler/er ugyldigt (koblingen skal betyde
// noget: fravær = neutral 0.5, ikke gratis 1 — undtagen sundhed, hvor "ingen
// skade-data" rimeligt = rask = 1).
function signal01(v, dflt) {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return dflt;
  return clamp(n, 0, 1);
}

/**
 * Klassificér én etape-dag mod ét peak-vindue.
 * @returns {"peak"|"payback"|"none"}
 */
export function peakPhaseForWindow(stageDay, windowStart, windowEnd, paybackDays) {
  const d = Number(stageDay);
  if (!Number.isFinite(d)) return "none";
  if (d >= windowStart && d <= windowEnd) return "peak";
  if (d > windowEnd && d <= windowEnd + paybackDays) return "payback";
  return "none";
}

/**
 * Reducér flere peak-vinduer → den dominerende fase for etapen. "peak" vinder
 * over "payback" (er du aktivt i et vindue, mærkes formhullet fra et andet ikke).
 * @param {number} stageDay
 * @param {Array<{start:number,end:number}>} windows
 * @param {number} [paybackDays]
 * @returns {"peak"|"payback"|"none"}
 */
export function resolvePeakPhase(stageDay, windows, paybackDays = RACE_V3_TUNING.PEAK_PAYBACK_DAYS) {
  let phase = "none";
  for (const w of windows || []) {
    if (!w || w.start == null || w.end == null) continue;
    const p = peakPhaseForWindow(stageDay, w.start, w.end, paybackDays);
    if (p === "peak") return "peak";
    if (p === "payback") phase = "payback";
  }
  return phase;
}

/**
 * Traeningskvalitet ∈ [PEAK_TQ_FLOOR, 1] fra optakts-signaler (addendum §2).
 * Ren vægtning; præcise vægte + gulv tunes i harnesset. Manglende signaler →
 * neutrale defaults (sundhed 1, resten 0.5).
 *
 * @param {{consistency?:number, focusMatch?:number, health?:number, fatigueControl?:number}} signals
 * @param {object} [tuning=RACE_V3_TUNING]
 * @returns {number}
 */
export function computeTrainingQuality(signals = {}, tuning = RACE_V3_TUNING) {
  const w = tuning.PEAK_TQ_WEIGHTS;
  const total = w.consistency + w.focusMatch + w.health + w.fatigue;
  if (!(total > 0)) return 1;
  const raw = (
    signal01(signals.consistency, 0.5) * w.consistency +
    signal01(signals.focusMatch, 0.5) * w.focusMatch +
    signal01(signals.health, 1) * w.health +
    signal01(signals.fatigueControl, 0.5) * w.fatigue
  ) / total;
  return clamp(raw, tuning.PEAK_TQ_FLOOR, 1);
}

/**
 * Peak-score-komponent der adderes til finalScore (samme fortegns-konvention som
 * work_cost/jour_sans). REALISERET top = PEAK_MAX × traeningskvalitet (loft ×
 * hvor godt du trænede); payback = −PEAK_PAYBACK betalt fuldt uanset træning.
 *
 * @param {{phase:"peak"|"payback"|"none", trainingQuality?:number, tuning?:object}} args
 * @returns {number}
 */
export function peakScoreComponent({ phase, trainingQuality = 1, tuning = RACE_V3_TUNING } = {}) {
  if (phase === "peak") return tuning.PEAK_MAX * clamp(Number(trainingQuality) || 0, 0, 1);
  if (phase === "payback") return -tuning.PEAK_PAYBACK;
  return 0;
}

/**
 * Convenience: peak-komponent for en etape givet rytterens vinduer + allerede-
 * beregnede traeningskvalitet. Ingen vinduer → 0 (flag-off / ingen plan).
 *
 * @param {{stageDay:number, windows?:Array<{start:number,end:number}>, trainingQuality?:number, tuning?:object}} args
 * @returns {number}
 */
export function peakComponentForStage({ stageDay, windows, trainingQuality = 1, tuning = RACE_V3_TUNING } = {}) {
  const phase = resolvePeakPhase(stageDay, windows, tuning.PEAK_PAYBACK_DAYS);
  return peakScoreComponent({ phase, trainingQuality, tuning });
}

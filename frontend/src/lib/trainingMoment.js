// trainingMoment.js — curated daily story picker for the training check-in
// (#2484, addendum H3, quick win).
//
// The daily check-in used to show only a raw numbers table. This derives ONE
// curated story from the most recently completed training day instead — the
// same data trainingReport.js already exposes (breakthroughJumps, isBreakthrough,
// daySummary), just ranked and turned into a sentence.
//
// Deterministic on purpose: template "flavor" variant is a hash of
// (tick_date, rider_id, type), never Math.random/Date.now, so the same inputs
// always render the same sentence (stable screenshots, testable).
//
// Cooldown: avoids featuring the same rider or the same story TYPE two days
// running. Recomputes what the picker would have surfaced on the prior 1-2
// completed days directly from their stored report rows — no extra
// persistence needed, the daily reports already carry everything.
//
// Fog-gate (#1162): every story here is grounded in something that already
// happened (a gain) or a live, observable progress fraction toward the next
// point. NEVER phrase a story in ceiling/potential language — no "X's
// potential", no "close to his ceiling", no projected max.

import {
  isBreakthrough,
  breakthroughJumps,
  daySummary,
  focusProgress,
  PEAK_FORM_THRESHOLD,
  NEAR_BREAKTHROUGH,
} from "./trainingReport.js";

export const MOMENT_TYPES = {
  BREAKTHROUGH: "breakthrough",
  NEAR_BREAKTHROUGH: "nearBreakthrough",
  PEAK_FORM: "peakForm",
  SHARP_DAY: "sharpDay",
  QUIET: "quiet",
};

// How many template variants exist per story type (see training.json
// momentBreakthrough_0..3 etc.) — keep in sync with the locale files.
export const MOMENT_VARIANT_COUNT = 4;

// Stable small string hash for deterministic "flavor" variant selection.
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function variantIndex(seedParts, variantCount = MOMENT_VARIANT_COUNT) {
  if (!variantCount || variantCount <= 1) return 0;
  return hashSeed(seedParts.filter((p) => p != null).join("|")) % variantCount;
}

// Score bands are deliberately far apart so priority (breakthrough > near >
// peak form > sharp day) never flips on magnitude within a band.
function breakthroughCandidates(rows) {
  const out = [];
  for (const row of rows) {
    if (!isBreakthrough(row)) continue;
    const jumps = breakthroughJumps(row);
    if (jumps.length === 0) continue;
    // Feature the single biggest jump for the rider — cleanest one-line story.
    const best = jumps.reduce((a, b) => (b.n > a.n ? b : a), jumps[0]);
    out.push({
      type: MOMENT_TYPES.BREAKTHROUGH,
      riderId: row.rider_id,
      riderName: row.name,
      ability: best.ability,
      from: best.from,
      to: best.to,
      n: best.n,
      score: 1000 + best.n,
    });
  }
  return out;
}

function peakFormCandidates(rows) {
  const out = [];
  for (const row of rows) {
    const form = Number(row.form);
    if (!Number.isFinite(form) || form < PEAK_FORM_THRESHOLD) continue;
    out.push({
      type: MOMENT_TYPES.PEAK_FORM,
      riderId: row.rider_id,
      riderName: row.name,
      form,
      score: 200 + form,
    });
  }
  return out;
}

function sharpDayCandidates(rows) {
  const out = [];
  for (const row of rows) {
    if (row.status !== "over") continue;
    out.push({ type: MOMENT_TYPES.SHARP_DAY, riderId: row.rider_id, riderName: row.name, score: 100 });
  }
  return out;
}

// Best single candidate for ONE day's rows, ignoring cooldown. Used both to
// reconstruct what recent days would have featured (cooldown source) — never
// includes nearBreakthrough, which needs LIVE progress that isn't stored
// per day in the report row.
export function dayTopCandidate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const all = [...breakthroughCandidates(rows), ...peakFormCandidates(rows), ...sharpDayCandidates(rows)];
  if (all.length === 0) return null;
  all.sort((a, b) => b.score - a.score);
  return all[0];
}

// Live "closing in" candidates from CURRENT ability_progress (reflects state
// right after the latest tick, not a stored per-day snapshot). A rider who
// already broke through today is excluded — the breakthrough IS the story,
// not "nearing" it.
function nearBreakthroughCandidates(rows, progressByRider) {
  if (!progressByRider) return [];
  const out = [];
  for (const row of rows) {
    if (!row.focus || row.intensity === "rest" || row.injured) continue;
    if (isBreakthrough(row)) continue;
    const prog = focusProgress(row.focus, progressByRider[row.rider_id]);
    if (!prog || prog.pct < NEAR_BREAKTHROUGH * 100) continue;
    out.push({
      type: MOMENT_TYPES.NEAR_BREAKTHROUGH,
      riderId: row.rider_id,
      riderName: row.name,
      ability: prog.ability,
      pct: prog.pct,
      score: 500 + prog.pct,
    });
  }
  return out;
}

// Riders/types featured on recent days — cooldown source. pastRuns must
// already be newest-first and exclude the day being picked for.
export function recentSignature(pastRuns) {
  const riderIds = new Set();
  const types = new Set();
  for (const run of pastRuns ?? []) {
    const top = dayTopCandidate(run?.report?.riders);
    if (!top) continue;
    riderIds.add(top.riderId);
    types.add(top.type);
  }
  return { riderIds, types };
}

// Selects ONE moment for the check-in.
//   latestRun        : { tick_date, report: { riders } } — most recently
//                       completed training day (today's if already run,
//                       otherwise the last historical one)
//   progressByRider  : live ability_progress map (useTraining's `progress`),
//                       or null/undefined to skip the anticipation story
//   pastRuns         : runs strictly BEFORE latestRun, newest-first — used
//                       only for cooldown, never rendered
// Returns a moment object ({ type, riderId?, riderName?, ability?, ... ,
// variant }) or null when there is no report to feature at all.
export function selectTrainingMoment(latestRun, progressByRider, pastRuns) {
  const rows = latestRun?.report?.riders;
  const tickDate = latestRun?.tick_date ?? "";
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const candidates = [
    ...breakthroughCandidates(rows),
    ...nearBreakthroughCandidates(rows, progressByRider),
    ...peakFormCandidates(rows),
    ...sharpDayCandidates(rows),
  ];

  if (candidates.length === 0) {
    const summary = daySummary(rows);
    const allRest = summary.trained === 0 && summary.total > 0;
    return {
      type: MOMENT_TYPES.QUIET,
      allRest,
      trained: summary.trained,
      variant: variantIndex([tickDate, "quiet", allRest ? "rest" : "normal"]),
    };
  }

  candidates.sort((a, b) => b.score - a.score);

  const cooldown = recentSignature((pastRuns ?? []).slice(0, 2));
  const fresh = candidates.filter((c) => !cooldown.riderIds.has(c.riderId) && !cooldown.types.has(c.type));
  const pick = fresh[0] ?? candidates[0];

  const seed = [tickDate, pick.riderId ?? "", pick.type];
  return { ...pick, variant: variantIndex(seed) };
}

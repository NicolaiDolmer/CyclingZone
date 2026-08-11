// trainingReport.js — rene helpers til trænings-feedback-laget (#1305 polish, parent #1136).
//
// Afleder anticipation (progress mod næste +1) + payoff (gennembrud, dags-opsummering)
// fra useTraining-data. Ingen DB/React/Date — unit-testes isoleret med node --test.

import { TRAINING_FOCUS_ABILITIES } from "./training.js";

// Form-værdi (0-100) hvorved en rytter regnes "i topform" i dags-opsummeringen.
// Lille UI-konstant (form 50 = neutral start; >=70 = mærkbart skarp). Påvirker KUN
// opsummerings-tallet, aldrig trænings-matematikken.
export const PEAK_FORM_THRESHOLD = 70;

// Progress-fraktion hvor baren skifter til success-farve ("tæt på gennembrud").
export const NEAR_BREAKTHROUGH = 0.9;

// Fokus-evnens vej mod næste +1. Blandt fokussets evner vælges den TÆTTEST på
// gennembrud (højeste progress) — det er anticipation-momentet spilleren skal se.
//   focus            : fokus-nøgle (vo2max/threshold/...) eller null
//   progressForRider : { [ability]: 0..1 } (ability_progress fra useTraining) eller null
// Returnerer { ability, pct } (pct = 0..100 afrundet) eller null hvis intet fokus
// eller ingen progress-data for fokussets evner.
export function focusProgress(focus, progressForRider) {
  if (!focus || !progressForRider) return null;
  const abilities = TRAINING_FOCUS_ABILITIES[focus];
  if (!abilities) return null;
  let best = null;
  for (const ability of abilities) {
    const raw = progressForRider[ability];
    if (raw == null) continue;
    const frac = Number(raw);
    if (!Number.isFinite(frac)) continue;
    if (best == null || frac > best.frac) best = { ability, frac };
  }
  if (best == null) return null;
  const clamped = Math.max(0, Math.min(0.999, best.frac));
  return { ability: best.ability, pct: Math.round(clamped * 100) };
}

// #2578: er ALLE fokussets evner på livstidsloftet? Så er der intet at vinde i
// netop dette fokus, og progress-cellen skal vise "færdigudviklet" i stedet for
// en død/stillestående bar. cappedForRider er backend-leverede ability-NØGLER
// (aldrig tal — caps er server-hidden, #1162). Delvist cappet fokus (mindst én
// evne med headroom) → false: baren er stadig meningsfuld.
export function isFocusFullyCapped(focus, cappedForRider) {
  return focusCapState(focus, cappedForRider)?.state === "capped";
}

// #3639: hovedrum PR. EVNE i et fokus — ikke bare "er alt dødt".
//
// Rod-årsagen bag de tre spillerrapporter 10/8 ("klatring stiger ikke ved
// VO2max-træning"): et fokus træner FLERE evner (vo2max = climbing+punch+tempo),
// men hele fladen aggregerede fokusset til ÉT tal. focusProgress ovenfor vælger
// evnen TÆTTEST på gennembrud, så en rytter hvis climbing står på loftet, mens
// tempo stadig rykker, viser en sund bar med tempos tal. #2578's
// isFocusFullyCapped fangede kun det totale tilfælde (alle evner døde).
// Målt i prod 11/8 (spiller-ejede ryttere med plan i aktiv sæson): 117 ryttere
// helt døde — men 741 DELVIST døde uden noget signal, heraf 291 med præcis
// climbing på loftet i vo2max. 110 af 197 spillerhold var ramt.
//
// cappedForRider er backend-leverede ability-NØGLER (aldrig tal — caps er
// server-hidden, #1162), så denne funktion kan aldrig lække et loft.
//
// Returnerer null ved intet/ukendt fokus, ellers
//   { state: "open" | "partial" | "capped", capped: [ability], open: [ability] }
export function focusCapState(focus, cappedForRider) {
  if (!focus) return null;
  const abilities = TRAINING_FOCUS_ABILITIES[focus];
  if (!abilities?.length) return null;
  const set = new Set(Array.isArray(cappedForRider) ? cappedForRider : []);
  const cappedAbilities = abilities.filter((a) => set.has(a));
  const openAbilities = abilities.filter((a) => !set.has(a));
  const state = cappedAbilities.length === 0 ? "open" : openAbilities.length === 0 ? "capped" : "partial";
  return { state, capped: cappedAbilities, open: openAbilities };
}

// #2578: samlet antal hele point vundet i dagens kørsel for én rapport-række.
// Bruges til "+N i dag"-chippen på roster-rækken, så en progress-bar der netop
// har wrappet efter et gennembrud ikke fejllæses som "ingen fremgang".
export function todayGainTotal(reportRow) {
  const gains = reportRow?.gains;
  if (!gains) return 0;
  let total = 0;
  for (const n of Object.values(gains)) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) total += v;
  }
  return total;
}

// Et gennembrud = mindst én evne der steg (+1 eller mere) i dagens kørsel.
export function isBreakthrough(reportRow) {
  const gains = reportRow?.gains;
  if (!gains) return false;
  return Object.values(gains).some((n) => Number(n) > 0);
}

// Dags-opsummering på holdniveau fra rapportens rytter-rækker.
//   trained       = rækker med en aktiv (ikke-rest) session og ikke skadet
//   breakthroughs = antal rækker med mindst ét gennembrud
//   peakForm      = rækker med form >= PEAK_FORM_THRESHOLD
//   total         = antal rækker
export function daySummary(reportRiders) {
  const rows = reportRiders ?? [];
  let trained = 0;
  let breakthroughs = 0;
  let peakForm = 0;
  for (const row of rows) {
    if (!row.injured && row.intensity && row.intensity !== "rest") trained++;
    if (isBreakthrough(row)) breakthroughs++;
    if (Number(row.form) >= PEAK_FORM_THRESHOLD) peakForm++;
  }
  return { trained, breakthroughs, peakForm, total: rows.length };
}

// Gennembruds-spring pr. evne til visning "71 → 72". Bruger backend-berigelsen
// row.gains_detail = { [ability]: { from, to } } når den findes; ellers from/to=null
// så UI'et falder tilbage til "+n ability".
export function breakthroughJumps(reportRow) {
  const gains = reportRow?.gains ?? {};
  const detail = reportRow?.gains_detail ?? {};
  const out = [];
  for (const [ability, n] of Object.entries(gains)) {
    if (Number(n) <= 0) continue;
    const d = detail[ability];
    const from = d && Number.isFinite(Number(d.from)) ? Number(d.from) : null;
    const to = d && Number.isFinite(Number(d.to)) ? Number(d.to) : null;
    out.push({ ability, n: Number(n), from, to });
  }
  return out;
}

// Træningsrapport-historik for ÉN rytter (#1533). Plukker rytterens linje ud af
// hver dags report.riders og parrer den med dagens metadata, så rytterprofilen kan
// vise dag-for-dag-historikken uden at kende run-formen.
//   runs    : [{ tick_date, executed_by, bonus_applied, report: { riders: [...] } }]
//             (allerede sorteret nyeste-først af useTrainingHistory)
//   riderId : rytterens id
// Returnerer [{ tick_date, executed_by, bonus_applied, row }] — kun dage hvor
// rytteren faktisk indgik i kørslen (nye/solgte ryttere mangler på gamle dage).
export function riderHistoryFromRuns(runs, riderId) {
  if (!Array.isArray(runs) || !riderId) return [];
  const out = [];
  for (const run of runs) {
    const rows = run?.report?.riders;
    if (!Array.isArray(rows)) continue;
    const row = rows.find((r) => r && r.rider_id === riderId);
    if (!row) continue;
    out.push({
      tick_date: run.tick_date,
      executed_by: run.executed_by,
      bonus_applied: run.bonus_applied,
      row,
    });
  }
  return out;
}

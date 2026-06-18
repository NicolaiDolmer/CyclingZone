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

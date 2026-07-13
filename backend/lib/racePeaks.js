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

// ── Optakts-signaler → computeTrainingQuality (addendum §2) ───────────────────
// Rene funktioner: den impure loader (racePeakPlans.js) udtrækker rå tal fra DB
// (training_day_runs / rider_condition / race_stage_profiles) og fodrer dem herind.
// Hver returnerer ∈[0,1] ELLER undefined ("intet signal") → computeTrainingQuality's
// signal01 anvender så den neutrale default (sundhed 1, resten 0.5). At holde
// "manglende data" adskilt fra "målt 0" er pointen: en rytter uden træningshistorik
// straffes ikke som én der aktivt sprang hver dag over.

/**
 * Konsistens: andel af optakts-dage der faktisk blev trænet. leadupDays = hele
 * optaktsvinduet (PEAK_LEADUP_DAYS); trainedDays = dage med status != "rest".
 * @returns {number|undefined}
 */
export function consistencySignal(trainedDays, leadupDays) {
  if (!(leadupDays > 0)) return undefined;
  return clamp((Number(trainedDays) || 0) / leadupDays, 0, 1);
}

/**
 * Hvor stor en andel af et mål-løbs demand_vector et fokus' evner dækker (sum af
 * de efterspurgte vægte for netop de evner fokus træner). Ren lookup.
 * @param {string[]} focusAbilities  TRAINING_FOCUSES[focusKey]
 * @param {Record<string,number>} demandVector  race_stage_profiles.demand_vector (evne→vægt)
 * @returns {number}
 */
export function focusCoverage(focusAbilities, demandVector) {
  let s = 0;
  for (const a of focusAbilities || []) {
    const w = Number(demandVector?.[a]);
    if (Number.isFinite(w) && w > 0) s += w;
  }
  return s;
}

/**
 * Fokus-match ∈[0,1]: trænede rytteren evner relevante for MÅL-løbets profil?
 * Vægtet gennemsnit af pr.-dag-fokussets demand-dækning, normaliseret mod det
 * BEDST-matchende fokus for demand-vektoren (så 1 = trænede optimalt, 0 = trænede
 * noget løbet slet ikke efterspørger). Ingen trænede dage / ukendt demand → undefined.
 * @param {Record<string,number>} focusCounts  fokus-nøgle → antal trænede optakts-dage med det fokus
 * @param {Record<string,number>} demandVector
 * @param {Record<string,string[]>} focusAbilitiesMap  TRAINING_FOCUSES (injiceret; holder racePeaks decoupled fra training.js)
 * @returns {number|undefined}
 */
export function focusMatchSignal(focusCounts, demandVector, focusAbilitiesMap) {
  if (!demandVector || !focusAbilitiesMap) return undefined;
  let best = 0;
  for (const f of Object.keys(focusAbilitiesMap)) {
    best = Math.max(best, focusCoverage(focusAbilitiesMap[f], demandVector));
  }
  if (!(best > 0)) return undefined; // demand dækker ingen kendte fokus-evner → kan ikke bedømmes
  let weighted = 0, total = 0;
  for (const [f, n] of Object.entries(focusCounts || {})) {
    const c = Number(n) || 0;
    if (c <= 0 || !focusAbilitiesMap[f]) continue;
    weighted += focusCoverage(focusAbilitiesMap[f], demandVector) * c;
    total += c;
  }
  if (!(total > 0)) return undefined; // ingen trænede dage at bedømme fokus ud fra
  return clamp((weighted / total) / best, 0, 1);
}

/**
 * Sundhed ∈[0,1]: skade i optakten reducerer. injuredUntil (ordinal, skadens
 * slutdag) tolkes som at skaden løb fra optaktens start frem til den — vi kender
 * ikke skadens start, så det er en bevidst konservativ proxy (senere injuredUntil
 * = mere tabt optakt). Ingen skade / helet før optakt → 1. Ugyldigt vindue → undefined.
 * @param {{injuredUntil:number|null, leadupStart:number, leadupEnd:number}} args
 * @returns {number|undefined}
 */
export function healthSignal({ injuredUntil, leadupStart, leadupEnd } = {}) {
  if (!(leadupEnd > leadupStart)) return undefined;
  if (injuredUntil == null || !Number.isFinite(Number(injuredUntil))) return 1;
  const total = leadupEnd - leadupStart;
  const lostEnd = Math.min(leadupEnd, Number(injuredUntil) + 1); // injuredUntil-dagen selv er skadet
  const lost = Math.max(0, lostEnd - leadupStart);
  return clamp(1 - lost / total, 0, 1);
}

/**
 * Trætheds-styring ∈[0,1]: at ramme taper udhvilet = høj kvalitet (kernen i
 * periodisering). fatigue ∈[0,100] (rider_condition.fatigue). Lav fatigue → 1.
 * @param {number} fatigue
 * @returns {number|undefined}
 */
export function fatigueControlSignal(fatigue) {
  if (fatigue == null) return undefined;
  const f = Number(fatigue);
  if (!Number.isFinite(f)) return undefined;
  return clamp(1 - clamp(f, 0, 100) / 100, 0, 1);
}

/**
 * Saml de 4 optakts-signaler for ÉT peak-vindue → traeningskvalitet via
 * computeTrainingQuality. Rå kontekst udledes af den impure loader.
 * @param {object} ctx  { trainedDays, leadupDays, focusCounts, demandVector, focusAbilitiesMap, injuredUntil, leadupStart, leadupEnd, fatigue }
 * @param {object} [tuning=RACE_V3_TUNING]
 * @returns {number} traeningskvalitet ∈ [PEAK_TQ_FLOOR, 1]
 */
export function trainingQualityForWindow(ctx = {}, tuning = RACE_V3_TUNING) {
  return computeTrainingQuality({
    consistency: consistencySignal(ctx.trainedDays, ctx.leadupDays),
    focusMatch: focusMatchSignal(ctx.focusCounts, ctx.demandVector, ctx.focusAbilitiesMap),
    health: healthSignal({ injuredUntil: ctx.injuredUntil, leadupStart: ctx.leadupStart, leadupEnd: ctx.leadupEnd }),
    fatigueControl: fatigueControlSignal(ctx.fatigue),
  }, tuning);
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
 * Convenience: peak-komponent for en etape givet rytterens vinduer + deres
 * traeningskvalitet. traeningskvalitet er PR. VINDUE (addendum §2: tq(rytter,
 * optakts-vindue) — en rytter kan toppe godt for ét mål-løb og dårligt for et
 * andet), så det AKTIVE vindues egen `trainingQuality` bruges; mangler den (fx
 * motor-/flag-off-tests der sætter rytter-niveau-tq) falder vi tilbage til
 * `trainingQuality`-parameteren. Ingen vinduer → 0 (flag-off / ingen plan).
 *
 * @param {{stageDay:number, windows?:Array<{start:number,end:number,trainingQuality?:number}>, trainingQuality?:number, tuning?:object}} args
 * @returns {number}
 */
export function peakComponentForStage({ stageDay, windows, trainingQuality = 1, tuning = RACE_V3_TUNING } = {}) {
  const d = Number(stageDay);
  if (!Number.isFinite(d)) return 0;
  let paybackHit = false;
  for (const w of windows || []) {
    if (!w || w.start == null || w.end == null) continue;
    const phase = peakPhaseForWindow(d, w.start, w.end, tuning.PEAK_PAYBACK_DAYS);
    if (phase === "peak") {
      const tq = w.trainingQuality != null ? w.trainingQuality : trainingQuality;
      return peakScoreComponent({ phase: "peak", trainingQuality: tq, tuning });
    }
    if (phase === "payback") paybackHit = true;
  }
  return paybackHit ? peakScoreComponent({ phase: "payback", tuning }) : 0;
}

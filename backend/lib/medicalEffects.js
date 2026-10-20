// #6984 Medicinsk afdeling (ejer-beslutning 20/10: M1, M2, M3, M4, M8). REN: ingen IO.
// Spec: docs/superpowers/specs/2026-10-20-6984-medicin-facilitet-forslag.md.
// Alle effekter regnes fra ÉT tal, `bonus` = effectiveBonus('medical', tier, chef)
// (facilityEngine.js), og er kun aktive bag condition_model_v2. Et hold uden afdeling
// har bonus 0 = ingen effekt. Konstanterne er balance; kalibrering i balance-internals/6984/.
import { effectiveBonus } from "./facilityEngine.js";
import { seededUnitMixed } from "./riderProgression.js";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";

export const MEDICAL_EFFECT_CONFIG = Object.freeze({
  // M1 (ejer 20/10): rytterens recovery-evne × (1 + recoveryShare × bonus) i restitutionen
  // (forstærker evnen, ikke gulvet). Det er også tallet klubben viser.
  recoveryShare: 0.5,
  // M2: træningens skaderisiko × (1 − trainingInjuryShare × bonus).
  trainingInjuryShare: 1,
  // M2: sandsynligheden for at et styrt med skade bliver til et styrt uden skade.
  crashInjuryAvoidShare: 0.5,
  // M3: skadedage × (1 − injuryDaysShare × bonus), altid mindst én dag.
  injuryDaysShare: 1,
  // M4: antal vurderings-trin efter afdelingens niveau (uden afdeling = 2).
  assessmentLevelsByTier: Object.freeze({ 0: 2, 1: 2, 2: 3, 3: 3, 4: 4, 5: 4 }),
});

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(Number(x)) ? Number(x) : 0));

/** Holdets medicin-bonus (0 uden afdeling). `staff` = { overall, ... } | null. */
export function medicalBonus(tier, staff) {
  const t = Math.max(0, Math.floor(Number(tier) || 0));
  if (t <= 0) return 0;
  return clamp01(effectiveBonus("medical", t, staff ?? null));
}

/** M1: multiplikator på rytterens recovery-evne i restitutionen. */
export function medicalRecoveryMultiplier(bonus, cfg = MEDICAL_EFFECT_CONFIG) {
  return 1 + cfg.recoveryShare * clamp01(bonus);
}

/** M1: det klubben viser som "+X % restitution" (samme tal som motoren bruger). */
export function medicalDisplayBonus(bonus, cfg = MEDICAL_EFFECT_CONFIG) {
  return cfg.recoveryShare * clamp01(bonus);
}

/** M2: træningens skaderisiko efter afdelingen. */
export function medicalTrainingInjuryRisk(risk, bonus, cfg = MEDICAL_EFFECT_CONFIG) {
  return Math.max(0, Number(risk) || 0) * (1 - cfg.trainingInjuryShare * clamp01(bonus));
}

/** M3: skadedage efter afdelingen (heltal, mindst 1). */
export function medicalInjuryDays(days, bonus, cfg = MEDICAL_EFFECT_CONFIG) {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  if (d <= 0) return d;
  return Math.max(1, Math.ceil(d * (1 - cfg.injuryDaysShare * clamp01(bonus))));
}

/**
 * M2 + M3 for løbets styrt. Motoren (v3/v4) afgør styrtet og forbliver ren; her
 * ændres kun skadeudfaldet, før det persisteres. Et seedet rul pr. rytter og etape
 * gør skaden til et styrt uden skade; ellers forkortes den (M3). Andre hændelser
 * (mekanisk, tidstab, tidsgrænse) og ryttere uden bonus er uændrede.
 * @param {Array<{rider_id:string, injury_days:number|null}>} incidents
 * @param {Map<string, number>} bonusByRider
 * @returns {Array} nye objekter (input muteres ikke)
 */
export function applyMedicalToRaceIncidents(incidents, bonusByRider, { raceId, stageNumber }, cfg = MEDICAL_EFFECT_CONFIG) {
  return (incidents ?? []).map((inc) => {
    const days = Number(inc?.injury_days);
    if (!Number.isFinite(days) || days <= 0) return inc;
    const bonus = clamp01(bonusByRider?.get(String(inc.rider_id)));
    if (bonus <= 0) return inc;
    const roll = seededUnitMixed(`medical-crash:${raceId}:${inc.stage_number ?? stageNumber}:${inc.rider_id}`);
    // injury_avoided: skade-skriveren (raceRunner.incidentInjuryUpsertRows) giver ellers
    // ethvert udgået styrt mindst én dag; markøren gemmes ikke, den styrer kun skrivningen.
    if (roll < cfg.crashInjuryAvoidShare * bonus) return { ...inc, injury_days: null, injury_avoided: true };
    return { ...inc, injury_days: medicalInjuryDays(days, bonus, cfg) };
  });
}

// ── M4: holdlægens vurdering (ord, aldrig tal) ─────────────────────────────────
// Træthedsgrænserne følger riderCondition (skadegrænsen 70) og v2-formzonen (55).
const ASSESSMENT_BANDS = Object.freeze({
  2: [[70, "ready"], [Infinity, "tired"]],
  3: [[40, "fresh"], [70, "ready"], [Infinity, "tired"]],
  4: [[40, "fresh"], [55, "ready"], [70, "tired"], [Infinity, "rest"]],
});

/** Antal vurderingstrin for et afdelingsniveau. */
export function assessmentLevels(tier, cfg = MEDICAL_EFFECT_CONFIG) {
  const t = Math.max(0, Math.min(5, Math.floor(Number(tier) || 0)));
  return cfg.assessmentLevelsByTier[t] ?? 2;
}

/**
 * M4: lægens vurdering af én rytter ud fra trætheden (gerne prognosen for aftenen).
 * Returnerer en nøgle til spillerteksten: fresh | ready | tired | rest | injured.
 */
export function doctorAssessment({ fatigue, injured = false, tier = 0 }) {
  if (injured) return "injured";
  if (fatigue == null) return null;
  const f = Number(fatigue);
  if (!Number.isFinite(f)) return null;
  const bands = ASSESSMENT_BANDS[assessmentLevels(tier)];
  return bands.find(([hi]) => f < hi)[1];
}

// ── M8: lægens sæsonråd før en Grand Tour ──────────────────────────────────────
/**
 * Hvem er klar til denne GT, og hvem bliver kørt flad til den tredje? Ren vurdering
 * ud fra rytterens løbsdage i sæsonen + de planlagte løbsdage frem til og med den
 * sidste GT, holdt op mod sæsonbelastningens frie dage og loft (B3). Ord, aldrig tal.
 * @param {{ fatigue:number, injured?:boolean, seasonRaceDays:number, plannedRaceDaysToLastGt:number, tier?:number }} rider
 * @param {{ seasonFreeDays:number, seasonCapDays:number }} season  løbsdag hvor tillægget starter / rammer loftet
 * @returns {"ready"|"ready_but_spent_later"|"already_heavy"|"rest_first"|"injured"}
 */
export function doctorSeasonAdvice(rider, season) {
  if (rider.injured) return "injured";
  const now = Math.max(0, Number(rider.seasonRaceDays) || 0);
  const planned = Math.max(0, Number(rider.plannedRaceDaysToLastGt) || 0);
  const assessment = doctorAssessment({ fatigue: rider.fatigue, tier: rider.tier ?? 0 });
  if (assessment === "tired" || assessment === "rest") return "rest_first";
  if (now >= season.seasonCapDays) return "already_heavy";
  if (now + planned >= season.seasonCapDays) return "ready_but_spent_later";
  return "ready";
}

// ── IO: holdets bonus ─────────────────────────────────────────────────────────
// Samme loader og samme fejlregler som træningsfaciliteten (#6596: en forbigående
// fejl kaster ved retryOnTransient, ellers neutral = ingen afdeling).
export async function loadTeamMedicalBonus(supabase, teamId, { retryOnTransient = false } = {}) {
  if (!teamId) return 0;
  const { facilityTier, staff } = await loadTrainingStaffContext(supabase, teamId, { retryOnTransient, track: "medical" });
  return medicalBonus(facilityTier, staff);
}

/** Bonus pr. hold for et sæt hold (fx et løbs startfelt). */
export async function loadMedicalBonusByTeam(supabase, teamIds) {
  const out = new Map();
  for (const id of [...new Set((teamIds ?? []).filter(Boolean))]) out.set(id, await loadTeamMedicalBonus(supabase, id));
  return out;
}


/**
 * M2 + M3 på HELE etapens output i ét skridt, så alle forbrugere ser samme skade:
 * hændelserne (race_incidents og rider_condition-skaden udledes af dem) og
 * tidslinjens "incident"-events (løbsfilmen). Et undgået skadesforløb beholder
 * styrtet og udfaldet (stadig udgået), men uden skadedage. REN.
 * @returns {{ incidents: Array, timelines: Array }}
 */
export function applyMedicalToStageOutputs({ incidents, timelines, bonusByRider, raceId }, cfg = MEDICAL_EFFECT_CONFIG) {
  const mitigated = applyMedicalToRaceIncidents(incidents, bonusByRider, { raceId }, cfg);
  const daysByStageRider = new Map();
  (incidents ?? []).forEach((inc, i) => {
    if (Number(inc?.injury_days) > 0) daysByStageRider.set(`${inc.stage_number}:${inc.rider_id}`, mitigated[i].injury_days);
  });
  if (!daysByStageRider.size) return { incidents: mitigated, timelines };
  const nextTimelines = (timelines ?? []).map((t) => {
    let changed = false;
    const events = (t.events ?? []).map((ev) => {
      if (ev?.type !== "incident" || !(Number(ev.params?.injury_days) > 0)) return ev;
      const key = `${t.stage_number}:${ev.params.rider_id}`;
      if (!daysByStageRider.has(key)) return ev;
      changed = true;
      return { ...ev, params: { ...ev.params, injury_days: daysByStageRider.get(key) } };
    });
    return changed ? { ...t, events } : t;
  });
  return { incidents: mitigated, timelines: nextTimelines };
}

/** IO: medicin-bonus pr. rytter i et løb (holdet han stillede op for, race_entries). */
export async function loadMedicalBonusForRiders({ supabase, raceId, riderIds }) {
  const ids = [...new Set((riderIds ?? []).map(String))];
  const out = new Map();
  if (!ids.length) return out;
  // pagination-safe: ét løbs startfelt (under 200 ryttere).
  const { data, error } = await supabase.from("race_entries").select("rider_id, team_id").eq("race_id", raceId);
  if (error) throw new Error(`race_entries (medical): ${error.message}`);
  const teamByRider = new Map((data ?? []).filter((r) => ids.includes(String(r.rider_id))).map((r) => [String(r.rider_id), r.team_id]));
  const bonusByTeam = await loadMedicalBonusByTeam(supabase, [...teamByRider.values()]);
  for (const [rider, team] of teamByRider) out.set(rider, bonusByTeam.get(team) ?? 0);
  return out;
}

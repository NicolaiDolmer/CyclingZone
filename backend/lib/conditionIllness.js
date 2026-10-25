// #6938 (U1-erstatning, ejer 24/10): sygdom af langvarig ekstrem traethed.
// Design: docs/superpowers/specs/2026-10-25-6938-sygdom-af-traethed-design.md.
// Regler: docs/TRAINING_RULES.md §5 og docs/RACE_ENGINE_RULES.md "Udgaaede under s5_profiles_v3".
//
// Kun ekstremt traette ryttere flere dage i traek kan blive syge. Risikoen stiger med
// stimens laengde og med hvor langt over taersklen traetheden ligger, har et loft pr. dag,
// og holdets medicinske afdeling saenker den. En syg rytter starter ikke og er ude nogle
// loebsdage, uden evneskade. REN: ingen IO, seedet pr. (rytter, dato).
import { seededUnitMixed } from "./riderProgression.js";

export const ILLNESS_CONFIG = Object.freeze({
  // Traetheden (0-100) der taeller som ekstrem.
  extremeFatigue: 85,
  // Mindste antal dage i traek over taersklen (inkl. i dag) foer der er nogen risiko.
  minStreakDays: 3,
  // Risiko pr. dag ved minimumsstimen lige over taersklen.
  baseRisk: 0.02,
  // Ekstra risiko pr. dag ud over minimumsstimen.
  riskPerExtraDay: 0.015,
  // Ekstra risiko pr. traethedspoint over taersklen (stimens gennemsnit).
  riskPerFatiguePoint: 0.002,
  // Loft pr. dag.
  maxRisk: 0.12,
  // Medicinsk afdelings andel af virkningen (formlen er privat, hard rule 17).
  medicalShare: 0.5,
  // Loebsdage ude (seedet mellem min og max, inkl.).
  minDays: 2,
  maxDays: 4,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Stimen der slutter i dag: antal dage i traek (nyeste foerst) hvor traetheden var ekstrem,
 * og stimens gennemsnitlige traethed. `fatigues` er nyeste foerst og starter med i dag.
 */
export function extremeFatigueStreak(fatigues, cfg = ILLNESS_CONFIG) {
  let days = 0;
  let sum = 0;
  for (const f of fatigues ?? []) {
    const n = Number(f);
    if (!Number.isFinite(n) || n < cfg.extremeFatigue) break;
    days += 1;
    sum += n;
  }
  return { days, meanFatigue: days > 0 ? sum / days : 0 };
}

/** Dagens risiko (0..maxRisk) for stimen, efter den medicinske afdeling (`medicalBonus` 0..1). */
export function illnessRisk({ streakDays, meanFatigue, medicalBonus = 0 }, cfg = ILLNESS_CONFIG) {
  if (!(streakDays >= cfg.minStreakDays)) return 0;
  const over = Math.max(0, Number(meanFatigue) - cfg.extremeFatigue);
  const raw = cfg.baseRisk + (streakDays - cfg.minStreakDays) * cfg.riskPerExtraDay + over * cfg.riskPerFatiguePoint;
  const capped = clamp(raw, 0, cfg.maxRisk);
  return capped * (1 - cfg.medicalShare * clamp(Number(medicalBonus) || 0, 0, 1));
}

/**
 * Bliver rytteren syg i dag? Seedet pr. (rytter, dato), uafhaengigt af andre ryttere og af
 * traeningsskadens rul. Returnerer { ill, days }.
 */
export function rollIllness({ riderId, dateStr, risk }, cfg = ILLNESS_CONFIG) {
  if (!(risk > 0)) return { ill: false, days: 0 };
  if (seededUnitMixed(`illness:${riderId}:${dateStr}`) >= risk) return { ill: false, days: 0 };
  const span = cfg.maxDays - cfg.minDays + 1;
  const days = cfg.minDays + Math.min(span - 1, Math.floor(seededUnitMixed(`illnessdays:${riderId}:${dateStr}`) * span));
  return { ill: true, days };
}

/** Hele vurderingen for én rask rytter: stime -> risiko -> rul. */
export function assessIllness({ riderId, dateStr, fatigues, medicalBonus = 0 }, cfg = ILLNESS_CONFIG) {
  const { days: streakDays, meanFatigue } = extremeFatigueStreak(fatigues, cfg);
  const risk = illnessRisk({ streakDays, meanFatigue, medicalBonus }, cfg);
  return { streakDays, risk, ...rollIllness({ riderId, dateStr, risk }, cfg) };
}

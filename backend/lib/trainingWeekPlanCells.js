// De 35 felter for ALLE hold (#5932, ejer-beslutning 6, 29/9) — RENE funktioner.
//
// Felterne bor i training_week_plans.days (trainingPrograms.js, #4629). En
// rytter der aldrig har faaet et program, har ingen felter endnu. Naar
// spilleren retter hans foerste felt, SAAR serveren ugen fra det rytteren
// traener i dag, og retter saa feltet. Ugedagens session udfylder dagens fem
// felter; spilleren overstyrer enkelte.
//
// Saaningen genbruger det ejer-godkendte omskrivnings-valg fra 14/8
// (trainingDayTypes.js, migrationTargetFor): fokus bevares, intensiteten
// foelger sessionen, og en dag der ville rykke OP i belastning starter som
// hvile i stedet. Spilleren ser hele ugen i gitteret foer han retter, og
// ingen rytter faar en haardere dag end i dag uden selv at have valgt den.
//
// Raekkefoelge (samme stige som motoren, TRAINING_RULES §4):
//   1) rytterens egen raekke MED felter      → uaendret (allerede felter)
//   2) holdets raekke MED felter, og rytteren har hverken egen raekke eller
//      eksplicit plan                        → kopi af holdets felter
//   3) ellers                                → ugedag for ugedag fra den
//      effektive plan (resolveDayIntensity + rytterens fokus)

import { WEEKDAY_KEYS, resolveDayIntensity, isValidIntensity } from "./training.js";
import { resolveProgram } from "./dailyTraining.js";
import { migrationTargetFor } from "./trainingDayTypes.js";
import { isValidProgramWeekDays, intensityForSession, isProgramSession } from "./trainingPrograms.js";

function copyDays(days) {
  const out = {};
  for (const weekday of WEEKDAY_KEYS) {
    const entry = days[weekday];
    out[weekday] = { session: entry.session, intensity: entry.intensity, ...(entry.slots ? { slots: [...entry.slots] } : {}) };
  }
  return out;
}

// Ugedagens session ud fra et gemt (fokus, intensitet)-par.
export function sessionForLegacyDay({ focus, intensity }) {
  const target = migrationTargetFor({ focus, intensity });
  if (target.dayType === "rest") return "rest";
  if (target.dayType === "recovery") return "recovery";
  return isProgramSession(target.session) ? target.session : "rest";
}

// Returnerer en NY, gyldig 7-dages felt-plan for rytteren.
//   riderDays   : rytterens egen raekke (rider_id sat) eller null
//   teamDays    : holdets raekke (rider_id IS NULL) eller null
//   plan        : training_plans-raekken { focus, intensity } eller null
//   primaryType : rytterens anlaeg (resolveProgram's smart default)
export function seedProgramWeekDays({ riderDays = null, teamDays = null, plan = null, primaryType = null } = {}) {
  if (isValidProgramWeekDays(riderDays)) return copyDays(riderDays);
  const hasExplicitPlan = !!(plan?.focus && plan?.intensity);
  const riderHasOwnDays = WEEKDAY_KEYS.some((weekday) => isValidIntensity(riderDays?.[weekday]?.intensity));
  if (!riderHasOwnDays && !hasExplicitPlan && isValidProgramWeekDays(teamDays)) return copyDays(teamDays);

  const program = resolveProgram(plan, primaryType);
  const days = {};
  for (const weekday of WEEKDAY_KEYS) {
    const intensity = resolveDayIntensity({
      weekday, riderOverrideDays: riderDays, teamWeekDays: teamDays, planIntensity: program.intensity, hasExplicitPlan,
    });
    const session = sessionForLegacyDay({ focus: program.focus, intensity });
    days[weekday] = { session, intensity: intensityForSession(session) };
  }
  return days;
}

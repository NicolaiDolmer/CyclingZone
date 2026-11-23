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
import { v3SmartDefaultFocus } from "./trainingCatalogV3.js";
import { isEffortLevel } from "./trainingEffortLevels.js"; // #7947

function copyDays(days) {
  const out = {};
  for (const weekday of WEEKDAY_KEYS) {
    const entry = days[weekday];
    out[weekday] = {
      session: entry.session, intensity: entry.intensity, ...(entry.slots ? { slots: [...entry.slots] } : {}),
      // #7947: indsats-noeglerne foelger med kopien (additive; laeses kun med kontakten).
      ...(entry.effort != null ? { effort: entry.effort } : {}),
      ...(entry.slotEfforts ? { slotEfforts: [...entry.slotEfforts] } : {}),
      // #8549: dagens laas foelger med kopien (laeses foerst bag kontakten i en senere PR).
      ...(entry.lockSlot != null ? { lockSlot: entry.lockSlot } : {}),
    };
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

// #7947 (Codex-fund paa PR 2+4): en plan paa et andet niveau end sessionens standard. Med
// kontakten training_effort_levels on kan api.js skrive den (fx Lang tur paa Haard). Den gamle
// oversaettelse af parret ville saa skifte session eller give hvile, saa saaningen bevarer i
// stedet sessionen og laegger niveauet i dagens indsats (effort).
export function planRunsOffStandard(plan) {
  return !!plan?.focus && isProgramSession(plan.focus) && isEffortLevel(plan.intensity)
    && plan.intensity !== intensityForSession(plan.focus);
}

// Returnerer en NY, gyldig 7-dages felt-plan for rytteren.
//   riderDays   : rytterens egen raekke (rider_id sat) eller null
//   teamDays    : holdets raekke (rider_id IS NULL) eller null
//   plan        : training_plans-raekken { focus, intensity } eller null
//   primaryType : rytterens anlaeg (resolveProgram's smart default)
//   secondaryType, catalogV3 : #5319 - under v3 saaes en tt/gc-rytter uden plan
//                 med itt_long, ikke Taerskel (samme regel som motoren). Off = uroert.
//   effortLevels : #7947, kontakten training_effort_levels. Off = uroert (dagens saaning).
export function seedProgramWeekDays({ riderDays = null, teamDays = null, plan = null, primaryType = null, secondaryType = null, catalogV3 = false, effortLevels = false } = {}) {
  if (isValidProgramWeekDays(riderDays)) return copyDays(riderDays);
  const hasExplicitPlan = !!(plan?.focus && plan?.intensity);
  const riderHasOwnDays = WEEKDAY_KEYS.some((weekday) => isValidIntensity(riderDays?.[weekday]?.intensity));
  if (!riderHasOwnDays && !hasExplicitPlan && isValidProgramWeekDays(teamDays)) return copyDays(teamDays);

  const program = resolveProgram(plan, primaryType);
  if (!hasExplicitPlan) {
    program.focus = v3SmartDefaultFocus(program.focus, { primary_type: primaryType, secondary_type: secondaryType }, { v3: catalogV3 });
  }
  const days = {};
  for (const weekday of WEEKDAY_KEYS) {
    const intensity = resolveDayIntensity({
      weekday, riderOverrideDays: riderDays, teamWeekDays: teamDays, planIntensity: program.intensity, hasExplicitPlan,
    });
    // #7947: planens eget niveau paa en session med et andet standardniveau bliver dagens indsats.
    if (effortLevels && hasExplicitPlan && intensity === program.intensity && planRunsOffStandard(program)) {
      days[weekday] = { session: program.focus, intensity: intensityForSession(program.focus), effort: intensity };
      continue;
    }
    const session = sessionForLegacyDay({ focus: program.focus, intensity });
    days[weekday] = { session, intensity: intensityForSession(session) };
  }
  return days;
}

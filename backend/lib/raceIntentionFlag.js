// Løbsdagens intention (#4632) — kill-switch for femtrins-effort-skalaen.
//
// Ejer-beslutning 5-6/9 + beslutningsoplægget
// docs/superpowers/specs/2026-09-03-race-day-intention-decision.md §7 punkt 7:
// "UI + data-model bag et nyt flag ... (off) først; fatigue/work-cost-
// multiplikatorerne wires bag SAMME flag; dry-run; ejer-go; flip."
//
// HVAD FLAGET STYRER (og kun det):
//   1. API-VOKABULARET. Off = `race_stage_roles.effort` / `race_team_orders.
//      riders[].effort` accepterer PRÆCIS de tre gamle værdier (protect/normal/
//      save). On = alle fem (grupetto/save/normal/protect/all_out). Rækkefølgen
//      er med vilje: DB-constraint'en tillader fem fra migrationen af, men
//      API'et afviser de to nye indtil ejeren flipper — så et UI der er deployet
//      før flippet ikke kan gemme et valg der endnu ikke må virke.
//   2. Formudbytte-kroken (D2). applyRaceDevelopmentTick skalerer kun devTotal
//      efter intentionen når kald-stedet sender et effort, hvilket først sker
//      når BÅDE dette flag OG race_day_development_enabled er on.
//
// HVAD DET IKKE STYRER: selve multiplikatorerne i raceRoles.js. De er rene
// lookups på en effort-værdi, og off-tilstanden garanterer at ingen række
// NOGENSINDE kan indeholde 'grupetto'/'all_out' (API'et er eneste skrivevej,
// og migrationen ændrer ikke eksisterende rækker). Motoren er derfor
// bit-identisk med i dag så længe flaget er off — uden en ekstra gate i den
// varme sti.
//
// UAFHÆNGIGT af race_day_development_enabled (#4277) og race_engine_v3_scoring:
// intentionen skal netop kunne shippes og afprøves FØR D1/D2 tændes igen
// (TRAINING_RULES.md §8 punkt 1). Egen fil frem for en linje i raceEngineFlag.js
// = samme mønster som raceDayDevelopmentFlag.js/raceDayEngineFlag.js, og holder
// filen fri af parallelle v4-flip-ændringer.
//
// Ingen migration: rowen mangler i app_config indtil ejeren indsætter den, og
// readFlagStage/evaluateFlagStage behandler fravær som 'off' (fail-safe), præcis
// som peak_planner_enabled.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const RACE_DAY_INTENTION_FLAG_KEY = "race_day_intention_enabled";

export async function isRaceDayIntentionEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, RACE_DAY_INTENTION_FLAG_KEY), opts);
}

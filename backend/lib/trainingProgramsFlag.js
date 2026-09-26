// Stadie-flag for traeningsprogrammer pr. loebsdag (#4629). Moenster kopieret
// fra trainingMobileTableFlag.js.
//
// EJER 26/9: "Skal i BETA hos spillerne I DAG". Migrationen
// (database/2026-09-26-4629-training-programs.sql) opretter raekken i stadie
// `beta`: beta-testere (users.is_beta_tester eller role = 'admin') ser
// Program-fanens katalog og kan laegge programmer paa ryttere; alle andre ser
// Ugeplan-fanen praecis som i dag.
//
// TO LAESERE, samme stadie:
//   · API'et (GET /api/training/programs og skrivestierne) evaluerer VIEWERENS
//     beta-status server-side og sender en bar boolean (`enabled`).
//   · Motoren har ingen viewer. Den spoerger holdets EJER (teams.user_id ->
//     users). `engineWrite` bruges bevidst IKKE: i `beta` maa motoren kun laese
//     programceller for beta-hold, ellers ville en rytter hos en ikke-beta-
//     spiller kunne traene efter et program spilleren ikke kan se.
//
// Motoren slaar kun op naar holdet faktisk HAR programdata (en raekke med
// `session`), saa hold uden programmer har praecis samme DB-kald som foer.
//
// API-stien er fail-safe (fejl → false, dagens flade). Motor-stien KASTER ved
// et fejlet opslag, se isTrainingProgramsEnabledForTeam.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_PROGRAMS_FLAG_KEY = "training_programs";

export async function isTrainingProgramsEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_PROGRAMS_FLAG_KEY), opts);
}

// Motorens svar for ET hold: on → true; beta → kun hvis holdets ejer er
// beta-tester; off/ukendt/manglende raekke → false.
//
// KASTER ved et FEJLET opslag (CodeRabbit-fund, #4629): kun hold MED programdata
// naar hertil, og for dem er et gaet enten programmet eller den gamle plan, altsaa
// muligvis en anden session end spilleren har sat. Motoren sletter saa sin
// reservation, og naeste sweep proever igen (samme kontrakt som
// loebsdags-bindingen). ASCII-only beskeder (#i18n-leak-guard): intern ops-fejl.
export async function isTrainingProgramsEnabledForTeam(supabase, teamId) {
  const { data: flagRow, error: flagError } = await supabase
    .from("app_config").select("value").eq("key", TRAINING_PROGRAMS_FLAG_KEY).maybeSingle();
  if (flagError) throw new Error(`training_programs flag load: ${flagError.message ?? flagError}`);
  const stage = flagRow?.value ?? null;
  if (stage === true || stage === "on") return true;
  if (stage !== "beta") return false;

  const { data: team, error: teamError } = await supabase
    .from("teams").select("user_id").eq("id", teamId).maybeSingle();
  if (teamError) throw new Error(`training_programs owner load (team ${teamId}): ${teamError.message ?? teamError}`);
  if (!team?.user_id) return false;

  const { data: user, error: userError } = await supabase
    .from("users").select("role, is_beta_tester").eq("id", team.user_id).maybeSingle();
  if (userError) throw new Error(`training_programs owner beta load (team ${teamId}): ${userError.message ?? userError}`);
  return user?.role === "admin" || user?.is_beta_tester === true;
}

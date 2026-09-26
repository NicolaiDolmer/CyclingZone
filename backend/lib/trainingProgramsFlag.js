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
//   · API'et (GET /api/training/me og skrivestierne) evaluerer VIEWERENS
//     beta-status server-side og sender en bar boolean (`programs`).
//   · Motoren har ingen viewer. Den spoerger holdets EJER (teams.user_id ->
//     users). `engineWrite` bruges bevidst IKKE: i `beta` maa motoren kun laese
//     programceller for beta-hold, ellers ville en rytter hos en ikke-beta-
//     spiller kunne traene efter et program spilleren ikke kan se.
//
// Motoren slaar kun op naar holdet faktisk HAR programdata (en raekke med
// `session`), saa hold uden programmer har praecis samme DB-kald som foer.
//
// Fail-safe: manglende/ukendt vaerdi eller fejl → false, dvs. dagens adfaerd.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_PROGRAMS_FLAG_KEY = "training_programs";

export async function isTrainingProgramsEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_PROGRAMS_FLAG_KEY), opts);
}

// Er holdets ejer beta-tester eller admin? Fejl → false (fail-safe).
export async function isTeamOwnerBetaTester(supabase, teamId) {
  if (!supabase?.from || !teamId) return false;
  try {
    const { data: team, error: teamError } = await supabase
      .from("teams").select("user_id").eq("id", teamId).maybeSingle();
    if (teamError || !team?.user_id) return false;
    const { data: user, error: userError } = await supabase
      .from("users").select("role, is_beta_tester").eq("id", team.user_id).maybeSingle();
    if (userError || !user) return false;
    return user.role === "admin" || user.is_beta_tester === true;
  } catch {
    return false;
  }
}

// Motorens svar for ET hold: on → true; beta → kun hvis holdets ejer er
// beta-tester; off/ukendt/fejl → false.
export async function isTrainingProgramsEnabledForTeam(supabase, teamId) {
  const stage = await readFlagStage(supabase, TRAINING_PROGRAMS_FLAG_KEY);
  if (stage === true || stage === "on") return true;
  if (stage !== "beta") return false;
  return isTeamOwnerBetaTester(supabase, teamId);
}

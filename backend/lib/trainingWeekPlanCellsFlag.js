// Stadie-flag for de 35 programfelter (7 ugedage x 5 loebsdage) for ALLE hold
// (#5932, ejer-beslutning 6, 29/9).
//
// Foer #5932 laa felterne bag `training_programs` (#4629, beta): kun beta-testere
// kunne rette et felt, og motoren laeste kun felter for beta-hold. Beta-gaten er
// nu flyttet hertil, til sit eget flag:
//
//   · `training_program_cells` styrer FELTERNE: rette et felt, og motorens
//     laesning af felterne. `on` = alle hold.
//   · `training_programs` styrer fortsat KATALOGET (de 22 standardprogrammer og
//     "Brug program"). Det er uaendret.
//
// Felterne er aabne naar ENTEN flaget er aabent for viewereren/holdet. Saa mister
// en beta-tester aldrig felter han allerede har, uanset hvilket flag der flippes
// foerst, og `training_program_cells` = off er praecis dagens adfaerd.
//
// Samme to laesere som trainingProgramsFlag.js: API'et (viewerens beta-status,
// fail-safe) og motoren (holdets ejer, KASTER ved fejlet opslag).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { isTrainingProgramsEnabled, isTrainingProgramsEnabledForTeam } from "./trainingProgramsFlag.js";

export const TRAINING_PROGRAM_CELLS_FLAG_KEY = "training_program_cells";

export async function isTrainingCellsEnabled(supabase, opts = {}) {
  if (evaluateFlagStage(await readFlagStage(supabase, TRAINING_PROGRAM_CELLS_FLAG_KEY), opts)) return true;
  return isTrainingProgramsEnabled(supabase, opts);
}

// Motorens svar for ET hold. on → true; beta → kun hvis holdets ejer er
// beta-tester (via trainingProgramsFlag's ejer-opslag); ellers det gamle
// `training_programs`-svar. KASTER ved et fejlet opslag (samme kontrakt som
// isTrainingProgramsEnabledForTeam). ASCII-only beskeder (#i18n-leak-guard).
export async function isTrainingCellsEnabledForTeam(supabase, teamId) {
  const { data: flagRow, error } = await supabase
    .from("app_config").select("value").eq("key", TRAINING_PROGRAM_CELLS_FLAG_KEY).maybeSingle();
  if (error) throw new Error(`training_program_cells flag load: ${error.message ?? error}`);
  const stage = flagRow?.value ?? null;
  if (stage === true || stage === "on") return true;
  if (stage === "beta" && (await isTeamOwnerBetaTester(supabase, teamId))) return true;
  return isTrainingProgramsEnabledForTeam(supabase, teamId);
}

async function isTeamOwnerBetaTester(supabase, teamId) {
  const { data: team, error: teamError } = await supabase
    .from("teams").select("user_id").eq("id", teamId).maybeSingle();
  if (teamError) throw new Error(`training_program_cells owner load (team ${teamId}): ${teamError.message ?? teamError}`);
  if (!team?.user_id) return false;
  const { data: user, error: userError } = await supabase
    .from("users").select("role, is_beta_tester").eq("id", team.user_id).maybeSingle();
  if (userError) throw new Error(`training_program_cells owner beta load (team ${teamId}): ${userError.message ?? userError}`);
  return user?.role === "admin" || user?.is_beta_tester === true;
}

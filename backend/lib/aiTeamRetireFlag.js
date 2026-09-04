// #4753: styrer om AI-trimmen NEDLÆGGER hold (retireAiTeam — ingen DELETE) i
// stedet for at hård-slette dem. Bor i app_config (samme mønster som
// autoPrizeFlag.js / riderValuesBulkWriteFlag.js) → flippes runtime uden re-deploy.
//
// Fail-safe: fejl/fravær → false (uændret hård-slet-adfærd). Default OFF ved merge
// — ejeren tænder den eksplicit efter at have set dry-run'en for de fastlåste hold.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const AI_TEAM_RETIRE_FLAG_KEY = "ai_team_retire_enabled";

export async function isAiTeamRetireEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, AI_TEAM_RETIRE_FLAG_KEY), opts);
}

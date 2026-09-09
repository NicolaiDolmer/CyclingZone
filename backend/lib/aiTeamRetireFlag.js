// #4753: styrer om AI-trimmen NEDLÆGGER hold (retireAiTeam — ingen DELETE) i
// stedet for at hård-slette dem. Bor i app_config (samme mønster som
// autoPrizeFlag.js / riderValuesBulkWriteFlag.js) → flippes runtime uden re-deploy.
//
// Fejl/fravær → false: automatiske fjernelser PAUSERES. Ingen tilbagefald til
// hård sletning. Begge flag skal være on: eksisterende kill-switch PLUS en ny
// release-gate, som mangler (off) i prod ved read-only-målingen 9/9.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const AI_TEAM_RETIRE_FLAG_KEY = "ai_team_retire_enabled";
export const AI_POOL_RETIREMENT_RELEASE_KEY = "ai_pool_retirement_v2_enabled";

export async function isAiTeamRetireEnabled(supabase) {
  return evaluateFlagStage(await readFlagStage(supabase, AI_TEAM_RETIRE_FLAG_KEY))
    && evaluateFlagStage(await readFlagStage(supabase, AI_POOL_RETIREMENT_RELEASE_KEY));
}

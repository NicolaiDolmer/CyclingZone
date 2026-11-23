// #8548 · Stadie-flaget `training_rotation` (off | beta | on), seedet "off" af
// database/2026-11-22-8548-training-rotation.sql. Tænding er ejer-only.
//
// Off: API'et leverer ingen rotation og afviser skrivning (409 feature_disabled),
// og motoren læser aldrig kolonnen (PR 2). En manglende række eller et fejlet
// opslag er off (featureStage.js fail-safe).
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const TRAINING_ROTATION_FLAG_KEY = "training_rotation";

// Viewerens svar (API'et): beta = kun beta-testere.
export async function isTrainingRotationEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_ROTATION_FLAG_KEY), opts);
}

export async function isTrainingRotationEnabledForTeam(supabase, teamId) {
  const { data: flag, error: flagError } = await supabase.from("app_config").select("value")
    .eq("key", TRAINING_ROTATION_FLAG_KEY).maybeSingle();
  if (flagError) throw new Error(`training rotation flag: ${flagError.message}`);
  const stage = flag?.value ?? null;
  if (stage !== "beta") return evaluateFlagStage(stage);
  const { data: team, error: teamError } = await supabase.from("teams").select("user_id").eq("id", teamId).maybeSingle();
  if (teamError) throw new Error(`training rotation owner: ${teamError.message}`);
  if (!team?.user_id) return false;
  const { data: owner, error } = await supabase.from("users").select("role, is_beta_tester").eq("id", team.user_id).maybeSingle();
  if (error) throw new Error(`training rotation owner beta: ${error.message}`);
  return owner?.role === "admin" || owner?.is_beta_tester === true;
}

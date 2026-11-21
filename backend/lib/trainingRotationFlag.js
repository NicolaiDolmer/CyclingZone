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

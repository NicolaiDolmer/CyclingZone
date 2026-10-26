// #6984: Form og træthed 2.0 bag ét flag. Off (eller manglende række) = gammel model.
// v2 bygger på dato-opgørelsen (#5928) og må ikke køre uden den.
import { isTrainingConditionPerDateEnabled, readConditionWriterFlag } from './trainingDateConditionFlag.js';

export const CONDITION_MODEL_V2_FLAG_KEY = 'condition_model_v2';

// Strict som ejerskabsflagene: en DB-fejl kaster frem for stille at vælge en model.
export async function isConditionModelV2Enabled(supabase) {
  const enabled = await readConditionWriterFlag(supabase, CONDITION_MODEL_V2_FLAG_KEY, { engineWrite: true });
  if (enabled && !await isTrainingConditionPerDateEnabled(supabase)) {
    throw new Error('condition_model_v2 requires training_condition_per_date');
  }
  return enabled;
}

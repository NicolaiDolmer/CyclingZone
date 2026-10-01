import { evaluateFlagStage } from './featureStage.js';

export const TRAINING_CONDITION_PER_DATE_FLAG_KEY = 'training_condition_per_date';

// Ownership reads are strict: a database outage cannot revive extra recovery.
export async function isTrainingConditionPerDateEnabled(supabase) {
  const enabled=await readConditionWriterFlag(supabase, TRAINING_CONDITION_PER_DATE_FLAG_KEY, { engineWrite: true });
  if(enabled && !await readConditionWriterFlag(supabase,'training_tick_per_race_day',{engineWrite:true})) {
    throw new Error('training_condition_per_date requires training_tick_per_race_day');
  }
  return enabled;
}

export async function readConditionWriterFlag(supabase, key, opts = {}) {
  const { data, error } = await supabase.from('app_config').select('value')
    .eq('key', key).maybeSingle();
  if (error) throw new Error(`training condition ownership: ${error.message ?? error}`);
  return evaluateFlagStage(data?.value ?? null, opts);
}

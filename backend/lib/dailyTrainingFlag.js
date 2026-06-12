// Flag for dagligt trænings-tick (#1305). Mønster kopieret fra raceEngineFlag.js.
// OFF = ingen ticks/sweeps; programmer kan stadig sættes (intent-capture før relaunch).
//
// daily_training_enabled bor i app_config (key/value-tabellen), så den kan flippes
// runtime UDEN re-deploy — fail-safe: fejl/fravær → false (ingen utilsigtet aktivering).

export const DAILY_TRAINING_FLAG_KEY = "daily_training_enabled";

export async function isDailyTrainingEnabled(supabase) {
  if (!supabase?.from) return false;
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", DAILY_TRAINING_FLAG_KEY)
      .maybeSingle();
    if (error) return false;
    return data?.value === true;
  } catch {
    return false;
  }
}

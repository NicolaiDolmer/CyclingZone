// Race Engine light-motor (#1102), slice 2 — feature-flag.
//
// RACE_ENGINE_V2_ENABLED bor i app_config (key/value-tabellen), så den kan flippes
// runtime UDEN re-deploy — afgørende for en launch-sikker nød-fallback: kan motoren
// opføre sig forkert, slukkes den øjeblikkeligt og den uændrede PCM-import-sti er
// igen eneste resultat-kilde.
//
// flag-off (default) = PCM-stien er præcis uændret. Race-afvikling er en sjælden
// admin-handling, så ét DB-opslag pr. kald er gratis. Returnerer ALTID boolean —
// fejl/fravær → false (fail-safe mod utilsigtet aktivering).

export const RACE_ENGINE_V2_FLAG_KEY = "race_engine_v2_enabled";

export async function isRaceEngineV2Enabled(supabase) {
  if (!supabase?.from) return false;
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", RACE_ENGINE_V2_FLAG_KEY)
      .maybeSingle();
    if (error) return false;
    return data?.value === true;
  } catch {
    return false;
  }
}

// Eneste sted flag-stage læses + evalueres. Tre-tilstand: "off" | "beta" | "on".
// Bagudkompatibel: boolean true/false fra gammelt skema honoreres som on/off.
// Fail-safe: manglende/ukendt værdi eller fejl → ingen adgang.

export async function readFlagStage(supabase, key) {
  if (!supabase?.from) return null;
  try {
    const { data, error } = await supabase
      .from("app_config").select("value").eq("key", key).maybeSingle();
    if (error) return null;
    return data?.value ?? null; // boolean | "off"|"beta"|"on" | null
  } catch {
    return null;
  }
}

export function evaluateFlagStage(value, { isBetaTester = false } = {}) {
  if (value === true || value === "on") return true;
  if (value === "beta") return isBetaTester === true;
  return false;
}

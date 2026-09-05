// Eneste sted flag-stage læses + evalueres. Tre-tilstand: "off" | "beta" | "on".
// Bagudkompatibel: boolean true/false fra gammelt skema honoreres som on/off.
// Fail-safe: manglende/ukendt værdi eller fejl → ingen adgang.
//
// #4839: `beta` har TO gates, ikke én. `isBetaTester` er LÆSE-gaten (hvem må se
// funktionen), `engineWrite` er SKRIVE-gaten (må motoren/cronen bygge data op
// mens funktionen stadig er skjult). En batch-cron har ingen viewer og kan
// derfor ikke svare på "er DU beta-tester" — den skal spørge "er det en
// motor-skrivning". `off` lukker begge, uændret.

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

/**
 * @param {boolean|string|null} value  app_config-værdien (readFlagStage)
 * @param {object} [opts]
 * @param {boolean} [opts.isBetaTester] LÆSE-gate: denne viewer er beta-tester/admin.
 * @param {boolean} [opts.engineWrite]  SKRIVE-gate: kaldet er en motor-/cron-skrivning
 *   (ingen viewer). I `beta` skriver motoren skyggedata for ALLE, mens UI'et
 *   stadig kun er åbent for beta-testere. `off` stopper også dette.
 */
export function evaluateFlagStage(value, { isBetaTester = false, engineWrite = false } = {}) {
  if (value === true || value === "on") return true;
  if (value === "beta") return engineWrite === true || isBetaTester === true;
  return false;
}

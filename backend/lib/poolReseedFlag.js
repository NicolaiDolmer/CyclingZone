// #2557 spor B · Gate for STYRKE-BALANCERET PULJE-RESEED ved sæsonovergangen.
// Bor i app_config (key/value) → flippes runtime UDEN re-deploy, præcis som
// seasonEndMovementFlag.js (#2851) og autoCalendarFlag.js.
//
// DEFAULT = OFF. Fail-safe: manglende nøgle, ukendt værdi eller fejlet opslag
// → false → sæsonovergangen opfører sig NØJAGTIG som i dag (kun op/nedrykning,
// ingen reseed). Flaget aktiveres kun efter ejer-go + sim-harness-kørsel
// (simulér-før-ship), jf. docs/audits/2026-08-03-team-dominance-2557.md.
//
// Tærsklen er en SEPARAT nøgle, så den kan kalibreres uden kode-deploy. Den
// læses kun når flaget er på.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { DEFAULT_RESEED_THRESHOLD } from "./poolBalance.js";

export const POOL_RESEED_FLAG_KEY = "season_end_pool_reseed";
export const POOL_RESEED_THRESHOLD_KEY = "season_end_pool_reseed_threshold";

/** True kun ved eksplicit 'on'/true i app_config. Alt andet (inkl. fejl) = false. */
export async function isPoolReseedEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, POOL_RESEED_FLAG_KEY), opts);
}

/**
 * Dominans-margin-tærsklen: en tier re-seedes kun hvis dens skævheds-indeks er
 * STØRRE end denne. Ugyldig/negativ/manglende værdi → DEFAULT_RESEED_THRESHOLD,
 * så en tastefejl i app_config aldrig kan gøre tærsklen 0 (= re-seed alt).
 *
 * @returns {Promise<number>}
 */
export async function readPoolReseedThreshold(supabase) {
  const raw = await readFlagStage(supabase, POOL_RESEED_THRESHOLD_KEY);
  // KUN tal og tal-strenge. Ikke `Number(raw)` på vilkårlige typer: `Number(true)`
  // er 1, så en boolean i den forkerte nøgle ville sætte tærsklen til 1 og
  // re-seede stort set hele pyramiden.
  let n = NaN;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RESEED_THRESHOLD;
  return n;
}

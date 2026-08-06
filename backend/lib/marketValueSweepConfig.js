// #3448 · Config-gates for det markedsdrevne værdi-eftersyn (søndags-sweep).
// Samme mønster som wageDeductionConfig.js/poolReseedFlag.js/transferPriceBand.js:
// nøglerne bor i app_config, IKKE hardcodet, så ejeren kan justere/slå til uden
// deploy. Alle tre nøgler seedes 'off'/default af
// database/2026-08-06-3448-market-value-sweep.sql — denne fil er INERT indtil
// market_value_sweep_enabled flippes til 'on' (planlagt søndag 9/8 per ejer-go
// 6/8: 50/50-blend + ±25 %-loft, se #3448 kommentar 3).
//
// Fail-safe-retning: enhver læse-fejl (DB nede, netværk, malformed value) falder
// tilbage til DISABLED — samme tilstand som "ingen konfiguration sat endnu". Det
// er en økonomi-mutation af hele populationen; den sikre retning er altid at IKKE
// køre, aldrig at køre med gættede parametre.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const MARKET_VALUE_SWEEP_ENABLED_KEY = "market_value_sweep_enabled";
export const MARKET_VALUE_GLOBAL_WEIGHT_KEY = "market_value_global_weight";
export const MARKET_VALUE_WEEKLY_CAP_KEY = "market_value_weekly_cap";

export const DEFAULT_GLOBAL_WEIGHT = 0.5;
export const DEFAULT_WEEKLY_CAP = 0.25; // ejer-besluttet ±25 % (chat 6/8, dokumenteret på #3448 kommentar 3).

/** True kun ved eksplicit 'on'/true i app_config. Alt andet (inkl. fejl) = false. */
export async function isMarketValueSweepEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, MARKET_VALUE_SWEEP_ENABLED_KEY), opts);
}

function readNumberOrDefault(raw, { fallback, min, max }) {
  let n = NaN;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (min != null && n < min) return fallback;
  if (max != null && n > max) return fallback;
  return n;
}

/**
 * Global markedsvægt (0-1, FØR support-multiplikation) — w_rider = globalWeight
 * × support(rider). Ugyldig/manglende værdi ⇒ DEFAULT_GLOBAL_WEIGHT (0.5, samme
 * som issue #3448's simulerede scorecard brugte for ugerne 9/8+16/8).
 * @returns {Promise<number>}
 */
export async function readMarketValueGlobalWeight(supabase) {
  const raw = await readFlagStage(supabase, MARKET_VALUE_GLOBAL_WEIGHT_KEY);
  return readNumberOrDefault(raw, { fallback: DEFAULT_GLOBAL_WEIGHT, min: 0, max: 1 });
}

/**
 * Ugentligt pr.-rytter ændrings-loft (0-1, eksklusiv 0 — 0 ville fastfryse alt).
 * Ugyldig/manglende værdi ⇒ DEFAULT_WEEKLY_CAP (±25 %, ejer-besluttet 6/8 ud
 * fra #3448's konvergens-simulering).
 * @returns {Promise<number>}
 */
export async function readMarketValueWeeklyCap(supabase) {
  const raw = await readFlagStage(supabase, MARKET_VALUE_WEEKLY_CAP_KEY);
  return readNumberOrDefault(raw, { fallback: DEFAULT_WEEKLY_CAP, min: 0.0001, max: 1 });
}

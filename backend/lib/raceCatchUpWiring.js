// #6950 valg A: catch-up via loeb koblet ind i motoren, bag flaget
// `race_day_catchup_enabled` (slukket).
//
// Modulet med reglerne er raceDayCatchup6950.js (S13, S14, S16). Her bor kun
// flaget, de private params og oversaettelsen til applyDailyTick-argumenter.
//
// ═══ HVAD KOBLINGEN GOER PAA EN LOEBSDAG ═════════════════════════════════════
// De to dele taendes ALTID sammen (se docblokken i raceDayCatchup6950.js):
//   1. S13: traener og facilitet ud af loebsdagens tick (staff/facilityTier null).
//   2. Loebets ekstra som en multiplikator pr. evne, KUN paa etapens profil-evner.
//      Den ganges paa tick'ets delta uden for scorekoblingen (del 2-spec §5), saa
//      traener og facilitet ikke sniger sig ind i det ekstra igen via scoren.
// Traeningsdage roeres aldrig.
//
// ═══ SAMMEN MED UDVIKLINGSSCORE B ════════════════════════════════════════════
// Naar Udviklingsscore B er taendt, ejer scoren loebsdagen (S22: scoren ER
// udviklingen). Scorens loebsdag bygger allerede S13 og S14 ind (ingen traener og
// facilitet, tillaeg, afgoerelse, niveau). Catch-up-koblingen giver da ingen
// ekstra multiplikator, ellers ville loebets ekstra blive talt to gange.
//
// ═══ GULV ════════════════════════════════════════════════════════════════════
// Koblingen taendes kun sammen med maks +1 pr. evne pr. dato (#7075), af samme
// grund som scoren: loebets ekstra maa aldrig give to point paa én dato.
//
// ═══ TAL ═════════════════════════════════════════════════════════════════════
// Private (hard rule 17), i serverens miljoe (RACE_DAY_CATCHUP_PARAMS, JSON med
// noeglerne fra assertCatchupConfig). Loggen naevner aldrig tallene.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { readConditionWriterFlag } from "./trainingDateConditionFlag.js";
import {
  assertCatchupConfig, raceDayCatchupAbilityMultiplier, raceDayCatchupTickOverrides,
} from "./raceDayCatchup6950.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

export const RACE_DAY_CATCHUP_FLAG_KEY = "race_day_catchup_enabled";
export const RACE_DAY_CATCHUP_PARAMS_ENV = "RACE_DAY_CATCHUP_PARAMS";
const LOG_TAG = "[race-catchup]";

/** Parser og validerer params fra miljoeet. Ugyldig eller manglende = null. */
export function raceCatchUpParamsFromEnv(env = process.env) {
  const raw = env?.[RACE_DAY_CATCHUP_PARAMS_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return assertCatchupConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Flaget. Kun "on" (eller true) taender; "beta" laeses som off. */
export async function isRaceCatchUpEnabled(supabase, { strict = false } = {}) {
  if (strict) return readConditionWriterFlag(supabase, RACE_DAY_CATCHUP_FLAG_KEY);
  return evaluateFlagStage(await readFlagStage(supabase, RACE_DAY_CATCHUP_FLAG_KEY));
}

/**
 * Konfigurationen motoren skal bruge i dag, eller null (dagens model): flaget
 * slukket, params mangler/ugyldige, eller dato-loftet (#7075) slukket.
 */
export async function loadRaceCatchUp({
  supabase, env = process.env, log = console, strict = false, capPerDateOn = false,
}) {
  if (!(await isRaceCatchUpEnabled(supabase, { strict }))) return null;
  const cfg = raceCatchUpParamsFromEnv(env);
  if (!cfg) {
    log?.warn?.(`${LOG_TAG} ${RACE_DAY_CATCHUP_FLAG_KEY} is on, but ${RACE_DAY_CATCHUP_PARAMS_ENV} is missing or invalid - running today's model`);
    return null;
  }
  if (!capPerDateOn) {
    log?.warn?.(`${LOG_TAG} ${RACE_DAY_CATCHUP_FLAG_KEY} is on, but the max one point per ability per date rule is off - running today's model`);
    return null;
  }
  return cfg;
}

/**
 * Ekstra applyDailyTick-argumenter for én rytter. Tomt objekt = dagens model.
 *
 * Kun paa en loebsdag med koblingen taendt og Udviklingsscore B slukket. Data om
 * afgoerelse og feltets niveau findes ikke fra loebsmotoren endnu; uden dem
 * giver modulet kun det faste tillaeg (ingen niveau- eller afgoerelses-bonus).
 */
export function raceCatchUpTickArgs({
  cfg, racedToday = false, developmentScoreOn = false, program,
  riderRating = null, fieldRating = null, decision = null, finished = true,
}) {
  if (!cfg || !racedToday || developmentScoreOn) return {};
  const focusAbilities = program?.focusAbilities ?? [];
  const abilityYieldMult = {};
  for (const ability of VISIBLE_ABILITIES) {
    const mult = raceDayCatchupAbilityMultiplier({
      ability, focusAbilities, riderLevel: riderRating, fieldLevel: fieldRating,
      decision: decision ?? undefined, finished, cfg,
    });
    if (mult !== 1) abilityYieldMult[ability] = mult;
  }
  return { ...raceDayCatchupTickOverrides(), abilityYieldMult };
}

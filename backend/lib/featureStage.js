// Eneste sted flag-stage læses + evalueres. Tre-tilstand: "off" | "beta" | "on".
// Bagudkompatibel: boolean true/false fra gammelt skema honoreres som on/off.
// Fail-safe: manglende/ukendt værdi eller fejl → ingen adgang.
//
// #4839: `beta` har TO gates, ikke én. `isBetaTester` er LÆSE-gaten (hvem må se
// funktionen), `engineWrite` er SKRIVE-gaten (må motoren/cronen bygge data op
// mens funktionen stadig er skjult). En batch-cron har ingen viewer og kan
// derfor ikke svare på "er DU beta-tester" — den skal spørge "er det en
// motor-skrivning". `off` lukker begge, uændret.
//
// ── #7663: kort cache på opslaget ──────────────────────────────────────────
// Backenden læste app_config ved næsten hvert request, ofte den samme nøgle
// mange gange i samme sekund. Et vellykket opslag huskes nu kort pr. klient og
// nøgle, og samtidige opslag af samme nøgle deler ét DB-kald. Tre regler holder
// cachen ufarlig:
//
//  1. Et opslagsfejl caches ALDRIG og falder ALDRIG tilbage til en gammel
//     værdi. Fejl giver null (= off) præcis som før, så en fejl aldrig kan
//     blive til "tændt" — heller ikke via et tidligere "on" i cachen.
//  2. Kontakter der ændrer løbs- eller træningsresultater, som er nødstop for
//     et live system, eller som har deres egen cache hos kalderen, læses
//     friskt hver gang (FRESH_FLAG_KEYS).
//     Motoren læser dem én gang pr. afvikling som i dag, og et nødstop virker
//     ved næste afvikling uden at vente på cachen. En test vogter listen mod
//     motorens egne imports, så en ny motor-kontakt ikke kan glide ind i cachen.
//  3. Cachen hænger på klient-objektet (WeakMap). Tests med deres egne
//     fake-klienter deler derfor aldrig cache med hinanden eller med prod.

/** Hvor længe et vellykket opslag genbruges. Issue #7663: 30-60 s. */
export const FLAG_CACHE_TTL_MS = 60_000;

/**
 * Nøgler der aldrig caches: motor/træning (ændrer resultater) og live-systemers
 * nødstop. featureStage.test.js scanner motorens imports og fejler, hvis en
 * kontakt motoren læser mangler her.
 */
export const FRESH_FLAG_KEYS = Object.freeze(new Set([
  // Løbsmotoren (raceRunner/raceSimulator og deres direkte flag-moduler)
  "race_engine_v2_enabled",
  "race_engine_v3_scoring",
  "race_engine_v4",
  "race_form_peaks",
  "peak_planner_enabled",
  "race_stage_timeline",
  "race_finalize_resumable_enabled",
  "day_form_6649",
  "day_words_7725",
  "queen_stage_gap_7236",
  "stage_plan_dropped_front_7635",
  "descent_regroup_cap_7644",
  "split_attack_cause_7640",
  "let_go_order_7557",
  "itt_no_day_roll_7726",
  "started_field_lock_7733",
  "team_chase_7730",
  "time_limit_fatigue_7715",
  "route_profile_hills",
  "ai_team_retire_enabled",
  "ai_pool_retirement_v2_enabled",
  // Træningsmotoren (dailyTrainingEngine, aftenopgørelsen og deres direkte
  // flag-moduler). daily_training_enabled er træningens hovedafbryder.
  "daily_training_enabled",
  "training_tick_per_race_day",
  "ability_cap_per_date_enabled",
  "development_v2_aging_enabled",
  "development_score_v2",
  "development_curve_b",
  "development_xp_model",
  "training_program_cells",
  "training_catalog_v3",
  "training_fatigue_rules",
  "race_day_engine_enabled",
  "race_day_development_enabled",
  "race_day_role_yield_enabled",
  "race_day_role_base_day_enabled",
  "race_day_catchup_enabled",
  "fatigue_now_7801", // #7801: træningens regler og assistentens udtagelse på live-tallet
  // Nødstop for live systemer
  "stage_scheduler_enabled",
  "auto_prize_enabled",
  // Rytterværdi-modellen: skrive-stien skal læse friskt, og læse-fladerne har
  // allerede deres egen cache i riderValuationModelSelect.js (ingen dobbelt-cache).
  "rider_valuation_model",
  "rider_production_value_model",
  "rider_valuation_v6_market",
  "rider_value_phase_step",
]));

/** @type {WeakMap<object, Map<string, { value: any, expiresAt: number }>>} */
let valueCache = new WeakMap();
/** @type {WeakMap<object, Map<string, Promise<{ ok: boolean, value: any }>>>} */
let inflight = new WeakMap();

function mapFor(store, client) {
  let m = store.get(client);
  if (!m) {
    m = new Map();
    store.set(client, m);
  }
  return m;
}

async function queryFlagValue(supabase, key) {
  try {
    const { data, error } = await supabase
      .from("app_config").select("value").eq("key", key).maybeSingle();
    if (error) return { ok: false, value: null };
    return { ok: true, value: data?.value ?? null }; // boolean | "off"|"beta"|"on" | null
  } catch {
    // catch-ok: en kastet fejl er et opslagsfejl og giver null (= off), som før.
    // Den caches ikke (regel 1), så næste kald prøver igen.
    return { ok: false, value: null };
  }
}

/**
 * Læs app_config-værdien for `key`. Fejl → null (fail-safe = off).
 *
 * @param {any} supabase  supabase-klient (eller fake med `.from`)
 * @param {string} key
 * @param {{ fresh?: boolean, now?: () => number }} [opts]
 *   `fresh: true` springer cachen over for dette ene opslag.
 */
export async function readFlagStage(supabase, key, { fresh = false, now = Date.now } = {}) {
  if (!supabase?.from) return null;

  if (fresh || FRESH_FLAG_KEYS.has(key)) return (await queryFlagValue(supabase, key)).value;

  const values = mapFor(valueCache, supabase);
  const hit = values.get(key);
  if (hit && hit.expiresAt > now()) return hit.value;

  const pending = mapFor(inflight, supabase);
  let promise = pending.get(key);
  if (!promise) {
    promise = queryFlagValue(supabase, key).then((result) => {
      if (result.ok) {
        values.set(key, { value: result.value, expiresAt: now() + FLAG_CACHE_TTL_MS });
      } else {
        // Regel 1: en fejl må ikke efterlade en gammel værdi der kan læses som "on".
        values.delete(key);
      }
      return result;
    }).finally(() => {
      pending.delete(key);
    });
    pending.set(key, promise);
  }
  return (await promise).value;
}

/**
 * Glem cachede værdier. Uden argumenter: alt. Med `client`: kun den klients
 * cache, og med `client` + `key` kun den ene nøgle. Bruges af tests og kan
 * bruges af en admin-skrivning, der vil se sin ændring med det samme på denne
 * instans.
 *
 * @param {{ client?: object, key?: string }} [opts]
 */
export function clearFlagStageCache({ client, key } = {}) {
  if (!client) {
    valueCache = new WeakMap();
    inflight = new WeakMap();
    return;
  }
  const values = valueCache.get(client);
  if (!values) return;
  if (key === undefined) values.clear();
  else values.delete(key);
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

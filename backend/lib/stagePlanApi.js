// backend/lib/stagePlanApi.js
// #7003: etapeplanen i ordre-API'et (PUT /api/races/:raceId/team-orders/:stage).
// raceTeamOrdersApi.js kalder hertil med faa linjer; reglerne bor i stagePlan.ts.
//
// Gate (alle tre skal holde, ellers afvises `plan` som et ukendt felt, praecis som i dag):
//   1. stadie-flaget stage_plan_v1 er taendt for manageren (off | beta | on),
//   2. femtrins-indsatsen er taendt (grupetto/arbejd kraever den),
//   3. loebet koerer paa s5_profiles_v3 (den eneste revision hvor motoren laeser planen).
//
// Kaeden valideres mod etapens EGEN rute (race_stage_profiles) og rytterens
// EFFEKTIVE rolle paa etapen (holdudtagelsen + evt. etape-rolle fra race_stage_roles,
// samme rolle motoren faar), saa en plan API'et tager imod, aldrig ignoreres i motoren.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { isS5ProfilesV3OrLater, surfaceRulesRevision } from "./raceEngineRulesRevision.ts";
import {
  legacyOrderFromPlan,
  normalizeStagePlanLegs,
  stagePlanRouteFromRaw,
  validateStagePlanLegs,
} from "./stagePlan.ts";

export const STAGE_PLAN_FLAG_KEY = "stage_plan_v1";

/** Stadie-flaget for manageren (beta-testere ser det i beta). Fejl = false. */
export async function isStagePlanEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, STAGE_PLAN_FLAG_KEY), opts);
}

/** Kan etapeplanen bruges i dette loeb (revisionen)? `race` baerer engine_rules_revision + stages_completed. */
export function stagePlanRevisionOk(race) {
  return isS5ProfilesV3OrLater(surfaceRulesRevision({ race, storedRevision: race?.engine_rules_revision }));
}

// #7239: samme roller som motoren (stagePlanEngine.ts), saa en delt kaptajn valideres som leder.
const VALID_ROLES = new Set(["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"]);

/**
 * Konteksten til at validere planer for EN etape: rutens skift-punkter og rytternes
 * effektive rolle. Kaldes kun naar PUT-kroppen faktisk baerer en plan.
 */
export async function loadStagePlanContext({ supabase, raceId, stageNumber, baseRoleByRider }) {
  const riderIds = [...baseRoleByRider.keys()];
  const [profileRes, rolesRes] = await Promise.all([
    supabase
      .from("race_stage_profiles")
      .select("distance_km, profile_type, climbs")
      .eq("race_id", raceId)
      .eq("stage_number", stageNumber)
      .maybeSingle(),
    riderIds.length
      ? supabase
        .from("race_stage_roles")
        .select("rider_id, race_role")
        .eq("race_id", raceId)
        .eq("stage_number", stageNumber)
        .in("rider_id", riderIds) // pagination-safe: eet holds ryttere paa EN etape (maks feltstoerrelsen)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profileRes.error) throw new Error(`race_stage_profiles: ${profileRes.error.message}`);
  if (rolesRes.error) throw new Error(`race_stage_roles: ${rolesRes.error.message}`);
  const roleByRider = new Map();
  // #5982: luksushjaelperen er en hjaelper i planen (samme som motoren, entrantAdapter.ts).
  const planRole = (role) => (role === "luxury_helper" ? "helper" : role);
  for (const [riderId, role] of baseRoleByRider) roleByRider.set(riderId, VALID_ROLES.has(planRole(role)) ? planRole(role) : "free_role");
  for (const row of rolesRes.data || []) {
    if (VALID_ROLES.has(planRole(row.race_role))) roleByRider.set(row.rider_id, planRole(row.race_role));
  }
  return { route: stagePlanRouteFromRaw(profileRes.data), roleByRider, hasRoute: Boolean(profileRes.data) };
}

/** Baerer kroppen en plan paa mindst en rytter? */
export function orderHasStagePlan(order) {
  return Array.isArray(order?.riders) && order.riders.some((r) => r && typeof r === "object" && "plan" in r);
}

/**
 * Valider alle planer i kroppen. Returnerer foerste fejlkode eller null.
 * `plan: null` betyder "ingen plan" (rytteren koerer paa sin almindelige ordre).
 */
export function validateRiderPlans(riders, { route, roleByRider, hasRoute = true }) {
  for (const r of riders ?? []) {
    if (!r || typeof r !== "object" || !("plan" in r) || r.plan === null) continue;
    if (!hasRoute) return "stage_plan_no_route";
    const error = validateStagePlanLegs(r.plan, roleByRider.get(r.rider_id) ?? "free_role", route);
    if (error) return error;
  }
  return null;
}

/**
 * En normaliseret rytter-raekke med plan: de gamle felter udledes af kaeden
 * (bagudkompatibilitet, se stagePlan.ts), og kaeden gemmes i kanonisk form.
 * Uden plan: raekken uaendret.
 */
export function withStagePlan(normalizedRider, rawRider) {
  if (!Array.isArray(rawRider?.plan) || rawRider.plan.length === 0) return normalizedRider;
  const plan = normalizeStagePlanLegs(rawRider.plan);
  return { ...normalizedRider, ...legacyOrderFromPlan(plan), plan };
}

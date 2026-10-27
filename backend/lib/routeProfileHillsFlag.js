// #7290 (trin 2 af #7289): kontakten for "motoren koerer bakkerne fra hoejdeprofilen".
// Spec: docs/superpowers/specs/2026-10-27-7289-motor-hoejdeprofil-design.md
//
// route_profile_hills bor i app_config (samme moenster som race_form_peaks i
// raceEngineFlag.js). Slukket ved merge: raekken findes ikke -> false. Fail closed:
// en fejl i opslaget = slukket.
//
// Kontakten virker KUN under regel-revision s5_profiles_v3 (og senere). Den naar
// motoren som en markoer paa etape-raekkerne (ROUTE_PROFILE_HILLS_ROW_KEY), som
// routeAdapter.routeFromStageProfileRow laeser. Markoeren foelger raekken alle de
// steder broen kalder adapteren og ligger i motor-inputtet genafspilningen gemmer.
// Aeldre revisioner og slukket kontakt faar ingen markoer: raekkerne er uaendrede.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { isS5ProfilesV3OrLater } from "./raceEngineRulesRevision.ts";
import { ROUTE_PROFILE_HILLS_ROW_KEY } from "./engine/v4/adapters/routeProfileHills7289.ts";

export const ROUTE_PROFILE_HILLS_FLAG_KEY = "route_profile_hills";
export { ROUTE_PROFILE_HILLS_ROW_KEY };

export async function isRouteProfileHillsEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, ROUTE_PROFILE_HILLS_FLAG_KEY), opts);
}

/** Skal profilens bakker koeres for et loeb paa denne revision med flaget i denne tilstand? */
export function routeProfileHillsActive({ enabled, rulesRevision }) {
  return enabled === true && isS5ProfilesV3OrLater(rulesRevision);
}

/**
 * Saet markoeren paa etape-raekkerne naar kontakten er aktiv (muterer raekkerne,
 * som raceRunner allerede goer med `peakDay`). Returnerer om den blev sat, saa
 * kaldstedet kan laegge `profileHills: true` i run-identiteten (input_checksum).
 * Inaktiv = raekkerne roeres ikke.
 */
export function markStagesForProfileHills(stages, { enabled, rulesRevision }) {
  if (!routeProfileHillsActive({ enabled, rulesRevision }) || !Array.isArray(stages)) return false;
  for (const stage of stages) if (stage && typeof stage === "object") stage[ROUTE_PROFILE_HILLS_ROW_KEY] = true;
  return true;
}

/**
 * Hent etapernes hoejdeprofil (#7303 Codex P2): raceRunners STAGE_PROFILE_COLUMNS
 * indeholder ikke elevation_profile, saa uden dette ville markoeren aendre checksummen
 * uden at motoren saa en eneste bakke. Hentes KUN naar kontakten er aktiv, saa alle
 * andre loeb laeser praecis som foer.
 */
export async function loadStageElevationProfiles(supabase, raceId) {
  const { data, error } = await supabase.from("race_stage_profiles").select("stage_number, elevation_profile").eq("race_id", raceId);
  if (error) throw new Error(`race_stage_profiles.elevation_profile: ${error.message ?? error}`);
  return new Map((data ?? []).map((r) => [Number(r.stage_number), r.elevation_profile ?? null]));
}

/**
 * Laes flaget, hent hoejdeprofilen og saet markoeren i eet kald (raceRunners kobling).
 * Fail closed: fejler flag- eller profil-opslaget, roeres raekkerne ikke.
 * @returns {Promise<boolean>} om markoeren blev sat
 */
export async function applyRouteProfileHills({ supabase, raceId, stages, rulesRevision, checkEnabled = isRouteProfileHillsEnabled, loadElevation = loadStageElevationProfiles }) {
  if (!isS5ProfilesV3OrLater(rulesRevision)) return false;
  const enabled = await Promise.resolve().then(() => checkEnabled(supabase)).catch(() => false);
  if (!routeProfileHillsActive({ enabled, rulesRevision }) || !Array.isArray(stages)) return false;
  const byStage = await Promise.resolve().then(() => loadElevation(supabase, raceId)).catch(() => null);
  if (!(byStage instanceof Map)) return false;
  for (const stage of stages) {
    if (stage && typeof stage === "object" && byStage.has(Number(stage.stage_number))) stage.elevation_profile = byStage.get(Number(stage.stage_number));
  }
  return markStagesForProfileHills(stages, { enabled, rulesRevision });
}

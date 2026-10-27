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
 * Laes flaget og saet markoeren i eet kald (raceRunners kobling). Fail closed.
 * @returns {Promise<boolean>} om markoeren blev sat
 */
export async function applyRouteProfileHills({ supabase, stages, rulesRevision, checkEnabled = isRouteProfileHillsEnabled }) {
  if (!isS5ProfilesV3OrLater(rulesRevision)) return false;
  const enabled = await Promise.resolve().then(() => checkEnabled(supabase)).catch(() => false);
  return markStagesForProfileHills(stages, { enabled, rulesRevision });
}

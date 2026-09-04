// #1099 spec §8: `rider_reputation_enabled` i `app_config` styrer omdømme-
// systemets udrulning i TRE stadier — samme app_config-mønster som
// `raceFinalizeResumableFlag.js`, men med et andet mellemstadie:
//
//   off     (default)  intet beregnes, intet skrives, ingen læser.
//   shadow             hændelser + riders.reputation SKRIVES ved løbsafslutning,
//                      men INGEN forbruger (bestyrelse, marked, UI) læser tallet.
//   on                 forbrugerne læser tallet.
//
// featureStage.js's `evaluateFlagStage` kan ikke bruges direkte: dens
// mellemstadie er "beta" (per-bruger), mens vores er "shadow" (global skrive-
// tilstand uden læsere). Læsningen af selve værdien deles dog — readFlagStage
// er stedet hvor app_config tilgås.
//
// Fail-safe: manglende nøgle, ukendt værdi eller DB-fejl → "off". Med "off" er
// adfærden bit-identisk med før #1099: hook'en returnerer før den rører
// motoren, og der skrives ingen rækker.

import { readFlagStage } from "./featureStage.js";

export const RIDER_REPUTATION_FLAG_KEY = "rider_reputation_enabled";

export const REPUTATION_STAGE = Object.freeze({
  OFF: "off",
  SHADOW: "shadow",
  ON: "on",
});

/**
 * Normalisér en rå app_config-værdi til et stadie. Ren funktion (testbar uden DB).
 * Bagudkompatibel med boolean-skemaet: true → on, false → off.
 */
export function normalizeReputationStage(value) {
  if (value === true || value === REPUTATION_STAGE.ON) return REPUTATION_STAGE.ON;
  if (value === REPUTATION_STAGE.SHADOW) return REPUTATION_STAGE.SHADOW;
  return REPUTATION_STAGE.OFF;
}

export async function readReputationStage(supabase) {
  return normalizeReputationStage(await readFlagStage(supabase, RIDER_REPUTATION_FLAG_KEY));
}

/** Skal løbsafslutningen beregne + persistere? (shadow ELLER on) */
export function isReputationWriteEnabled(stage) {
  const normalized = normalizeReputationStage(stage);
  return normalized === REPUTATION_STAGE.SHADOW || normalized === REPUTATION_STAGE.ON;
}

/** Må en FORBRUGER (bestyrelse, marked, UI) læse tallet? (kun on) */
export function isReputationReadEnabled(stage) {
  return normalizeReputationStage(stage) === REPUTATION_STAGE.ON;
}

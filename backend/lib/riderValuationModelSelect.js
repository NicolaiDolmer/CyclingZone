// #5443 · Hvilken værdimodel produktionen regner med. ÉN nøgle, ÉT skridt.
//
// Samme mønster som marketValueSweepConfig.js / wageDeductionConfig.js: valget
// bor i app_config, IKKE i koden, så ejeren kan tænde den nye model uden deploy
// — og slukke den igen lige så hurtigt hvis tallene ikke ser rigtige ud.
//
//   app_config.rider_valuation_model = 'v4'  (default, og alt andet)  → v4, uændret
//   app_config.rider_valuation_model = 'v5'                           → v5 (#5443)
//
// Nøglen seedes til 'v4' af database/2026-09-20-5443-rider-valuation-model.sql,
// så MERGE ALENE ÆNDRER INGEN VÆRDIER. Det er hele kontrakten om denne PR:
// modellen ligger klar, men den træder først i kraft når ejeren har set en frisk
// tørkørsel og selv flipper nøglen (ejer-godkendt rækkefølge, #5443 20/9).
//
// FAIL-SAFE-RETNING: enhver læsefejl (DB nede, netværk, ukendt værdi) falder
// tilbage til v4 — altså til den model der allerede er live. En værdimodel må
// aldrig kunne skifte sig selv på en tavs fejl; den sikre retning er "bliv hvor
// du er", aldrig "gæt den nye".
//
// KADENCE: modellen læses ved hver kørsel, ikke ved boot. Flipper ejeren nøglen
// mellem to søndage, gælder den fra næste kørsel — ingen genstart.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readFlagStage } from "./featureStage.js";
import { applyTypeDampening } from "./riderValuationTypeDampening.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const RIDER_VALUATION_MODEL_KEY = "rider_valuation_model";
export const DEFAULT_VALUATION_MODEL_ID = "v4";

const MODEL_PATHS = Object.freeze({
  v4: join(__dirname, "./riderValuationModelV4.json"),
  v5: join(__dirname, "./riderValuationModelV5.json"),
});

export const VALUATION_MODEL_IDS = Object.freeze(Object.keys(MODEL_PATHS));

/**
 * Normalisér app_config-værdien til et kendt model-id. Alt ukendt — null,
 * tom streng, "V6", et tal, et objekt — giver defaulten. Ren funktion, så
 * testen kan dække hele tabellen uden en DB.
 * @param {unknown} raw
 * @returns {"v4"|"v5"}
 */
export function resolveValuationModelId(raw) {
  const id = typeof raw === "string" ? raw.trim().toLowerCase() : null;
  return id && Object.hasOwn(MODEL_PATHS, id) ? id : DEFAULT_VALUATION_MODEL_ID;
}

const cache = new Map();

/**
 * Indlæs ét model-id fra disk, dæmpnings-behandlet som produktionen kræver.
 * applyTypeDampening() respekterer både det globale TYPE_DAMPENING_ENABLED-flag
 * (v4's tilstand, uændret) og modellens eget `type_dampening: "off"` (#5443).
 * Filen læses én gang pr. proces — model-JSON'erne er committede artefakter.
 * @param {"v4"|"v5"} id
 */
export function loadValuationModelById(id) {
  const key = resolveValuationModelId(id);
  if (!cache.has(key)) {
    cache.set(key, applyTypeDampening(JSON.parse(readFileSync(MODEL_PATHS[key], "utf8"))));
  }
  return cache.get(key);
}

/**
 * Den model produktionen skal regne med LIGE NU. Kaldes af hver værdi-skrivende
 * kørsel (søndags-refresh, sæson-transition), ikke ved modul-load.
 * @param {object} supabase
 * @returns {Promise<object>} model-objektet (aldrig null)
 */
export async function loadValuationModel(supabase) {
  const id = resolveValuationModelId(await readFlagStage(supabase, RIDER_VALUATION_MODEL_KEY));
  return loadValuationModelById(id);
}

/** Model-id'et alene, uden at indlæse filen (til logning/tørkørsel). */
export async function readValuationModelId(supabase) {
  return resolveValuationModelId(await readFlagStage(supabase, RIDER_VALUATION_MODEL_KEY));
}

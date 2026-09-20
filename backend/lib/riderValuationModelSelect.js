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
//
// ── TO NØGLER, IKKE ÉN (#5443, ejer-beslutning 20/9 aften) ───────────────────
// `base_value` (prisen) og `current_production_value` (løngrundlaget, 35 % jf.
// ECONOMY_RULES §2) regnes af den SAMME funktionskæde, men de er to forskellige
// spilregler og må kunne skifte model hver for sig:
//
//   rider_valuation_model         → base_value (prisen spilleren køber/sælger til)
//   rider_production_value_model  → current_production_value (løngrundlaget)
//
// Ejerens ord: "Løn skal ikke følge værdi". Løngrundlaget bliver derfor på v4
// indtil forlængelserne ved sæsonskiftet er overstået, også når prisen er
// flippet til v5. Begge nøgler seedes 'v4' og har samme fail-safe: ukendt
// værdi, manglende række eller læsefejl ⇒ v4.
//
// ── CACHE: pr. KØRSEL for batch, kort TTL for request-stien ──────────────────
// Batch-kørslerne (søndags-refresh, sæson-transition, backfill) læser nøglen ÉN
// gang pr. kørsel via loadValuationModel/loadProductionValueModel — en kørsel
// skal regne hele populationen med den samme model, også hvis ejeren flipper
// nøglen midt i den.
//
// Request-stierne (api.js's rytterkort, værdi-trend, admin-preview) må derimod
// ikke lave et app_config-opslag pr. request. De bruger
// loadValuationModelCached(), som holder MODEL-ID'et i ca. et minut og
// af-dublerer samtidige opslag. Konsekvensen af TTL'en er kendt og acceptabel:
// efter et flip kan en preview-flade vise det gamle tal i op til et minut. Den
// eneste sti der SKRIVER, er batch-stien, og den cacher ikke.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readFlagStage } from "./featureStage.js";
import { applyTypeDampening } from "./riderValuationTypeDampening.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const RIDER_VALUATION_MODEL_KEY = "rider_valuation_model";
// #5443 ejer-beslutning 2 (20/9 aften): løngrundlaget har sin EGEN nøgle, så
// prisen kan flyttes til v5 uden at fremtidige lønkrav flytter sig med.
export const RIDER_PRODUCTION_VALUE_MODEL_KEY = "rider_production_value_model";
export const DEFAULT_VALUATION_MODEL_ID = "v4";

// Hvor længe et model-id må genbruges på request-stien uden et nyt
// app_config-opslag. Kort nok til at et flip slår igennem af sig selv, langt
// nok til at et rytterkort ikke koster et ekstra DB-kald pr. visning.
export const MODEL_ID_CACHE_TTL_MS = 60_000;

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
 * Den model produktionen skal regne PRISEN med LIGE NU. Kaldes af hver
 * værdi-skrivende kørsel (søndags-refresh, sæson-transition), ikke ved
 * modul-load.
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

/**
 * Den model LØNGRUNDLAGET (current_production_value) skal regnes med LIGE NU.
 * Egen nøgle, egen fail-safe — se topkommentaren.
 * @param {object} supabase
 * @returns {Promise<object>} model-objektet (aldrig null)
 */
export async function loadProductionValueModel(supabase) {
  return loadValuationModelById(await readProductionValueModelId(supabase));
}

/** Løngrundlagets model-id alene (til logning/tørkørsel). */
export async function readProductionValueModelId(supabase) {
  return resolveValuationModelId(await readFlagStage(supabase, RIDER_PRODUCTION_VALUE_MODEL_KEY));
}

// ── STRIKS læsning til de kørsler der skriver HELE populationen ─────────────
//
// `readFlagStage` gør enhver læsefejl til null, og null giver v4. Det er den
// rigtige fail-safe for en enkelt rytter og for en læse-flade: hellere den
// model der allerede er live end et gæt.
//
// For en kørsel der skriver HVER ENESTE rytter er regnestykket et andet. Står
// nøglen på v5, og svarer app_config ikke i netop det sekund, ville den
// lempelige læsning revaluere hele markedet TILBAGE til v4 — tavst, og uden at
// nogen har flippet noget. Det er den samme klasse skade som en utilsigtet
// tænding, bare i den anden retning.
//
// Derfor: for søndagskørslen og sæson-transitionen er "kunne ikke læse nøglen"
// en grund til IKKE at køre. Søndags-pipelinen frigiver selv dagens claim og
// prøver igen næste time (sundayValueSweep.js), så prisen for at stoppe er en
// times forsinkelse — mod en fejlagtig revaluering af hele populationen.
//
// En manglende række eller en ukendt værdi er IKKE en fejl: den giver v4 som
// altid. Det er kun en ægte DB-/netværksfejl der stopper kørslen.
async function readModelIdStrict(supabase, key) {
  if (!supabase?.from) {
    throw new Error(`valuation-model: ingen supabase-klient til opslag af '${key}'`);
  }
  const { data, error } = await supabase
    .from("app_config").select("value").eq("key", key).maybeSingle();
  if (error) {
    throw new Error(
      `valuation-model: kunne ikke laese app_config.${key} (${error.message}). `
      + "Koerslen stoppes: at skrive hele populationen med en gaettet model er "
      + "farligere end at vente til naeste forsoeg."
    );
  }
  return resolveValuationModelId(data?.value ?? null);
}

/** Prisens model til en kørsel der skriver hele populationen. Kaster ved læsefejl. */
export async function loadValuationModelStrict(supabase) {
  return loadValuationModelById(await readModelIdStrict(supabase, RIDER_VALUATION_MODEL_KEY));
}

/** Løngrundlagets model til samme kørsler. Kaster ved læsefejl. */
export async function loadProductionValueModelStrict(supabase) {
  return loadValuationModelById(await readModelIdStrict(supabase, RIDER_PRODUCTION_VALUE_MODEL_KEY));
}

// ── Request-stien: kort TTL + af-duplikering af samtidige opslag ─────────────
// Værdien vi cacher er MODEL-ID'et (en streng), ikke model-objektet: selve
// JSON'en ligger allerede i `cache` ovenfor og læses kun én gang pr. proces.
const idCache = new Map(); // key -> { id, expiresAt }
const inFlight = new Map(); // key -> Promise<string>

/** Nulstil begge caches. Kun til tests — produktionen har ingen grund til det. */
export function resetValuationModelCache() {
  idCache.clear();
  inFlight.clear();
}

async function readModelIdCached(supabase, key, { ttlMs = MODEL_ID_CACHE_TTL_MS, now = Date.now } = {}) {
  const t = now();
  const hit = idCache.get(key);
  if (hit && hit.expiresAt > t) return hit.id;
  // Af-duplikering: 50 samtidige rytterkort efter et cache-udløb må give ÉT
  // app_config-opslag, ikke 50.
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      // readFlagStage sluger selv fejl og returnerer null ⇒ resolve giver v4.
      // Vi cacher derfor også et fail-safe-svar: alternativet er at hamre på en
      // DB der lige nu er nede, én gang pr. request.
      const id = resolveValuationModelId(await readFlagStage(supabase, key));
      idCache.set(key, { id, expiresAt: now() + ttlMs });
      return id;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/**
 * Prisens model til LÆSE-flader (api.js). Kort cache, aldrig til skrivninger.
 * @returns {Promise<object>} model-objektet (aldrig null)
 */
export async function loadValuationModelCached(supabase, opts) {
  return loadValuationModelById(await readModelIdCached(supabase, RIDER_VALUATION_MODEL_KEY, opts));
}

/** Løngrundlagets model til LÆSE-flader. Samme cache-kontrakt som ovenfor. */
export async function loadProductionValueModelCached(supabase, opts) {
  return loadValuationModelById(await readModelIdCached(supabase, RIDER_PRODUCTION_VALUE_MODEL_KEY, opts));
}

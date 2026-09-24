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
import { isTypefreeModel } from "./valuationTypefree/typefreeValuation.js";
import { hydrateMarketFit } from "./valuationTypefree/marketComponent.js";

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

// #5497 v3 (25/9): `v6` = den samlede typefri model (typefri grundværdi +
// elitepræmie i trin + marked). DEV-ONLY indtil ejeren har sagt "godkendt til
// build" i admin-forhåndsvisningen (#5686): nøglen er VALGBAR ad den rigtige
// sti, men app_config peger på v4, og intet i denne fil flytter den.
const MODEL_PATHS = Object.freeze({
  v4: join(__dirname, "./riderValuationModelV4.json"),
  v5: join(__dirname, "./riderValuationModelV5.json"),
  v6: join(__dirname, "./riderValuationModelV6Typefree.json"),
});

export const VALUATION_MODEL_IDS = Object.freeze(Object.keys(MODEL_PATHS));

// Løngrundlaget må ALDRIG følge den typefri model (ejer 20/9: "Løn skal ikke
// følge værdi"; #5497 v3: productionModel er stadig v4). v6 regner ikke et
// løngrundlag i v4's forstand, så en løn-nøgle på 'v6' behandles som ukendt
// og giver v4 — samme fail-safe-retning som alt andet ukendt.
export const PRODUCTION_VALUE_MODEL_IDS = Object.freeze(["v4", "v5"]);

// app_config-nøglen der bærer v6's markeds-fit (vægt, loft, fælles + lokal
// komponent). Tallene er ejer-valg og afledt af rigtige handler, så de står
// kun i prod-databasen / private filer, aldrig i repoet (hard rule 17 +
// ejerens valg-fil). Mangler nøglen, regner v6 uden marked (market_applied=false).
export const TYPEFREE_MARKET_APP_CONFIG = "rider_valuation_v6_market";

/**
 * Normalisér app_config-værdien til et kendt model-id. Alt ukendt — null,
 * tom streng, "V7", et tal, et objekt — giver defaulten. Ren funktion, så
 * testen kan dække hele tabellen uden en DB.
 * @param {unknown} raw
 * @returns {"v4"|"v5"|"v6"}
 */
export function resolveValuationModelId(raw) {
  const id = typeof raw === "string" ? raw.trim().toLowerCase() : null;
  return id && Object.hasOwn(MODEL_PATHS, id) ? id : DEFAULT_VALUATION_MODEL_ID;
}

/** Som resolveValuationModelId, men kun modeller der må bære løngrundlaget. */
export function resolveProductionValueModelId(raw) {
  const id = resolveValuationModelId(raw);
  return PRODUCTION_VALUE_MODEL_IDS.includes(id) ? id : DEFAULT_VALUATION_MODEL_ID;
}

const cache = new Map();

/**
 * Indlæs ét model-id fra disk, dæmpnings-behandlet som produktionen kræver.
 * applyTypeDampening() respekterer både det globale TYPE_DAMPENING_ENABLED-flag
 * (v4's tilstand, uændret) og modellens eget `type_dampening: "off"` (#5443).
 * Filen læses én gang pr. proces — model-JSON'erne er committede artefakter.
 * v6 har ingen type-offsets, så dæmpningen er en no-op for den.
 * @param {"v4"|"v5"|"v6"} id
 */
export function loadValuationModelById(id) {
  const key = resolveValuationModelId(id);
  if (!cache.has(key)) {
    cache.set(key, applyTypeDampening(JSON.parse(readFileSync(MODEL_PATHS[key], "utf8"))));
  }
  return cache.get(key);
}

// ── v6's markeds-fit ─────────────────────────────────────────────────────────
function parseMarketFit(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { return parseMarketFit(JSON.parse(raw)); } catch { return null; }
  }
  return typeof raw === "object" && hydrateMarketFit(raw) ? raw : null;
}

/**
 * Læg et markeds-fit på en typefri model. Andre modeller returneres uændret.
 * Ugyldigt fit → modellen uden marked. Ren funktion (ny objekt-identitet).
 */
export function withMarketFit(model, fit) {
  if (!isTypefreeModel(model)) return model;
  const parsed = parseMarketFit(fit);
  return parsed ? { ...model, market_fit: parsed } : model;
}

async function attachMarket(supabase, model, { strict = false } = {}) {
  if (!isTypefreeModel(model)) return model;
  if (strict) {
    if (!supabase?.from) throw new Error(`valuation-model: ingen supabase-klient til opslag af '${TYPEFREE_MARKET_APP_CONFIG}'`);
    const { data, error } = await supabase
      .from("app_config").select("value").eq("key", TYPEFREE_MARKET_APP_CONFIG).maybeSingle();
    if (error) {
      throw new Error(`valuation-model: kunne ikke laese app_config.${TYPEFREE_MARKET_APP_CONFIG} (${error.message}). Koerslen stoppes.`);
    }
    return withMarketFit(model, data?.value ?? null);
  }
  return withMarketFit(model, await readFlagStage(supabase, TYPEFREE_MARKET_APP_CONFIG));
}

/**
 * Som loadValuationModelById, men for v6 med markeds-fittet fra app_config lagt
 * på. Til admin-forhåndsvisningen (#5686) og tørkørsler, der skal vise den
 * pris modellen VIL skrive, inkl. markedet. Lempelig: læsefejl → uden marked.
 */
export async function loadValuationModelByIdWithMarket(supabase, id) {
  return attachMarket(supabase, loadValuationModelById(id));
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
  return attachMarket(supabase, loadValuationModelById(id));
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
  return resolveProductionValueModelId(await readFlagStage(supabase, RIDER_PRODUCTION_VALUE_MODEL_KEY));
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
async function readModelIdStrict(supabase, key, resolve = resolveValuationModelId) {
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
  return resolve(data?.value ?? null);
}

/**
 * Prisens model til en kørsel der skriver hele populationen. Kaster ved læsefejl.
 * v6: markeds-fittet læses også striks — kan det ikke læses, stopper kørslen
 * hellere end at skrive hele populationen uden marked.
 */
export async function loadValuationModelStrict(supabase) {
  const model = loadValuationModelById(await readModelIdStrict(supabase, RIDER_VALUATION_MODEL_KEY));
  return attachMarket(supabase, model, { strict: true });
}

/** Løngrundlagets model til samme kørsler. Kaster ved læsefejl. Aldrig v6. */
export async function loadProductionValueModelStrict(supabase) {
  return loadValuationModelById(
    await readModelIdStrict(supabase, RIDER_PRODUCTION_VALUE_MODEL_KEY, resolveProductionValueModelId)
  );
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

async function readModelIdCached(supabase, key, { ttlMs = MODEL_ID_CACHE_TTL_MS, now = Date.now, resolve = resolveValuationModelId } = {}) {
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
      const id = resolve(await readFlagStage(supabase, key));
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
  const model = loadValuationModelById(await readModelIdCached(supabase, RIDER_VALUATION_MODEL_KEY, opts));
  if (!isTypefreeModel(model)) return model;
  // v6: markeds-fittet caches med samme TTL som model-id'et.
  const t = (opts?.now ?? Date.now)();
  const hit = idCache.get(TYPEFREE_MARKET_APP_CONFIG);
  if (hit && hit.expiresAt > t) return hit.model;
  const withMarket = await attachMarket(supabase, model);
  idCache.set(TYPEFREE_MARKET_APP_CONFIG, { model: withMarket, expiresAt: t + (opts?.ttlMs ?? MODEL_ID_CACHE_TTL_MS) });
  return withMarket;
}

/** Løngrundlagets model til LÆSE-flader. Samme cache-kontrakt som ovenfor. Aldrig v6. */
export async function loadProductionValueModelCached(supabase, opts) {
  return loadValuationModelById(await readModelIdCached(supabase, RIDER_PRODUCTION_VALUE_MODEL_KEY, {
    ...opts, resolve: resolveProductionValueModelId,
  }));
}

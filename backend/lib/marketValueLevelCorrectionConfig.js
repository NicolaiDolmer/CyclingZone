// #3449/#3750 · Config-gates for niveau-korrektionens SØNDAGS-GATE (ikke selve
// korrektionen — den er en engangs owner-gated kørsel, se
// backend/scripts/marketValueLevelCorrectionApply.js). Samme mønster som
// marketValueSweepConfig.js: nøglerne bor i app_config, ikke hardcodet, så
// ejeren kan justere stabilitets-kravet uden deploy.
//
// EJER-BESLUTNING 19/8 (kontrakten denne fil implementerer): gaten kræver
// (a) mindst market_value_level_correction_min_qualified_trades kvalificerede
// forhandlede handler i et 90-dages-vindue, OG (b) at de seneste 3 ugentlige
// rullende 30-dages-medianer af pris/anker ligger parvis inden for
// ±market_value_level_correction_stability_band af hinanden. Seedet
// konservativt (40 / 0,15) — målingen 19/8 viser kanalen IKKE stabil endnu
// (0,665 → 0,775 → 0,908, sidste-vs-første spænd 0,243 > 0,15), så gaten SKAL
// stå RØD ved seed. Se docs/audits/2026-08-17-vaerdimodel-refit-scorecard.md
// og måle-noten 19/8 for tallene bag disse defaults.
//
// Fail-safe-retning: enhver læse-fejl falder tilbage til det KONSERVATIVE
// (strengeste) default — aldrig et løsere krav end seedet, for en gate der
// styrer en engangs-mutation af hele populationens værdier skal aldrig kunne
// blive "grønnere" af en fejl.

import { readFlagStage } from "./featureStage.js";

export const MARKET_VALUE_LEVEL_CORRECTION_MIN_QUALIFIED_TRADES_KEY =
  "market_value_level_correction_min_qualified_trades";
export const MARKET_VALUE_LEVEL_CORRECTION_STABILITY_BAND_KEY =
  "market_value_level_correction_stability_band";
// #3449 neutralitets-bundt (a): dræn-neutral bankrate. NULL/manglende (default)
// betyder "ingen korrektion har kørt endnu" — youthMarket.js falder tilbage til
// den hardcodede YOUTH_AUCTION_START_RATE, UÆNDRET adfærd. Skrives KUN af
// backend/scripts/marketValueLevelCorrectionApply.js's --confirm-apply-gren.
export const MARKET_VALUE_LEVEL_CORRECTION_YOUTH_RATE_OVERRIDE_KEY =
  "market_value_level_correction_youth_auction_start_rate";
// #3449 neutralitets-bundt (b): løn-neutral A. Findes IKKE i prod endnu — den
// anker-baserede lønformel (løn = A × (anker/100.000)^0,55) er #3393-reformen,
// ikke shippet på denne branch (se marketValueLevelCorrectionApply.js's
// header). Nøglen seedes alligevel her (NULL), så apply-scriptet har et sted
// at læse/skrive A FRA DEN DAG #3393 lander sin egen A-konfiguration — indtil
// da er løn-benet i bundtet en dokumenteret no-op (se apply-scriptets
// resolveWageNeutralLeg).
export const MARKET_VALUE_LEVEL_CORRECTION_WAGE_ANCHOR_A_KEY =
  "market_value_level_correction_wage_anchor_a";

export const DEFAULT_MIN_QUALIFIED_TRADES = 40;
export const DEFAULT_STABILITY_BAND = 0.15;

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
 * Minimum antal kvalificerede forhandlede handler i 90-dages-vinduet.
 * Ugyldig/manglende værdi ⇒ DEFAULT_MIN_QUALIFIED_TRADES (40, ejer-seedet 19/8).
 * @returns {Promise<number>}
 */
export async function readMinQualifiedTrades(supabase) {
  const raw = await readFlagStage(supabase, MARKET_VALUE_LEVEL_CORRECTION_MIN_QUALIFIED_TRADES_KEY);
  return readNumberOrDefault(raw, { fallback: DEFAULT_MIN_QUALIFIED_TRADES, min: 1, max: 100000 });
}

/**
 * Stabilitetsbånd (0-1) — maks. parvis afstand mellem de seneste 3 rullende
 * 30-dages-medianer af pris/anker. Ugyldig/manglende værdi ⇒
 * DEFAULT_STABILITY_BAND (±0,15, ejer-seedet 19/8).
 * @returns {Promise<number>}
 */
export async function readStabilityBand(supabase) {
  const raw = await readFlagStage(supabase, MARKET_VALUE_LEVEL_CORRECTION_STABILITY_BAND_KEY);
  return readNumberOrDefault(raw, { fallback: DEFAULT_STABILITY_BAND, min: 0.0001, max: 1 });
}

/**
 * Dræn-neutral override af YOUTH_AUCTION_START_RATE (neutralitets-bundt (a)).
 * NULL (ingen nøgle sat, ugyldig værdi, eller læse-fejl) betyder "brug den
 * hardcodede konstant" — fail-safe = UÆNDRET adfærd, aldrig en gættet rate.
 * @returns {Promise<number|null>}
 */
export async function readYouthAuctionStartRateOverride(supabase) {
  const raw = await readFlagStage(supabase, MARKET_VALUE_LEVEL_CORRECTION_YOUTH_RATE_OVERRIDE_KEY);
  return readNumberOrDefault(raw, { fallback: null, min: 0.0001, max: 1 });
}

/**
 * Løn-neutral A (neutralitets-bundt (b)). NULL indtil #3393's anker-baserede
 * lønformel shipper sin egen konfiguration — se konstantens kommentar ovenfor.
 * @returns {Promise<number|null>}
 */
export async function readWageAnchorA(supabase) {
  const raw = await readFlagStage(supabase, MARKET_VALUE_LEVEL_CORRECTION_WAGE_ANCHOR_A_KEY);
  return readNumberOrDefault(raw, { fallback: null, min: 1, max: 100_000_000 });
}

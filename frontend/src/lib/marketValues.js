import { formatNumber } from "./intl.js";

// #1101 cutover: DB-kolonnen market_value (GENERATED fra base_value + bonus) er
// sandheden. Fallback spejler DB'ens COALESCE(base_value, 1000). Aldrig uci_points.
const RIDER_BASE_VALUE_FALLBACK = 1000;

export function getRiderMarketValue(rider = {}) {
  if (Number.isFinite(Number(rider?.market_value))) return Number(rider.market_value);
  const base = Number(rider?.base_value) > 0 ? Number(rider.base_value) : RIDER_BASE_VALUE_FALLBACK;
  return base + (Number(rider?.prize_earnings_bonus) || 0);
}

// ── Løn-grundlag (SKAL spejle backend economyConstants.js + salaryBasis.js) ──────
//
// #3360: lønnen prissættes efter MARKEDSVÆRDIEN via en konkav kurve, ikke efter
// current_production_value. Grunden: cpv er nærmest fladt over alder, så et ungt
// talent til 180.000 CZ$ kostede mindre end en 34-årig til 20.000 — det dyreste
// aktiv var det billigste at eje. Kurven er konkav fordi truppernes markedsværdi
// spænder ~400× mens indtægten spænder ~1,25×.
//
// Rollback: sæt SALARY_BASIS_MODE = "production" HER OG i backend samtidig.
const SALARY_BASIS_MODE = "market";

// #2594-grundlaget (rollback-sti). Spejler backend SALARY_RATE_PROD.
const SALARY_RATE_PROD = { byDiv: { 1: 0.3029, 2: 0.3238, 3: 0.1481, 4: 0.2087 }, global: 0.1606 };
export function salaryRateForDivision(division) {
  return SALARY_RATE_PROD.byDiv[Number(division)] ?? SALARY_RATE_PROD.global;
}

// #3360-grundlaget. Spejler backend SALARY_MARKET_MODEL.
const SALARY_MARKET_MODEL = { anchorValue: 100000, anchorSalary: 15000, exponent: 0.55, floor: 250 };

function salaryFromProduction(rider, division) {
  const cpv = Number(rider?.current_production_value);
  const base = cpv > 0 ? cpv : RIDER_BASE_VALUE_FALLBACK;
  return Math.max(1, Math.round(base * salaryRateForDivision(division)));
}

function salaryFromMarket(rider) {
  const mv = Number(rider?.market_value);
  const bv = Number(rider?.base_value);
  const base = mv > 0 ? mv : (bv > 0 ? bv : RIDER_BASE_VALUE_FALLBACK);
  const { anchorValue, anchorSalary, exponent, floor } = SALARY_MARKET_MODEL;
  return Math.max(floor, Math.round(anchorSalary * Math.pow(base / anchorValue, exponent)));
}

// Delt indgang: den løn et grundlag ville give. `division` bruges kun af
// "production"-grundlaget (markedsgrundlaget er division-blindt, med vilje).
function estimateSalary(rider, division) {
  return SALARY_BASIS_MODE === "market"
    ? salaryFromMarket(rider)
    : salaryFromProduction(rider, division);
}

// Hvilken DB-kolonne løn-ESTIMATET (NULL-løn-grenen) skal filtreres på server-side.
export const SALARY_ESTIMATE_COLUMN = SALARY_BASIS_MODE === "market"
  ? "market_value"
  : "current_production_value";

// #1309: frossen kontrakt-løn hvis sat; ellers estimat til VISNING af free agents
// (global sats — de har intet hold/division; den præcise sats fryses ved signering).
// Spejler backend's resolveRiderSalary i marketUtils.js. salary:0 er en gyldig
// (gratis) kontrakt og bevares som 0.
export function getRiderSalary(rider = {}) {
  if (rider && rider.salary != null) return Number(rider.salary);
  return estimateSalary(rider, undefined);
}

// #932 S7: projektér den SENIOR-løn en akademi-rytter ville fryses til ved en
// promotion. #2594: cpv × divisions-sats (holdets division medgives af kalderen).
// IGNORERER rytterens nuværende (akademi-)salary — derfor ikke getRiderSalary, som
// returnerer den eksisterende akademi-løn. Kun til VISNING i promote-dialogen;
// backend beregner den autoritative værdi.
export function projectSeniorSalary(rider = {}, { division } = {}) {
  return estimateSalary(rider, division);
}

// #932 S7: projektér den løn en senior-rytter ville få ved en demote. #2594: samme
// delte formel som promotion (ét fælles løn-system, #2083-princippet). Kun til
// VISNING i demote-dialogen; backend-RPC'en beregner den autoritative værdi.
export function projectYouthSalary(rider = {}, { division } = {}) {
  return estimateSalary(rider, division);
}

// #1827: løn-filteret gælder den VISTE løn (getRiderSalary): frossen kontrakt-løn
// hvis sat, ellers estimatet global-sats × current_production_value. NULL-løn-
// ryttere droppes ellers stille af et rå `salary <= X`-filter i PostgREST.
//
// Da PostgREST ikke kan filtrere på et COALESCE-udtryk, oversætter vi løn-grænsen
// til en værdi-grænse for NULL-løn-grenen (invers af den aktive løn-formel) og
// lader den frosne-løn-gren bruge selve salary-kolonnen. Kolonnen der skal
// filtreres på er SALARY_ESTIMATE_COLUMN — den følger grundlaget.
// Returnerer null for en grænse der ikke er sat (parseInt-NaN), så kalderen kan
// springe den gren over.
export function salaryBoundToValueBound(salaryBound) {
  const n = parseInt(salaryBound, 10);
  if (!Number.isFinite(n)) return null;
  if (SALARY_BASIS_MODE === "market") {
    // løn = anchorSalary × (v/anchorValue)^exponent  ⇒  v = anchorValue × (løn/anchorSalary)^(1/exponent)
    const { anchorValue, anchorSalary, exponent } = SALARY_MARKET_MODEL;
    if (n <= 0) return 0;
    return Math.round(anchorValue * Math.pow(n / anchorSalary, 1 / exponent));
  }
  return Math.round(n / SALARY_RATE_PROD.global);
}

export function formatCz(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${formatNumber(Number(value))} CZ$`;
}

// #2464: bud-vurdering — delta mellem det aktuelle bud og rytterens estimerede
// markedsværdi (getRiderMarketValue, inkl. base_value-fallback). UI'et skal
// formulere det som ESTIMAT, ikke facit — markedsværdien er selv en model-
// vurdering (#1101). Returnerer { pct, direction, value } hvor direction er
// "under" (bud under vurdering), "over" (bud over) eller "at" (afrundet 0%).
// null når rytteren mangler eller prisen ikke er et tal, så kalderen kan
// udelade delta-linjen helt i stedet for at vise noget misvisende.
export function computeBidValueDelta(currentPrice, rider) {
  if (!rider) return null;
  // Number(null) er 0 — en manglende pris må ikke ligne et 0-bud.
  if (currentPrice == null) return null;
  const price = Number(currentPrice);
  if (!Number.isFinite(price)) return null;
  const value = getRiderMarketValue(rider);
  if (!Number.isFinite(value) || value <= 0) return null;
  const pct = Math.round(Math.abs((price - value) / value) * 100);
  if (pct === 0) return { pct: 0, direction: "at", value };
  return { pct, direction: price < value ? "under" : "over", value };
}

// #3191: SIGNERET pct-afvigelse (pris vs. vurdering) til FILTRERING — i modsætning
// til computeBidValueDelta ovenfor, som returnerer en UNSIGNED pct + direction til
// VISNING (badge-teksten). Transferlistens %-filter skal kunne skelne "mindst 20%
// under vurdering" fra "højst 20% over vurdering" med ét min/max-range uden en
// direction-gren, så her er positiv = over vurdering (dyrere), negativ = under
// (billigere). Bruges på listing.asking_price, ikke auktionens current_price.
export function computeValueDeviationPct(price, rider) {
  if (!rider) return null;
  if (price == null) return null;
  const p = Number(price);
  if (!Number.isFinite(p)) return null;
  const value = getRiderMarketValue(rider);
  if (!Number.isFinite(value) || value <= 0) return null;
  return ((p - value) / value) * 100;
}

// Min-step = +1 CZ$ over current price når der allerede er bud.
// Hvis ingen har budt endnu (asking-price på guaranteed sale), tillad match-bud.
// Spejl af backend/lib/auctionRules.js — droppet 10%/1000-afrunding 2026-05-07 (#178).
export function getMinimumAuctionBid(currentPrice, { hasActiveBid = true } = {}) {
  const price = Number(currentPrice) || 0;
  return hasActiveBid ? price + 1 : price;
}

// #3184 tastefejl-værn: startprisen matcher et ciffer-drop af rytterens
// markedsværdi (ét/to cifre for lidt, eller det foranstillede ciffer mangler).
// Non-blocking signal — IKKE en pris-vurdering (det er computeBidValueDelta's
// domæne) og IKKE et gulv (#3133/#3136, blokeret af sidstnævnte til båndet er
// rekalibreret): ren mønster-genkendelse af en formodet tastefejl, uanset hvor
// lavt en ærlig sælger ellers må sætte startprisen bevidst.
//
// Fundet i fair-play-scan 2026-08-03 (#3184): 211.007 → 21.100 (÷10, 0,10×) og
// 24.212 → 4.212 (foranstillet ciffer fjernet, 0,17×) — begge lukkede på
// præcis startprisen med præcis én byder, uden budkonkurrence til at rette
// fejlen. #3136 måler median 0,49× / P10 0,17× for ærlige konkurrenceudsatte
// auktioner, så tærsklen her er mønster-baseret, ikke ratio-baseret, for ikke
// at genere en sælger der bevidst lister lavt.
const TYPO_GUARD_TOLERANCE_PCT = 2;

export function detectStartPriceTypo(startingPrice, rider) {
  const price = Number(startingPrice);
  const value = getRiderMarketValue(rider);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(value) || value <= 0) {
    return { suspected: false };
  }
  // Ciffer-drop-mønstre producerer per definition en pris under markedsværdien —
  // en pris på eller over værdien kan aldrig være et "for lidt"-ciffer-drop.
  if (price >= value) return { suspected: false };

  const tolerance = TYPO_GUARD_TOLERANCE_PCT / 100;
  const suggestedValue = Math.round(value);

  // Ciffer-drop: prisen ligger ~value/10 eller ~value/100 (ét/to cifre for lidt).
  for (const divisor of [10, 100]) {
    const target = value / divisor;
    if (target >= 1 && Math.abs(price - target) <= target * tolerance) {
      return {
        suspected: true,
        pattern: divisor === 10 ? "digit_drop_10" : "digit_drop_100",
        suggestedValue,
      };
    }
  }

  // Manglende foranstillet ciffer: værdien med første ciffer fjernet (24.212 → 4.212).
  const valueDigits = String(Math.round(value));
  if (valueDigits.length >= 2) {
    const withoutLeadingDigit = Number(valueDigits.slice(1));
    if (withoutLeadingDigit > 0 && Math.abs(price - withoutLeadingDigit) <= Math.max(1, withoutLeadingDigit * tolerance)) {
      return { suspected: true, pattern: "missing_leading_digit", suggestedValue };
    }
  }

  return { suspected: false };
}

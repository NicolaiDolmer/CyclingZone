import { formatNumber } from "./intl.js";

// #1101 cutover: DB-kolonnen market_value (GENERATED fra base_value + bonus) er
// sandheden. Fallback spejler DB'ens COALESCE(base_value, 1000). Aldrig uci_points.
const RIDER_BASE_VALUE_FALLBACK = 1000;

export function getRiderMarketValue(rider = {}) {
  if (Number.isFinite(Number(rider?.market_value))) return Number(rider.market_value);
  const base = Number(rider?.base_value) > 0 ? Number(rider.base_value) : RIDER_BASE_VALUE_FALLBACK;
  return base + (Number(rider?.prize_earnings_bonus) || 0);
}

// #2594 løn-decoupling: løn = current_production_value × SALARY_RATE_PROD[division].
// Værdi (market_value) prissætter FREMTIDEN (karriere-NPV); løn prissætter NUTIDEN
// (forventet produktion i indeværende sæson). Spejler backend economyConstants.js
// (SALARY_RATE_PROD + salaryRateForDivision) — SKAL holdes i sync. Ukendt division
// (fx free agents) → global sats.
const SALARY_RATE_PROD = { byDiv: { 1: 0.3029, 2: 0.3238, 3: 0.1481, 4: 0.2087 }, global: 0.1606 };
export function salaryRateForDivision(division) {
  return SALARY_RATE_PROD.byDiv[Number(division)] ?? SALARY_RATE_PROD.global;
}

function salaryFromProduction(rider, division) {
  const cpv = Number(rider?.current_production_value);
  const base = cpv > 0 ? cpv : RIDER_BASE_VALUE_FALLBACK;
  return Math.max(1, Math.round(base * salaryRateForDivision(division)));
}

// #1309: frossen kontrakt-løn hvis sat; ellers estimat til VISNING af free agents
// (global sats — de har intet hold/division; den præcise sats fryses ved signering).
// Spejler backend's resolveRiderSalary i marketUtils.js. salary:0 er en gyldig
// (gratis) kontrakt og bevares som 0.
export function getRiderSalary(rider = {}) {
  if (rider && rider.salary != null) return Number(rider.salary);
  return salaryFromProduction(rider, undefined);
}

// #932 S7: projektér den SENIOR-løn en akademi-rytter ville fryses til ved en
// promotion. #2594: cpv × divisions-sats (holdets division medgives af kalderen).
// IGNORERER rytterens nuværende (akademi-)salary — derfor ikke getRiderSalary, som
// returnerer den eksisterende akademi-løn. Kun til VISNING i promote-dialogen;
// backend beregner den autoritative værdi.
export function projectSeniorSalary(rider = {}, { division } = {}) {
  return salaryFromProduction(rider, division);
}

// #932 S7: projektér den løn en senior-rytter ville få ved en demote. #2594: samme
// delte formel som promotion (ét fælles løn-system, #2083-princippet). Kun til
// VISNING i demote-dialogen; backend-RPC'en beregner den autoritative værdi.
export function projectYouthSalary(rider = {}, { division } = {}) {
  return salaryFromProduction(rider, division);
}

// #1827: løn-filteret gælder den VISTE løn (getRiderSalary): frossen kontrakt-løn
// hvis sat, ellers estimatet global-sats × current_production_value. NULL-løn-
// ryttere droppes ellers stille af et rå `salary <= X`-filter i PostgREST.
//
// Da PostgREST ikke kan filtrere på et COALESCE-udtryk, oversætter vi løn-grænsen
// til en current_production_value-grænse for NULL-løn-grenen (invers af den
// globale sats) og lader den frosne-løn-gren bruge selve salary-kolonnen.
// Returnerer null for en grænse der ikke er sat (parseInt-NaN), så kalderen kan
// springe den gren over.
export function salaryBoundToValueBound(salaryBound) {
  const n = parseInt(salaryBound, 10);
  if (!Number.isFinite(n)) return null;
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

// Min-step = +1 CZ$ over current price når der allerede er bud.
// Hvis ingen har budt endnu (asking-price på guaranteed sale), tillad match-bud.
// Spejl af backend/lib/auctionRules.js — droppet 10%/1000-afrunding 2026-05-07 (#178).
export function getMinimumAuctionBid(currentPrice, { hasActiveBid = true } = {}) {
  const price = Number(currentPrice) || 0;
  return hasActiveBid ? price + 1 : price;
}

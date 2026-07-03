import { formatNumber } from "./intl.js";

// #1101 cutover: DB-kolonnen market_value (GENERATED fra base_value + bonus) er
// sandheden. Fallback spejler DB'ens COALESCE(base_value, 1000). Aldrig uci_points.
const RIDER_BASE_VALUE_FALLBACK = 1000;

export function getRiderMarketValue(rider = {}) {
  if (Number.isFinite(Number(rider?.market_value))) return Number(rider.market_value);
  const base = Number(rider?.base_value) > 0 ? Number(rider.base_value) : RIDER_BASE_VALUE_FALLBACK;
  return base + (Number(rider?.prize_earnings_bonus) || 0);
}

// #1309: frossen kontrakt-løn hvis sat; ellers estimat (SALARY_RATE af market_value)
// til VISNING af free agents. Spejler backend's resolveRiderSalary i marketUtils.js
// + economyConstants.SALARY_RATE — SKAL holdes i sync (E2 strict_fair_v1: 0.067).
// salary:0 er en gyldig (gratis) kontrakt og bevares som 0.
const SALARY_RATE = 0.067;
export function getRiderSalary(rider = {}) {
  if (rider && rider.salary != null) return Number(rider.salary);
  return Math.max(1, Math.round(getRiderMarketValue(rider) * SALARY_RATE));
}

// #932 S7: projektér den SENIOR-løn en akademi-rytter ville fryses til ved en
// promotion. Spejler backend computeFrozenSalary (base_value+prize × SALARY_RATE),
// IGNORERER rytterens nuværende (akademi-)salary — derfor ikke getRiderSalary, som
// returnerer den eksisterende akademi-løn. Kun til VISNING i promote-dialogen;
// backend beregner den autoritative værdi.
export function projectSeniorSalary(rider = {}) {
  return Math.max(1, Math.round(getRiderMarketValue(rider) * SALARY_RATE));
}

// #932 S7: projektér den løn en senior-rytter ville få ved en demote.
// Spejler backend academyTransfer.demoteSalary = ACADEMY.SALARY_RATE × base_value
// (IGNORERER prize-bonus → bruger base_value, ikke market_value).
// #2083: ungdoms-raten ensrettet til den delte 0.067 (ét fælles løn-system) — SKAL
// matche backend economyConstants.SALARY_RATE. Kun til VISNING i demote-dialogen;
// backend-RPC'en beregner den autoritative værdi.
const ACADEMY_SALARY_RATE = 0.067;
export function projectYouthSalary(rider = {}) {
  const base = Number(rider?.base_value) > 0 ? Number(rider.base_value) : 0;
  return Math.max(1, Math.round(base * ACADEMY_SALARY_RATE));
}

// #1827: løn-filteret gælder den VISTE løn (getRiderSalary): frossen kontrakt-løn
// hvis sat, ellers estimatet SALARY_RATE × market_value. De fleste ryttere (alle
// free agents + 716 kontraktløse seniorer i prod 25/6) har salary == NULL, så et
// rå `salary <= X`-filter i PostgREST droppede dem stille (NULL matcher hverken
// gte/lte) — frie agenter forsvandt helt og kun de få med frossen løn blev tilbage.
//
// Da PostgREST ikke kan filtrere på et COALESCE-udtryk, oversætter vi løn-grænsen
// til en market_value-grænse for NULL-løn-grenen (invers af SALARY_RATE) og lader
// den frosne-løn-gren bruge selve salary-kolonnen. Returnerer null for en grænse
// der ikke er sat (parseInt-NaN), så kalderen kan springe den gren over.
export function salaryBoundToValueBound(salaryBound) {
  const n = parseInt(salaryBound, 10);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / SALARY_RATE);
}

export function formatCz(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${formatNumber(Number(value))} CZ$`;
}

// Min-step = +1 CZ$ over current price når der allerede er bud.
// Hvis ingen har budt endnu (asking-price på guaranteed sale), tillad match-bud.
// Spejl af backend/lib/auctionRules.js — droppet 10%/1000-afrunding 2026-05-07 (#178).
export function getMinimumAuctionBid(currentPrice, { hasActiveBid = true } = {}) {
  const price = Number(currentPrice) || 0;
  return hasActiveBid ? price + 1 : price;
}

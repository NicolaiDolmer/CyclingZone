import { formatNumber } from "./intl.js";

// #1101 cutover: DB-kolonnen market_value (GENERATED fra base_value + bonus) er
// sandheden. Fallback spejler DB'ens COALESCE(base_value, 1000). Aldrig uci_points.
const RIDER_BASE_VALUE_FALLBACK = 1000;

export function getRiderMarketValue(rider = {}) {
  if (Number.isFinite(Number(rider?.market_value))) return Number(rider.market_value);
  const base = Number(rider?.base_value) > 0 ? Number(rider.base_value) : RIDER_BASE_VALUE_FALLBACK;
  return base + (Number(rider?.prize_earnings_bonus) || 0);
}

// #3989 (ejer-beslutning 20/8): løn = current_production_value × ÉN global sats.
//
//   Rytterens VÆRDI er prisen på hvem han bliver.
//   Rytterens LØN er prisen på hvad han leverer i år.
//
// Værdi (market_value) prissætter FREMTIDEN (karriere-NPV + elite-præmie); løn
// prissætter NUTIDEN. Ingen divisions-skalering: samme rytter koster det samme
// uanset hvilket hold han er på. De tidligere per-division-satser
// ({1: 0.3029, 2: 0.3238, 3: 0.1481, 4: 0.2087}) er fjernet sammen med
// `division`-parameteren, så skaleringen ikke kan snige sig ind igen.
//
// Spejler backend economyConstants.SALARY_RATE_PRODUCTION — paritet håndhæves af
// salaryRateParity.test.js, som importerer BEGGE konstanter og sammenligner dem.
export const SALARY_RATE_PRODUCTION = 0.35;

function salaryFromProduction(rider) {
  const cpv = Number(rider?.current_production_value);
  const base = cpv > 0 ? cpv : RIDER_BASE_VALUE_FALLBACK;
  return Math.max(1, Math.round(base * SALARY_RATE_PRODUCTION));
}

// #1309: frossen kontrakt-løn hvis sat; ellers estimat til VISNING af free agents.
// Spejler backend's resolveRiderSalary i marketUtils.js. salary:0 er en gyldig
// (gratis) kontrakt og bevares som 0.
export function getRiderSalary(rider = {}) {
  if (rider && rider.salary != null) return Number(rider.salary);
  return salaryFromProduction(rider);
}

// #932 S7: projektér den SENIOR-løn en akademi-rytter ville fryses til ved en
// promotion. #3989: cpv × den globale sats — holdets division er irrelevant.
// IGNORERER rytterens nuværende (akademi-)salary — derfor ikke getRiderSalary, som
// returnerer den eksisterende akademi-løn. Kun til VISNING i promote-dialogen;
// backend beregner den autoritative værdi.
export function projectSeniorSalary(rider = {}) {
  return salaryFromProduction(rider);
}

// #932 S7: projektér den løn en senior-rytter ville få ved en demote. Samme delte
// formel som promotion (ét fælles løn-system, #2083-princippet). Kun til VISNING i
// demote-dialogen; backend-RPC'en beregner den autoritative værdi.
export function projectYouthSalary(rider = {}) {
  return salaryFromProduction(rider);
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
  return Math.round(n / SALARY_RATE_PRODUCTION);
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

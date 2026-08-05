// Løn-grundlag (#3360) — ren, DB-fri matematik for hvad en kontrakt-løn ganges MED.
//
// Baggrund. Siden #2594 er lønnen `current_production_value × SALARY_RATE_PROD[div]`.
// Satsen (~20 %) virker som designet, men grundlaget gør ikke: `current_production_value`
// er nærmest fladt over alder (7-12k) mens `market_value` falder fra ~180k (≤21 år) til
// ~20k (34+). Konsekvensen er bagvendt — et ungt talent til 180.000 CZ$ koster 1.273 CZ$
// om året, en 34-årig til 20.000 CZ$ koster 2.971 CZ$. Spillets dyreste aktiver er de
// billigste at beholde. Ejer-retningen 5/8: du skal betale for det du EJER.
//
// Hvorfor ikke bare en lineær andel af markedsværdien. Målt mod prod 5/8 (181 rigtige
// hold, 3.152 ryttere) spænder truppernes markedsværdi 58.647 → 24.825.305 CZ$ (≈ 400×),
// mens den garanterede indtægt kun spænder ~1,25× (sponsor er reelt flad). En lineær
// sats ville derfor lægge ~81 % af hele lønsummen på de 48 D2-hold og gøre dem
// strukturelt insolvente på én sæson. Det er ikke "styrke straffes" — det er en
// prisfunktion der ikke kan bæres af nogen indtægtsstruktur vi har.
//
// Derfor: KONKAV kurve (potens-lov, eksponent < 1) forankret i en rund referenceværdi.
//
//   løn = clamp( round( ANCHOR_SALARY × (market_value / ANCHOR_VALUE) ^ EXPONENT ),
//                FLOOR, CEILING )
//
// Egenskaber, i klar tekst:
//   • En rytter der er præcis ANCHOR_VALUE værd koster præcis ANCHOR_SALARY om året.
//   • Dobbelt så værdifuld ⇒ 2^EXPONENT gange så dyr (ikke dobbelt så dyr).
//   • Monotont voksende: en dyrere rytter koster ALTID mere end en billigere. Det er
//     præcis den inversion mod `current_production_value` der fjernes.
//   • Ingen kobling til resultater: prisen følger hvad du ejer, ikke hvad du præsterer.
//
// Modulet er DB-frit og deterministisk (node --test). Kalibreringen (hvilke tal der
// står i economyConstants) leveres af scripts/salaryBasisScorecard.js mod ægte prod.

export const SALARY_BASIS = Object.freeze({
  PRODUCTION: "production", // #2594-adfærd: current_production_value × SALARY_RATE_PROD
  MARKET: "market",         // #3360: markedsværdi via konkav kurve (nedenfor)
});

// Sidste udvej hvis hverken market_value eller base_value er læselige. Spejler
// CONTRACT.BASE_VALUE_FALLBACK / RIDER_BASE_VALUE_FALLBACK, så en manglende kolonne
// giver samme (lave) tal som resten af koden — men se `resolveMarketBase().source`:
// et kaldested der rammer "fallback" på en EJET rytter er en bug, ikke en normalitet.
// Det var netop den fejlklasse der ramte lønbyrde-harnessen i #3389.
export const MARKET_BASE_FALLBACK = 1000;

// market_value er en GENERATED kolonne (COALESCE(base_value, 1000)), så base_value er
// et sikkert sekundært felt for kaldesteder der kun har selectet det.
export function resolveMarketBase(rider = {}) {
  const mv = Number(rider?.market_value);
  if (Number.isFinite(mv) && mv > 0) return { base: mv, source: "market_value" };
  const bv = Number(rider?.base_value);
  if (Number.isFinite(bv) && bv > 0) return { base: bv, source: "base_value" };
  return { base: MARKET_BASE_FALLBACK, source: "fallback" };
}

// Kurven. `model` = { anchorValue, anchorSalary, exponent, floor, ceiling }.
export function marketBasisSalary(marketValue, model) {
  const { anchorValue, anchorSalary, exponent, floor, ceiling } = model;
  const v = Number(marketValue);
  const base = Number.isFinite(v) && v > 0 ? v : MARKET_BASE_FALLBACK;
  const raw = Number(anchorSalary) * Math.pow(base / Number(anchorValue), Number(exponent));
  const rounded = Math.round(raw);
  const withFloor = Math.max(Number(floor) || 1, rounded);
  const cap = Number(ceiling);
  return Number.isFinite(cap) && cap > 0 ? Math.min(cap, withFloor) : withFloor;
}

// Σ løn for en liste markedsværdier ved et givet anchorSalary (floor/ceiling gør
// funktionen ikke-lineær i anchorSalary, derfor bisection nedenfor og ikke division).
export function totalWageBill(values, model) {
  let sum = 0;
  for (const v of values) sum += marketBasisSalary(v, model);
  return sum;
}

// Løs anchorSalary så Σ løn ≈ targetTotal (bisection, monotont voksende i anchorSalary).
// Returnerer null hvis målet ikke kan nås inden for [lo, hi] (fx fordi loftet binder).
export function calibrateAnchorSalary(values, { anchorValue, exponent, floor, ceiling, targetTotal }, opts = {}) {
  const { lo = 1, hi = 5_000_000, iterations = 80 } = opts;
  const at = (anchorSalary) => totalWageBill(values, { anchorValue, anchorSalary, exponent, floor, ceiling });
  if (at(hi) < targetTotal) return null;
  let a = lo, b = hi;
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2;
    if (at(mid) < targetTotal) a = mid; else b = mid;
  }
  return (a + b) / 2;
}

// Hvor stejl er kurven, i klar tekst: hvad koster en rytter der er `factor` gange
// mere værd? Bruges af scorecardet + tests til at gøre eksponenten læsbar.
export function costMultiplierForValueMultiple(factor, exponent) {
  return Math.pow(Number(factor), Number(exponent));
}

// Central pris-konfiguration for premium-tiers på landing page — Refs #1104.
// Ét konfig-sted for priser (forbereder admin-styring senere, #673).
//
// Valutapolitik (besluttet i #1104): EN viser EUR, DA viser DKK.
// FAST kurs, ikke live-API. DKK er fastkursbundet til euroen via ERM II
// (centralkurs 7.46038 kr. pr. euro, bånd ±2,25%), så en fast dokumenteret
// kurs er retvisende. Vi bruger 7.46 DKK pr. EUR.
//
// Afrunding: alle viste beløb afrundes til 2 decimaler (cent-præcision).
// Pr-dag: månedspris / 30 (fast divisor) — UI'et viser beløbet med "≈".
// Årspris (Premium): 10 × måneds-beløbet i visningsvalutaen
// (eksisterende "= 10 months"-løfte, dvs. 2 måneder gratis).

export const DKK_PER_EUR = 7.46;
export const DAYS_PER_MONTH = 30;
export const SUPPORTER_ANNUAL_MONTHS = 10;

// Option B-pristest (#672): ?variant=A|B|C styrer Premium/Pro Analyst-prisen.
// Tier-navne + default-priser er locked (#1104): Free Manager 0 / Premium 49 /
// Pro Analyst 89 / Patron 149 (DKK pr. måned). Default-variant = B.
export const TIER_PRICES_DKK = {
  A: { free: 0, supporter: 29, pro: 49, patron: 149 },
  B: { free: 0, supporter: 49, pro: 89, patron: 149 },
  C: { free: 0, supporter: 69, pro: 119, patron: 149 },
};

export const DEFAULT_VARIANT = "B";

// Variant-opslag med fallback til default — samme semantik som det gamle
// `VARIANT_PRICES[key] || defaults` i FounderSupporterPage.
export function getTierPricesDkk(variantKey) {
  const key = String(variantKey || "").toUpperCase();
  return TIER_PRICES_DKK[key] || TIER_PRICES_DKK[DEFAULT_VARIANT];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function dkkToEur(dkk) {
  if (dkk == null || !Number.isFinite(dkk)) return null;
  return round2(dkk / DKK_PER_EUR);
}

// Månedsbeløb i visningsvaluta: EUR konverteres med fast kurs, DKK er as-is.
export function monthlyInCurrency(dkkMonthly, currency) {
  if (dkkMonthly == null || !Number.isFinite(dkkMonthly)) return null;
  return currency === "EUR" ? dkkToEur(dkkMonthly) : dkkMonthly;
}

// "Pr. dag"-beløb afledt af det VISTE månedsbeløb (samme valuta), så
// dag- og månedstal altid stemmer overens for spilleren.
export function perDayOf(monthly) {
  if (monthly == null || !Number.isFinite(monthly)) return null;
  return round2(monthly / DAYS_PER_MONTH);
}

// Årsbeløb = 10 × det viste månedsbeløb (i samme valuta).
export function annualOf(monthly) {
  if (monthly == null || !Number.isFinite(monthly)) return null;
  return round2(monthly * SUPPORTER_ANNUAL_MONTHS);
}

// Fast EUR-label til statiske copy-strenge (fx waitlist-formens tier-subs)
// hvor Intl-formatering ikke er nødvendig. Altid 2 decimaler.
export function eurLabel(dkk) {
  const eur = dkkToEur(dkk);
  return eur == null ? "" : `€${eur.toFixed(2)}`;
}

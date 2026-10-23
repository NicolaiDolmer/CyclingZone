// #2806 · Hvem faar Pro-funktionerne, og hvordan linkes der til /pro.
//
// Ejer-beslutning 13/10 (#2806): saesonhistorik og gemte filtre kraever AKTIV
// Pro. Founder-status giver kun det permanente Founder-maerke, som vilkaarene
// lover (pro.json founderExplainer). En Founder der opsiger, beholder maerket,
// men ikke funktionerne. Maerket i Layout.jsx gater fortsat paa isPro || isFounder.
//
// Backend haandhaever samme regel paa GET /api/pro/rider-history/:riderId
// (backend/lib/proRiderHistory.js bruger isPro(), ikke Founder).

export const PRO_BENEFITS = ["history", "filters"] as const;
export type ProBenefit = (typeof PRO_BENEFITS)[number];

export const PRO_PATH = "/pro";

interface SubscriptionState {
  isPro: boolean;
  isFounder?: boolean;
}

// Eneste sted reglen staar i frontend. isFounder ignoreres med vilje.
export function hasProFeatureAccess(sub: SubscriptionState): boolean {
  return sub.isPro === true;
}

// Link fra en opsalgsflade til den fane paa /pro der viser netop den fordel.
export function proBenefitPath(benefit: ProBenefit): string {
  return `${PRO_PATH}?benefit=${benefit}`;
}

// ?benefit=... fra URL'en. Ukendt eller manglende vaerdi giver den foerste fane.
export function parseProBenefit(value: string | null | undefined): ProBenefit {
  return (PRO_BENEFITS as readonly string[]).includes(value ?? "") ? (value as ProBenefit) : PRO_BENEFITS[0];
}

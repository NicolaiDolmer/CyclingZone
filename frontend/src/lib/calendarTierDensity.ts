// #4386: kalenderens dags-celle skal loftes til DIVISIONENS density, ikke et
// hardcodet tal. Density-tallene (5/4/3/2) er backend/lib/calendarTierCaps.js's
// TIER_DENSITY (docs/CALENDAR_RULES.md §1, ejer-låst) — samme konstant, ikke et
// nyt tal. Frontend og backend deler ikke et fælles lib-workspace, så værdien
// holdes i sync manuelt (samme disciplin som stageProfileConfig.js's
// PROFILE_TYPE_KEYS mod backend/lib/raceStageProfileGenerator.js). Ændrer du
// TIER_DENSITY i backend, ret denne fil i SAMME PR —
// backend/lib/calendarOverlapInvariant.test.js låser {1:5, 2:4, 3:3, 4:2}.
export const TIER_DENSITY: Readonly<Record<number, number>> = Object.freeze({ 1: 5, 2: 4, 3: 3, 4: 2 });

export const MAX_TIER_DENSITY: number = Math.max(...Object.values(TIER_DENSITY));

/**
 * Cellens etape-loft for en given division. "Alle divisioner"-visningen
 * (activeDivision == null) blander flere tiers i samme dags-celle, hvor én
 * tiers density ikke er entydig — brug den bredeste (D1's 5), så cellen aldrig
 * skjuler mere end det en enkelt-division-visning ville.
 */
export function densityForDivision(tier: number | null | undefined): number {
  if (tier == null) return MAX_TIER_DENSITY;
  return TIER_DENSITY[tier] ?? MAX_TIER_DENSITY;
}

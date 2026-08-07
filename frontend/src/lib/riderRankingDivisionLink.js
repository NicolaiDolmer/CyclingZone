// #3507 — dashboardets "Rytter-rangliste"-modul viser top-5 i EGEN division
// (RPC dashboard_rider_ranking, backend/routes/api.js), men "Fuld rangliste →"
// linkede til Ranglister-hubbens rytterfane, som viser en SÆSON-GLOBAL liste
// (rider_rankings_mv, alle divisioner) — nul overlap mellem de to "top 5"
// (prod-verificeret 2026-08-07, division 8: dashboardet topper ved 481 point,
// den globale liste ved 1.913 point).
//
// Fixet: linket baerer nu spillerens division(+pulje) som URL-param, og
// rytterfanen (RiderRankingsPage) genbruger param'et — og KUN param'et —
// til at forvaelge samme scope. Fanens EGEN default forbliver "alle
// divisioner" (ingen adfaerdsaendring for direkte besoeg/bogmaerker af
// /standings?tab=riders); kun navigation VIA dashboardet baerer filteret med.
//
// Rene funktioner (ingen React/Supabase-afhaengighed) — testet med
// node --test, se riderRankingDivisionLink.test.js. Genbruger
// poolMatchesSelection/filterByDivisionPool fra resultsFilter.js (samme
// division+pulje-model som ResultaterPage/#3197) i stedet for en tredje
// parallel filter-implementering.

export const ALL_DIVISIONS_VALUE = "all";

/**
 * Bygger dashboardets "Fuld rangliste →"-link, forvalgt til spillerens egen
 * division(+pulje). Ingen division kendt (fx holdet ikke hentet endnu) →
 * uscopet link til rytterfanen (samme adfaerd som foer #3507).
 * @param {{ division?: number|null, poolId?: number|string|null }} [team]
 * @returns {string}
 */
export function buildRiderRankingLink({ division, poolId } = {}) {
  const params = new URLSearchParams();
  params.set("tab", "riders");
  if (division != null) params.set("division", String(division));
  if (poolId != null) params.set("pool", String(poolId));
  return `/standings?${params.toString()}`;
}

/**
 * Udleder rytterfanens division/pulje-valg fra URL-param'ene (samme
 * "selection"-form som resultsFilter.js's poolMatchesSelection forventer).
 * Fravaerende eller "all" division → { tier: null, poolId: null } (ingen
 * filtrering — fanens status quo-adfaerd). Et ugyldigt tal fejler ÅBENT til
 * samme "ingen filter"-tilstand, aldrig en knaekket/tom liste.
 * @param {string|null|undefined} divisionParamRaw
 * @param {string|null|undefined} poolParamRaw
 * @returns {{ tier: number|null, poolId: string|null }}
 */
export function resolveDivisionSelectionFromParams(divisionParamRaw, poolParamRaw) {
  if (divisionParamRaw == null || divisionParamRaw === ALL_DIVISIONS_VALUE) {
    return { tier: null, poolId: null };
  }
  const tier = Number(divisionParamRaw);
  if (!Number.isFinite(tier)) return { tier: null, poolId: null };
  const poolId = poolParamRaw == null || poolParamRaw === ALL_DIVISIONS_VALUE ? null : poolParamRaw;
  return { tier, poolId };
}

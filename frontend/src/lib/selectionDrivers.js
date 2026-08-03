// frontend/src/lib/selectionDrivers.js
// Udtagelses-fladens "hvorfor passer/ikke-passer rytteren til løbet"-drivere
// (#3115, ejer-forslag 3/8: "vis fx udbruds-sandsynlighed-drivere (taktik/
// aggressivitet/typematch) på rytter- eller udtagelsesfladen"). Rene helpers,
// ingen React — samme mønster som roleHint.js/lineupInsight.js.
//
// Fog-gate (orkestrator-briefen refererer #1791): ALDRIG rå evne-tal i UI'et,
// kun ord-bånd. Typematch dækkes allerede af den eksisterende FitBar/
// suitability-kolonne (racehub.fit.strong/average/poor) — denne fil tilføjer
// KUN de to manglende, evidensbaserede signaler:
//
//  1. escapeChanceBand(aggression) — hvor ofte rytteren bliver trukket ind i et
//     udbrudsforsøg PÅ DENNE ETAPE. Motoren: raceSimulator.aggressionScore er
//     selektions-VÆGTEN i selectBreakawayBonuses (rene chance, ALDRIG en
//     omkostning for rytteren — det er selve #3115-fundet). KUN relevant når
//     etapen har en udbruds-mekanik overhovedet (hunterBreakawayStrength !==
//     "none", roleHint.js).
//     Bånd kalibreret mod ægte population (read-only Supabase-probe 2026-08-04,
//     aktive hold-ryttere ekskl. akademi, n=6474): p33=12, p66=19, p90=28,
//     snit≈16.5, max=89. De fleste ryttere ligger lavt — det er DERFOR en rytter
//     med aggression ≥30 er reelt bemærkelsesværdig (~top ~12 %).
//  2. tacticsFitBand(tactics, profileType) — taktik-evnens bidrag til etapens
//     rute-match. DEMAND_VECTORS.tactics-vægten SPEJLES her fra
//     backend/lib/raceStageProfileGenerator.js (kopieret, IKKE importeret —
//     samme mønster som roleHint.js BREAKAWAY_STRENGTH; drift-guardet i
//     selectionDrivers.test.js). KUN relevant på etaper hvor taktik reelt
//     vægtes (rolling/mountain/high_mountain/classic/ttt); flat/hilly/itt/
//     cobbles vægter aldrig taktik i motoren → intet signal at vise.
//
// Ejer-empiri (samme probe, ejer-kommentar #3115 3/8 "taktik-evnen følger
// alderen kraftigt"): taktik-snit stiger fra ~14 (yngste aldersgruppe) til ~58
// (ældste); aggression-snit FALDER samtidig fra ~25 til ~8 i samme serie. En
// gammel rytter med høj aggression (opskriften ejeren nævner) er derfor sjælden
// netop fordi de to evner er negativt korrelerede med alder — ikke fordi
// aggression stiger med alder.

// → "low" | "medium" | "high" | null (manglende data).
export function escapeChanceBand(aggression) {
  if (aggression == null) return null; // Number(null) === 0 — skal IKKE bånd-sættes som en reel 0
  const a = Number(aggression);
  if (!Number.isFinite(a)) return null;
  if (a < 15) return "low";
  if (a < 30) return "medium";
  return "high";
}

// SPEJL af raceStageProfileGenerator.js DEMAND_VECTORS' tactics-vægt pr. profil
// (kopieret, IKKE importeret): none = vægtes slet ikke; light = 0.02-0.06;
// high = 0.18 (ttt — den suverænt tungeste taktik-vægt i motoren).
export const TACTICAL_DEMAND = Object.freeze({
  flat: "none",
  hilly: "none",
  itt: "none",
  cobbles: "none",
  rolling: "light",
  mountain: "light",
  high_mountain: "light",
  classic: "light",
  ttt: "high",
});

// → "none" | "light" | "high". Ukendt/manglende profil → "none" (intet signal).
export function tacticalDemand(profileType) {
  return TACTICAL_DEMAND[profileType] ?? "none";
}

// → "poor" | "average" | "strong" | null (manglende data). Samme ord-anker som
// racehub.fit.* (FitBar) for konsistent sprog på tværs af panelet — taktik-
// bidraget ER reelt en del af samme rute-match-mekanik, blot isoleret til én
// evne. Tærskler fra samme probe (tactics: p33=31, p66=48 på tværs af alle
// aldre; rundet til pæne tal).
export function tacticsFitBand(tactics) {
  if (tactics == null) return null; // Number(null) === 0 — skal IKKE bånd-sættes som en reel 0
  const t = Number(tactics);
  if (!Number.isFinite(t)) return null;
  if (t < 30) return "poor";
  if (t < 50) return "average";
  return "strong";
}

// Kombinerer de to signaler for ÉN rytter på ÉN etape-kontekst. Returnerer et
// array af { kind: "escape"|"tactics", band, demand? } — tomt hvis intet
// relevant signal findes (graceful degrade, samme konvention som
// effectiveStageFit/bestFitRiderId). `breakawayStrength` beregnes af kalderen
// via roleHint.hunterBreakawayStrength(profileType, finaleType) — sendes ind
// frem for genberegnet her, så RaceSelectionPanel kun beregner den én gang.
export function riderFitDrivers(rider, { profileType, breakawayStrength }) {
  const lines = [];
  if (breakawayStrength && breakawayStrength !== "none") {
    const band = escapeChanceBand(rider?.aggression);
    if (band) lines.push({ kind: "escape", band });
  }
  const demand = tacticalDemand(profileType);
  if (demand !== "none") {
    const band = tacticsFitBand(rider?.tactics);
    if (band) lines.push({ kind: "tactics", band, demand });
  }
  return lines;
}

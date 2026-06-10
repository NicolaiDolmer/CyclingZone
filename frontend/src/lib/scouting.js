// Scouting & skjult potentiale (#1138 / epic #1136) — display-hjælpere.
//
// #1162: Estimat-beregningen er flyttet til SERVEREN (backend/lib/scouting.js).
// Den sande riders.potentiale forlader aldrig serveren — frontend modtager kun
// det viewer-maskerede { lo, hi, exact, level } fra POST /api/scouting/estimates
// (hentes batched via useScouting.requestEstimates). Her ligger kun rene
// display-hjælpere der arbejder på det maskerede estimat.

// Kvalitativ label-NØGLE fra estimatets midtpunkt (oversættes via i18n
// rider:scouting.label_*). Bevidst grov (5 bånd) — flavor, ikke præcision.
export function potentialLabelKey(range) {
  if (!range) return null;
  const mid = (range.lo + range.hi) / 2;
  if (mid >= 5.25) return "worldclass";
  if (mid >= 4.25) return "high";
  if (mid >= 3.25) return "solid";
  if (mid >= 2.25) return "rotation";
  return "limited";
}

// Sorteringsværdi for potentiale-kolonner: estimatets midtpunkt. Bruges til at
// dekorere rytter-rækker (fx `_scoutMid`) så klient-side tabel-sortering virker
// uden adgang til den rå potentiale. undefined/null (ikke hentet / intet
// potentiale) → 0, så u-estimerede ryttere sorterer nederst.
export function scoutSortValue(estimate) {
  if (!estimate) return 0;
  return (estimate.lo + estimate.hi) / 2;
}

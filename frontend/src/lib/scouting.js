// Scouting & skjult potentiale (#1138 / epic #1136) — display-hjælpere.
//
// #1162: Estimat-beregningen er flyttet til SERVEREN (backend/lib/scouting.js).
// Den sande riders.potentiale forlader aldrig serveren — frontend modtager kun
// det viewer-maskerede { lo, hi, exact, level } fra POST /api/scouting/estimates
// (hentes batched via useScouting.requestEstimates). Her ligger kun rene
// display-hjælpere der arbejder på det maskerede estimat.

// Kvalitativ label-NØGLE fra estimatets midtpunkt (oversættes via i18n
// rider:scouting.label_*). Bevidst grov (5 bånd) — flavor, ikke præcision.
// #1543: et skjult (uscoutet) estimat har intet midtpunkt → ingen label.
export function potentialLabelKey(range) {
  if (!range || range.hidden) return null;
  const mid = (range.lo + range.hi) / 2;
  if (mid >= 5.25) return "worldclass";
  if (mid >= 4.25) return "high";
  if (mid >= 3.25) return "solid";
  if (mid >= 2.25) return "rotation";
  return "limited";
}

// Sorteringsværdi for potentiale-kolonner: SAMME tal spilleren rent faktisk
// læser. Bruges til at dekorere rytter-rækker (fx `_scoutMid`) så klient-side
// tabel-sortering virker uden adgang til den rå potentiale.
//
// #3787: prioritetsrækkefølgen matcher PRÆCIS ScoutablePotentiale.jsx's
// render-gren (der er visningen, ikke denne funktion, der er sandheden):
//   1) `estimate.ceil` — rating-båndet ("kan nå 40-48"), det #2454 gjorde til
//      den faktiske skærm-visning. Sorteringen brugte stadig den GAMLE
//      1-6-stjerneskala (lo/hi) efter den omlægning, så rækkefølgen ikke
//      længere matchede det viste tal — det var selve bug'en (#3787).
//   2) lo/hi (stjerneskalaen) som fallback for payloads uden `ceil` (ældre
//      klient-cache, eller den defensive gren i ScoutablePotentiale).
// undefined/null (ikke hentet) ELLER skjult/uscoutet (#1543) → `null`,
// EKSPLICIT adskilt fra 0 (som ville kollidere med en reel lav rating og
// give indtryk af en vurdering der ikke findes). Sorterings-komparatorerne
// (riderColumnSort.js / useTableSort.js) placerer `null` sidst uanset
// sorteringsretning.
export function scoutSortValue(estimate) {
  if (!estimate || estimate.hidden) return null;
  if (estimate.ceil) return (estimate.ceil.lo + estimate.ceil.hi) / 2;
  return (estimate.lo + estimate.hi) / 2;
}

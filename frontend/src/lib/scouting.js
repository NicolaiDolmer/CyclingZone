// Scouting & skjult potentiale (#1138 / epic #1136) — display-hjælpere.
//
// #1162: Estimat-beregningen er flyttet til SERVEREN (backend/lib/scouting.js).
// Den sande riders.potentiale forlader aldrig serveren — frontend modtager kun
// det viewer-maskerede { lo, hi, exact, level } fra POST /api/scouting/estimates
// (hentes batched via useScouting.requestEstimates). Her ligger kun rene
// display-hjælpere der arbejder på det maskerede estimat.

// Kvalitativ label-NØGLE fra estimatets midtpunkt (oversættes via i18n
// rider:scouting.label_*). Bevidst grov (4 bånd) — flavor, ikke præcision.
// #1543: et skjult (uscoutet) estimat har intet midtpunkt → ingen label.
//
// #3651: den femte bucket ("limited"/"Limited upside") er FJERNET, ikke
// erstattet. Den var den bucket hvor håndværks-evner og anden-rolle-evner
// lander sammen (36 % af loftet mellem dem, se trainingFocus.js's samme
// beslutning for fokus-panelet, #3747) — en label der derfor kunne sige det
// samme om to reelt meget forskellige ryttere. Prognose-båndet (rating-point,
// synligt lige ved siden af labelen) siger det ærligt i stedet; under
// "rotation"-tærsklen viser vi nu ingen kvalitativ label overhovedet.
export function potentialLabelKey(range) {
  if (!range || range.hidden) return null;
  const mid = (range.lo + range.hi) / 2;
  if (mid >= 5.25) return "worldclass";
  if (mid >= 4.25) return "high";
  if (mid >= 3.25) return "solid";
  if (mid >= 2.25) return "rotation";
  return null;
}

// Sorteringsværdi for potentiale-kolonner: SAMME tal spilleren rent faktisk
// læser. Bruges til at dekorere rytter-rækker (fx `_scoutMid`) så klient-side
// tabel-sortering virker uden adgang til den rå potentiale.
//
// #3787: prioritetsrækkefølgen matcher PRÆCIS ScoutablePotentiale.jsx's
// render-gren (der er visningen, ikke denne funktion, der er sandheden):
//   1) `estimate.prog` — prognose-båndet (#3746), alias `estimate.ceil` for
//      ældre payloads — rating-båndet spilleren ser i tabellen/kortet ved
//      siden af. Sorteringen brugte tidligere den GAMLE 1-6-stjerneskala
//      (lo/hi) så rækkefølgen ikke matchede det viste tal — selve #3787-bug'en.
//   2) lo/hi (stjerneskalaen) som fallback for payloads uden bånd (rytter
//      mangler primary_type/evne-data — den defensive gren i
//      ScoutablePotentiale.jsx, eller ældre klient-cache).
// undefined/null (ikke hentet) ELLER skjult/uscoutet (#1543) → `null`,
// EKSPLICIT adskilt fra 0 (som ville kollidere med en reel lav rating og
// give indtryk af en vurdering der ikke findes). Sorterings-komparatorerne
// (riderColumnSort.js / useTableSort.js) placerer `null` sidst uanset
// sorteringsretning.
export function scoutSortValue(estimate) {
  if (!estimate || estimate.hidden) return null;
  const band = estimate.prog ?? estimate.ceil;
  if (band && Number.isFinite(band.lo) && Number.isFinite(band.hi)) {
    return (band.lo + band.hi) / 2;
  }
  if (!Number.isFinite(estimate.lo) || !Number.isFinite(estimate.hi)) return null;
  return (estimate.lo + estimate.hi) / 2;
}

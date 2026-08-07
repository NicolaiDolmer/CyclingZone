// #3509 — gold-CTA prioritetskæde for dashboardet: ren logik, ingen DB, ingen
// React (samme mønster som seasonStartGuide.js). Design-reglen (docs/design/
// PAGE_TEMPLATES.md, bindende) siger maks ÉN gold primary-knap pr. view, men
// tre uafhængige dashboard-kort kunne alle kvalificere sig samtidig:
//   1. MyLatestResultCard's first-race-moment CTA
//   2. TeamSelectionCtaCard's "Vælg trup"-CTA (squadSelectionMissingRace)
//   3. SeasonWrapNudgeCard's "View recap"-CTA
//
// Uden en eksplicit rangorden rammer (2) og (3) samtidig lige efter et
// sæsonskifte: recap'et er ikke dismisset ENDNU, og den nye sæsons
// holdudtagelse mangler ENDNU — begge betingelser er uafhængige af hinanden.
//
// Rangorden (ejer-godkendt via #3509): first-race-moment > squad-CTA >
// season-wrap. Kun den højst-prioriterede aktive kandidat får guld; resten
// falder tilbage til sekundær variant.
export function computeDashboardGoldCta({
  firstRaceMomentActive,
  squadCtaEligible,
  seasonWrapVisible,
}) {
  const firstRaceMoment = Boolean(firstRaceMomentActive);
  const squadCtaActive = !firstRaceMoment && Boolean(squadCtaEligible);
  const seasonWrapPrimary = Boolean(seasonWrapVisible) && !firstRaceMoment && !squadCtaActive;

  return {
    firstRaceMoment,
    squadCtaActive,
    seasonWrapPrimary,
  };
}

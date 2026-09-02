// #3509 — gold-CTA prioritetskæde for dashboardet: ren logik, ingen DB, ingen
// React (samme mønster som seasonStartGuide.js). Design-reglen (docs/design/
// PAGE_TEMPLATES.md, bindende) siger maks ÉN gold primary-knap pr. view, men
// FIRE uafhængige dashboard-kort kan alle kvalificere sig samtidig:
//   1. MyLatestResultCard's first-race-moment CTA
//   2. TeamSelectionCtaCard's "Vælg trup"-CTA (squadSelectionMissingRace)
//   3. [epic #4592 del 3] SeasonSignupCard's "Sign up for next season"-CTA
//   4. SeasonWrapNudgeCard's "View recap"-CTA
//
// Uden en eksplicit rangorden rammer (2) og (4) samtidig lige efter et
// sæsonskifte: recap'et er ikke dismisset ENDNU, og den nye sæsons
// holdudtagelse mangler ENDNU — begge betingelser er uafhængige af hinanden.
//
// Rangorden (ejer-godkendt via #3509; (3) tilføjet #4592 mellem (2) og (4) —
// et konkret "vælg trup til DENNE uges løb"-behov er mere tidskritisk end en
// nudge om et sæsonskifte uger ude, som igen er mere handlingsorienteret end
// en ren facit-visning af den AFSLUTTEDE sæson): first-race-moment >
// squad-CTA > season-signup > season-wrap. Kun den højst-prioriterede aktive
// kandidat får guld; resten falder tilbage til sekundær variant.
export function computeDashboardGoldCta({
  firstRaceMomentActive,
  squadCtaEligible,
  seasonSignupEligible,
  seasonWrapVisible,
}) {
  const firstRaceMoment = Boolean(firstRaceMomentActive);
  const squadCtaActive = !firstRaceMoment && Boolean(squadCtaEligible);
  const seasonSignupPrimary = !firstRaceMoment && !squadCtaActive && Boolean(seasonSignupEligible);
  const seasonWrapPrimary =
    Boolean(seasonWrapVisible) && !firstRaceMoment && !squadCtaActive && !seasonSignupPrimary;

  return {
    firstRaceMoment,
    squadCtaActive,
    seasonSignupPrimary,
    seasonWrapPrimary,
  };
}

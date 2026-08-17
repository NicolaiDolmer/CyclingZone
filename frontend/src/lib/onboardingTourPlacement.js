// #3008: OnboardingTour-placeringsmatematik udskilt til egen fil (pure,
// unit-testbar uden JSX — repoets node --test har ingen JSX-loader, jf.
// onboardingTourTarget.js).
//
// Bug: OnboardingTour.jsx brugte en fast `heightEstimate = 160` til at
// afgøre om tooltip'en skulle placeres over eller under sit target, og til
// at beregne dens top-position når den lå over. På 360px bredde ombryder
// tooltip-teksten (fast 300px bred) ofte over flere linjer, så den faktiske
// højde langt overstiger 160px — overskuddet lagde sig enten hen over
// target'et (når placeret over) eller blev klippet af mobilens bund-nav
// (når placeret under, tæt på bunden af viewport).
//
// Fix: OnboardingTour.jsx måler nu den faktiske tooltip-højde (ResizeObserver
// på tooltip-elementet) og sender den ind her i stedet for et gæt. Denne
// funktion klemmer resultatet ind i [margin, viewportH - bottomReserve -
// margin] uanset om highedt er målt eller (for allerførste render af et nyt
// trin, før måling) det gamle faste gæt.
export function computeTooltipPlacement({
  rect,
  height,
  viewportW,
  viewportH,
  tooltipWidth = 300,
  margin = 12,
  bottomReserve = 0,
}) {
  const availableBottom = viewportH - bottomReserve;
  // Under target hvis der er plads under (inkl. bund-reserve), eller hvis der
  // slet ikke er plads over — ellers over.
  const placeBelow = (rect.bottom + height + margin) <= availableBottom || rect.top < height + margin;

  const rawTop = placeBelow ? rect.bottom + 12 : rect.top - height - 12;
  // Klem ALTID ind i det tilgængelige viewport minus bund-reserve (fx mobilens
  // faste bund-nav) — uanset placeBelow-grenen, så et for stort/målt-sent
  // gæt aldrig skubber tooltip'en uden for skærmen eller bag bund-navigationen.
  const maxTop = Math.max(margin, availableBottom - height - margin);
  const tooltipTop = Math.max(margin, Math.min(rawTop, maxTop));

  const targetCenterX = rect.left + rect.width / 2;
  const tooltipLeft = Math.max(
    margin,
    Math.min(viewportW - tooltipWidth - margin, targetCenterX - tooltipWidth / 2),
  );
  const arrowOffset = Math.max(20, Math.min(tooltipWidth - 20, targetCenterX - tooltipLeft));

  return { placeBelow, tooltipTop, tooltipLeft, arrowOffset };
}

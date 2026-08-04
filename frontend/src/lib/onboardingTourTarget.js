// #3007: OnboardingTour-hjælper udskilt til egen fil (pure, unit-testbar uden
// JSX — repoets node --test har ingen JSX-loader, jf. lib/teamDrafted.js).
//
// Flere sider rendrer to elementer med samme data-tour-attribut: en
// mobil-kort-variant (md:hidden, DOM-rækkefølge FØRST) og en desktop-variant
// (hidden md:block, DOM-rækkefølge SIDST) — se AuctionsPage.jsx. En almindelig
// document.querySelector() rammer altid det FØRSTE match uanset synlighed. På
// desktop var det den skjulte mobil-variant; getBoundingClientRect() på et
// display:none-element giver et nul-rect (ikke null), så OnboardingTour troede
// den havde et gyldigt mål og rendrede sin highlight-ring/tooltip i øverste
// venstre hjørne i stedet for om det faktiske mål (fx bud-feltet).
//
// findVisibleTarget vælger i stedet det første match der faktisk er synligt
// (offsetParent !== null); falder tilbage til første match hvis ingen er
// synlige (fx target findes slet ikke endnu — bevarer eksisterende
// fallback-adfærd i OnboardingTour).
//
// doc-parameter (default document) så funktionen kan enheds-testes med en
// minimal fake DOM.
export function findVisibleTarget(selector, doc = document) {
  const candidates = doc.querySelectorAll(selector);
  for (const el of candidates) {
    if (el.offsetParent !== null) return el;
  }
  return candidates[0] || null;
}

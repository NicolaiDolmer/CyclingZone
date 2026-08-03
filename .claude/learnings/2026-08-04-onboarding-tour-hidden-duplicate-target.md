# OnboardingTour querySelector ramte skjult mobil-duplikat på desktop (#3007)

**Dato:** 2026-08-04
**Issue/PR:** [#3007](https://github.com/NicolaiDolmer/CyclingZone/issues/3007)

## Hvad skete

Funnel-måling af de 67 rigtige hold der aldrig har lagt et auktionsbud viste at
den STØRSTE addressérbare gruppe (22/41 hold der overhovedet har en session)
åbnede `/auctions` men aldrig bød. #3007 havde allerede identificeret en
konkret bug i den flade: `OnboardingTour.jsx` brugte
`document.querySelector(current.target)` til at finde tour-ankeret.
`AuctionsPage.jsx` rendrer to elementer med samme `data-tour`-attribut — en
mobil-kort-variant (`md:hidden`, DOM-rækkefølge FØRST) og en desktop-variant
(`hidden md:block`, DOM-rækkefølge SIDST). `querySelector` rammer altid det
FØRSTE match uanset synlighed, så på desktop fangede tour'en den skjulte
mobil-variant. `getBoundingClientRect()` på et `display:none`-element giver et
**nul-rect, ikke `null`** — komponentens fallback-check (`if (!rect)`) trigger
derfor ALDRIG, og highlight-ring + tooltip rendres i øverste venstre hjørne af
skærmen i stedet for om bud-feltet.

## Lærdom

`document.querySelector(selector)` returnerer det første DOM-match, ikke det
første SYNLIGE match. Enhver kode der bruger responsive duplikat-mønstre
(`md:hidden` + `hidden md:block` på samme data-attribut, en almindelig
CyclingZone-idiom for mobil/desktop-varianter af samme række) og derefter
`querySelector`'er på den delte attribut, rammer denne fælde — og fejlen er
usynlig i tests, fordi `target` er truthy (elementet findes), kun dets
`getBoundingClientRect()` er tomt.

## Forebyggelse (forward-guard)

- Byggede `findVisibleTarget(selector, doc)` i `frontend/src/lib/onboardingTourTarget.js`
  — vælger første match med `offsetParent !== null`, falder tilbage til
  første match hvis ingen er synlige (bevarer eksisterende fallback-adfærd).
  `OnboardingTour.jsx` bruger den nu i stedet for rå `querySelector`.
- Generelt mønster: ved `querySelector` på en attribut der kan optræde i BÅDE
  en mobil- og desktop-variant af samme komponent, tjek altid synlighed
  (`offsetParent`/`getClientRects().length`) — antag ikke at "element findes"
  betyder "element er det du ser".
- `getBoundingClientRect()` på skjulte elementer er et nul-rect, ikke `null`.
  Fallback-logik der kun tjekker `!target`/`!rect` ser ALDRIG denne case —
  tjek i stedet om rect'et rent faktisk har mål (`rect.width > 0`).

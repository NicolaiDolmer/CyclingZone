# Postmortem · 2026-08-17 · OnboardingTour-tooltip: fast højde-gæt vs. målt højde

## Hvad skete der?
`OnboardingTour.jsx` brugte et fast `heightEstimate = 160` til at afgøre om
tooltip'en skulle placeres over eller under sit target, og til at beregne
`tooltipTop` når den lå over. På 360px bredde ombryder tooltip-teksten (fast
300px bred) ofte over 3+ linjer, så den faktiske renderede højde (op mod
280px) langt oversteg gættet — resultatet var enten et tooltip der dækkede
det target det introducerede (placeret over), eller et der blev klippet af
mobilens faste bund-navigation (placeret under, tæt på bunden). #3008.

## Root cause
Placeringsmatematikken brugte en konstant i stedet for elementets egen
`getBoundingClientRect().height` — en klassisk "gæt størrelsen på noget der
endnu ikke er rendert" antagelse, der holder for KORTE tekster (EN) men
brister for lange/ombrudte (DA, eller bare et længere step-body).

## Fix
- Udskilte placerings-matematikken til en ren, testbar funktion
  (`frontend/src/lib/onboardingTourPlacement.js` → `computeTooltipPlacement`)
  der tager den FAKTISKE højde som parameter og altid klemmer resultatet ind
  i `[margin, viewportH - bottomReserve - margin]`.
- `OnboardingTour.jsx` måler nu tooltip-elementets rigtige højde synkront med
  `useLayoutEffect` + `getBoundingClientRect()` (ikke `ResizeObserver`, se
  nedenfor) og sender den ind i stedet for gættet. `useLayoutEffect` kører
  FØR browseren maler, så en evt. korrektion sker uden synligt "hop".
- `bottomReserve` (56px, matcher `MobileQuickNav`s faste højde) forhindrer at
  tooltip'en lægger sig bag mobilens bund-nav.

## Forhindret-fremover
`frontend/src/lib/onboardingTourPlacement.test.js` reproducerer bug-scenariet
direkte (samme rect/viewport-tal som #3008 observerede) og assert'er at den
gamle 160px-baserede overlap IKKE længere sker. Al fremtidig
placerings-logik i denne komponent bør ligge i den rene funktion, ikke
tilbage i JSX'en, så den forbliver unit-testbar uden en browser.

## Læring
**ResizeObserver-callbacks (og rAF) kan udeblive helt på en side hvor
`document.visibilityState === "hidden"`** — observeret direkte i dette
Claude Browser-værktøjs miljø (subagent-sessioner uden en synlig bruger-pane
har `document.hidden === true`, og selv en helt frisk, isoleret
`ResizeObserver` fyrede aldrig, uanset ventetid). `getBoundingClientRect()`
(synkron layout-læsning) virker derimod uafhængigt af sidens synlighed. Hvis
et fix er afhængigt af at måle noget der lige er rendert, foretræk en
synkron `useLayoutEffect`-måling frem for en async observer — det er
hurtigere (ingen synligt hop) OG verificerbart i miljøer hvor async
rendering-callbacks kan være strubet (baggrunds-faner, headless
test-kørsler, denne agent-browser). Samme grund til at screenshots ikke
kunne tages i denne session (`computer screenshot` fejlede eksplicit med
"Browser pane is not displayed, so the page is not compositing frames") —
DOM/JS-baseret verifikation (`getBoundingClientRect` via `javascript_tool`)
var den pålidelige vej, ikke visuel screenshot-inspektion.

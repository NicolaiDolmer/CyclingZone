# Usynlige tooltips gjorde siden bredere end telefonen (#6728)

**Symptom:** Løbssiden var 461 px bred på en 375 px skærm og kunne swipes sidelæns på Android. Managerprofilen var 385 px. Fundet ved overløbs-gennemgangen 16/10. Ingen spiller havde meldt det.

**Rodårsag:** `Tooltip.jsx` renderede altid boblen. Den var `opacity-0`, absolut placeret og `w-max max-w-xs`. En usynlig boble tæller stadig med i sidens `scrollWidth`. Når ankeret står ved højre kant (mærket "Bunch sprint"), stak den lukkede boble 86 px ud over skærmen. Achievement-boblen på managerprofilen var bygget på samme måde.

**Rettelse:** En lukket boble renderes ikke. En åben boble renderes i en Portal med `position: fixed` og placeres med `placeTooltip()` (`tooltipPlacement.ts`), så den altid ligger mindst 8 px inde fra kanten. Det er samme greb som `MarkerTip` (#6185), der allerede havde løst det for udbrudsmærket.

**Læring:**
- `opacity-0` og `visibility: hidden` skjuler kun pixels. Elementet fylder stadig i layoutet og i `scrollWidth`. Et skjult lag, der må stikke ud over kanten, skal enten ikke renderes eller ligge `fixed` i en Portal.
- Automatiske overløbstjek skal måle `document.documentElement.scrollWidth > clientWidth` *og* lede efter usynlige synder. Et filter, der kun ser synlige elementer, finder ikke årsagen (overløbs-scriptet 16/10 fandt sidebredden, men først et debug-gennemløb uden synligheds-filter fandt boblen).

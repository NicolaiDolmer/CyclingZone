# Font-async loading: CLS-trade-off der spiste FCP-gevinsten

**Dato:** 2026-05-18
**Kontekst:** #361 (Founder Supporter landing) → #479 (mobile-perf follow-up)
**Commits:** f166f87 (eksperiment) → d6987a1 (revert)

## TL;DR

Skiftet DM Sans Google Fonts fra render-blocking `<link rel="stylesheet">` til Filament Group's Loadcss-pattern (`rel="preload" as="style" onload="...rel='stylesheet'"`) for at reducere mobile FCP. **Reverteret efter måling**: mobile Performance score gik 78 → 74-75 (-3 til -4 point). CLS gik 0 → 0.092. LCP forværredes 0.2-0.4s.

## Hypotese der svigtede

"Render-blocking stylesheets er det største bidrag til FCP. Async-promotion skulle hive FCP fra 3.9s ned."

**Hvorfor det svigtede:** Font-display: swap (allerede i URL) sikrer at tekst er synlig under font-load, men når DM Sans loader, swapper browseren fra fallback (Arial) → DM Sans → reflow → CLS. Loadcss-pattern uden matching system-font-fallback giver kortvarig FOUT der koster mere i CLS end den vinder i FCP.

## Hvorfor jeg ikke fangede det før push

- Forventede positiv effekt baseret på pattern's velkendte ROI for sites med større stylesheet-bundles.
- Glemte at Google Fonts CSS er allerede lille (~3 KB) — gevinsten var marginal.
- Manglede simulation: kunne have brugt Chrome DevTools throttling lokalt FØR push for at se CLS-impact.

## Hvad jeg gør anderledes næste gang (på #479)

1. **Mål FØR push:** Kør Lighthouse mobile lokalt med ny config FØR commit, ikke kun efter prod-deploy. Mit "build verify" var build-success ≠ runtime-performance.

2. **Læs Lighthouse-diagnostics, ikke kun score:** I første Lighthouse-run var CLS = 0. Score 78. Min ændring kunne forudsigeligt skade CLS, men jeg fokuserede kun på "potentially reduce FCP".

3. **Font-display: optional eller size-adjust fallback:** Næste foreksoeg skal definere `@font-face` med fallback der matcher DM Sans metrics — så swap ikke giver visual shift. Eller `font-display: optional` der falder tilbage til system-font for cold loads.

4. **Bundle-split før font-optim:** 640 KB main bundle er meget større bidrag til FCP end Google Fonts. Code-splitting har højere ROI.

## Backwards-check + forward-guard (per memory feedback_backwards_check_forward_guard)

**Backwards:** Søgte for andre `rel="preload" as="style"` patterns i kodebasen — ingen andre findes. Ingen regression-risiko fra dette pattern.

**Forward:** Pre-deploy Lighthouse-check inden font-related ændringer bør være obligatorisk. Tilføjet som krav i #479 acceptance criteria: "Ingen regression på desktop Performance (skal forblive 90+)".

## Referencer

- #361 Founder Supporter landing page
- #479 Mobile Performance optim follow-up (har min komplette eksperiment-rapport som kommentar)
- [Loadcss pattern (Filament Group)](https://github.com/filamentgroup/loadCSS)
- [font-display: optional](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display#optional)

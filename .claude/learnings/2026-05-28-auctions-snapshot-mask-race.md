# Postmortem · 2026-05-28 · Auctions snapshot mask race

## Hvad skete der?
`core-smoke.spec.js` flakede intermittent på `/auctions` i mobile Chromium med stor `auctions.png` pixel-diff. Issue #512 trace-artifacts viste, at expected/actual kunne variere mellem delvist og fuldt maskede tekst-elementer.

## Root cause
Screenshot-readiness ventede på synligt Auctions-indhold, men ikke på at font-render, `main`-layout og `TEXT_MASK_SELECTOR` element-count var stabilt. Playwright kunne derfor tage snapshot før eller efter React/hydration havde produceret samme mask-target-set.

## Fix
`frontend/tests/e2e/core-smoke.spec.js` venter nu før hver visual snapshot på `document.fonts.ready` og flere animation frames med stabil `main` size plus stabil tekst-mask element-count.

## Forhindret-fremover
Visual smoke snapshots skal gate på den konkrete snapshot-overflade og de mask-selectors, som assertionen bruger. Almindelig "loader er væk" er ikke nok, når masken selv kan ændre pixel-outputtet.

## Læring
Når en masket snapshot flaker, sammenlign expected/actual mask-dækning før baseline-regenerering. En renere actual kan være mere korrekt end expected, hvis expected blev taget mid-render.

# Visual snapshots skal være layout-only, ikke tekst-pixel-pinned

**Dato:** 2026-05-17
**Trigger:** [PR #461](https://github.com/NicolaiDolmer/CyclingZone/pull/461) (i18n Fase 3a Dashboard) ramte `frontend-smoke` snapshot-diff på 5-13% pixels — text re-rendering efter i18n-konvertering, ikke layout-regression.

## Problemet

`core-smoke.spec.js` brugte fuld pixel-snapshot af 8 hovedsider via `toHaveScreenshot()`. Hver gang en tekst-streng ændrede sig (i18n, copy-tweak, format-justering, ICU-plural-output), failer testen — selv om layout, components og struktur var uændret. Med 3 i18n-faser tilbage + løbende copy-arbejde ville hver eneste PR have brug for manuel snapshot-regenerering.

**Konsekvens hvis ikke fixet:** trust-erosion. Når smoke-testen altid er rød "men på en kendt måde," ignoreres ægte visuelle regressions.

## Fixet

Tekst-bærende elementer maskes nu i `toHaveScreenshot()` via Playwright's `mask` option:

```js
const TEXT_MASK_SELECTOR = "main :is(h1,h2,h3,h4,h5,h6,p,span,a,button,li,td,th,label,time,strong,em,dt,dd)";
// ...
mask: [page.locator(TEXT_MASK_SELECTOR)],
maxDiffPixelRatio: 0.05,
```

Pink masks (Playwright-default) dækker tekst-regioner. Layout (cards, sections, baggrunde, billeder, ikoner) sammenlignes uændret. `maxDiffPixelRatio` bumped fra 0.03 → 0.05 for mask-edge anti-aliasing-tolerance når elementer auto-sizer efter masked tekst-længde.

## Hvad smoke-testen fanger nu

- ✅ Blank screen (alle pink-bokse forsvinder)
- ✅ Manglende card / section (hel hvid-bordered region forsvinder)
- ✅ Wrong theme/colors (header-bar bliver lys, baggrund skifter)
- ✅ Layout-bryd på mobile/desktop (kolonner kollapser, cards stacker forkert)
- ✅ Page-errors (JS exceptions stadig assertet via `page.on("pageerror")`)
- ✅ Heading-existens (`getByRole("heading")` stadig assertet)

## Hvad smoke-testen IKKE fanger længere (med vilje)

- ❌ Text content (valideres via `i18n-check-keys.mjs` + unit tests)
- ❌ Font-rendering subtleties
- ❌ Microcopy-tweaks

## Backwards-check

Andre snapshot-tests i repo: **kun denne fil bruger `toHaveScreenshot`** (verificeret via `grep -r "toHaveScreenshot" frontend/tests/`). Ingen yderligere refactor nødvendig.

## Forward-guard

- Comment i `core-smoke.spec.js` peger tilbage på denne learning
- Når en ny i18n-fase laves: snapshot-test skal "bare virke" — ingen manuel regenerering
- Hvis fremtidige snapshot-tests tilføjes (fx for Auctions modal-flows): brug samme `TEXT_MASK_SELECTOR`-pattern, eller skriv konkret hvorfor ikke

## Tids-besparelse

- Per i18n PR: ~10 min sparet (ingen snapshot-regen + Chrome MCP-verifikation)
- 3 i18n-faser tilbage × 10 min = ~30 min direkte besparelse
- Plus uvurderlig: snapshot-test forbliver troværdig, ikke ignoreret som "kendt-rød"

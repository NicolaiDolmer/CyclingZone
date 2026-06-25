# Postmortem · 2026-06-25 · Manglende `min-w-0` på `<main>` → mobil-overflow → Playwright-klik ramte nabolayout

## Symptom
`race-selection.spec.js` ("manager kan udtage hold og gemme") fejlede **deterministisk på mobile-chromium**: klik på gem-knappen timeoutede fordi "et element intercepter pointer events" — skiftevis en `Rider 6`-tabel-span og en RoleSelect-label. Playwright kaldte knappen "visible, enabled, stable", men klikket landede aldrig. Reproduceret på ren origin/main (ikke branch-introduceret).

## Root cause
`<main className="flex-1 md:ms-52 min-h-screen">` i `Layout.jsx` er en flex-child uden `min-w-0`. Flex-items har default `min-width: auto`, så `<main>` kunne ikke krympe under sit indholds min-content-bredde. En 488px bred rytter-tabel (i `overflow-x-auto`) blæste `<main>` ud til 522px → horizontal overflow på 393px mobil-viewport → **Chromiums mobile shrink-to-fit skalerede hele siden 0.753×** (`window.innerWidth` 393→522, `visualViewport.scale` ≠ 1).

Den skalering bryder Playwrights input-koordinat-mapping: `boundingBox()`/muse-koordinater lever i device-space (393), men sidens `elementFromPoint`/`getBoundingClientRect` i den skalerede CSS-space (522). `saveBtn.boundingBox()` gav center (67, 694); knappen rendrede reelt på y=956–992. `elementFromPoint(67,694)` = en tabelrække → interception. Ikke et synligt overlap, ikke en flake.

## Diagnostik der knækkede den (genbrugeligt mønster)
Den afgørende måling: **sammenlign Playwrights `boundingBox()` med sidens egen `getBoundingClientRect()` for SAMME element.** Når de er uenige på en `isMobile`-viewport → koordinat-rum-mismatch fra page-skalering, ikke et DOM-overlap. Bekræft med `window.innerWidth` vs projektets viewport-bredde og `visualViewport.scale`. `innerWidth ≠ device-viewport-bredde` ⇒ horizontal overflow et sted. Find kilden ved at gå op ad chain'en til den flex-child der er bredere end sin parent.

## Fix
`min-w-0` på `<main>`. Så krymper flex-child'en til viewporten; den brede tabel scroller i sin `overflow-x-auto`-wrapper i stedet for at strække siden. `innerWidth` → 393, ingen overflow, klik rammer knappen. Verificeret alle 3 playwright-projekter + fuld e2e. Snapshots (riders+team mobil) refreshet — de gamle baselines havde fanget den skalerede/afskårne render.

## Læring
1. **`flex-1` på en hovedindholds-kolonne skal næsten altid have `min-w-0`.** Uden den lader `min-width: auto` bredt indhold (tabeller, `whitespace-nowrap`, lange ord) blæse kolonnen ud over viewporten. Klassisk Tailwind/flexbox-footgun. Dette var rod-årsagen bag 3 andre tests' `narrow-mobile pointer-intercept`-workarounds (`race-distribution`, `manager-achievement-progress`, `filter-reset`) — symptom-patchet i testen i stedet for at fixe shell'en.
2. **"Element intercepts pointer events" på mobil-emulering ≠ altid et z-index-overlap.** Når siden overflower og shrink-to-fit'er, er det en koordinat-mismatch. Tjek `boundingBox` vs `getBoundingClientRect` FØR du leder efter overlay/z-index.
3. **`overflow-x-auto` virker kun hvis en ancestor må krympe.** En scroll-wrapper i blok-flow constrainer ikke sig selv hvis den flex-ancestor den hænger under vokser med content. Fix bredden hvor flex-shrink blokeres (her: `<main>`), ikke kun på wrapperen.
4. Advisory `frontend-smoke` lod denne ægte e2e/visuelle fejl drive stille (jf. `feedback_refresh_core_smoke_snapshots` + læring i `2026-06-25-advisory-gate-let-snapshot-drift-through.md`).

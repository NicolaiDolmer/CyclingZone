# Pixel-masken skjulte badge-farver — og det første fix var selv en attrap (#3684)

**Dato:** 2026-08-18 · **Issue:** #3684 · **Kontekst:** Landing 1 (#3666) lagde hele rating-skalaen om (median 59 → 13 + nyt plade-design), og 12 pixel-snapshots × 3 projekter rørte sig ikke én pixel.

## Rod-årsag (to lag)

1. **Masken:** `TEXT_MASK_SELECTOR` masker alle tekstbærende tags i `main`. Playwright maler HELE elementets bounding box, så rating-plader/evne-chips (inline `background-color` via `statColor.js`) ligger under masken på alle side-snapshots. En farve-regression kan ikke fejle dér.
2. **Det første fix var inert:** `:not([style*="background"])` på selectoren så rigtigt ud, men pladerne sidder i `td`-celler som SELV er i tag-listen — forælderens maske maler barnet over uanset. Målt: fuld snapshot-refresh med undtagelsen gav **0 ændrede filer**.

## Anden fælde: tolerancen åd regressionen

Første ombygning (statColor-sektion i det umaskerede kitchen-sink-snapshot) bestod sin NEGATIV-test ikke: en helt grå plade-rampe passerede, fordi 12 små chips drukner i `maxDiffPixelRatio: 0.02` på et fullPage-billede. Vagten skulle være et ELEMENT-snapshot (`stat-colours.png`, `maxDiffPixels: 50`) før den grå rampe faktisk brækkede alle 3 projekter.

## Fix

- Masken er uændret (den løser et ægte problem: tekst-churn skal ikke give røde snapshots).
- `/ui` (kitchen-sink) har nu en "Stat colours (#3684)"-sektion: `statPlateStyle` + `statStyle` ved 8/25/45/65/85/99, markup 1:1 med RidersPage' celler, med eget element-snapshot pr. projekt.

## Læringer

1. **En snapshot-vagt er først bevist når dens NEGATIV-test fejler.** "Snapshots refreshed, alt grønt" beviser intet — kør en bevidst regression igennem og se den brække. To attrap-varianter i træk bestod her den grønne vej.
2. **Playwright-masker dækker børn:** en `:not()`-undtagelse på et barn hjælper ikke når forælderen også maskes.
3. **fullPage + ratio-tolerance ≈ blind for små elementer.** Komponent-vagter skal være element-snapshots med absolut pixel-grænse.

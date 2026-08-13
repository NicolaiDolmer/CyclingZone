# Pixel-snapshottene maskerede præcis det de skulle vogte

**Dato:** 2026-08-14 · **Slice:** landing 1 (#3666 / PR #3683) · **Opfølgning:** #3684

## Hvad skete der

Landing 1 lagde hele rating-skalaen om. Hver rytters viste tal skiftede (median 59 → 13), og rating-badgen gik fra en bleg tint med farvet tekst til et fyldt felt med kontrast-blæk. Kravspec'en forventede — rimeligt nok — at 12 pixel-snapshots × 3 playwright-projekter ville brække og skulle fornys.

Fuld suite kørt med `--update-snapshots`: 413 passed, 0 failed, og **nul snapshot-filer ændrede sig**.

Det så først ud som en gave. Det var et hul.

## Rod-årsagen

```js
export const TEXT_MASK_SELECTOR =
  "main :is(h1,h2,h3,h4,h5,h6,p,span,a,button,li,td,th,label,time,strong,em,dt,dd)";
```

Masken males over før sammenligningen. Rating-pladen er en `<span>` inde i `<main>`, så **både tallet og badgens baggrundsfarve** ligger under masken. `riders.png`, `team.png` og `auctions.png` viser alle rating- og potentiale-kolonner og rørte sig ikke én pixel.

Masken er ikke i sig selv forkert. Den blev indført så tekst-ændringer ikke gav falske røde snapshots. Fejlen er at `span` er så bred en kategori at den også dækker badges, statusflader og farveplader — altså netop de elementer hvor en pixel-sammenligning er det eneste der kan fange en regression.

## Hvorfor det er den samme fejl som dagen før

Transparens-sessionen 13/8 fandt tre lag uden dækning der skjulte hinanden. Dette er samme klasse: **en gate der ser ud til at dække noget, den ikke dækker.** Snapshottene kørte. De var grønne. De pegede på de rigtige sider. Og de bidrog nul.

Det farlige er ikke at dækningen mangler — det er at fraværet ligner tilstedeværelse. Havde jeg ikke haft en konkret forventning ("12 snapshots skal brække"), ville de nul ændringer være passeret som "ingen visuel regression" i stedet for "ingen visuel dækning".

## Reglen der følger

**Når en ændring IKKE brækker en test man forventede den ville brække, er det et fund — ikke et held.** Undersøg hvorfor før du går videre. En grøn test der burde have været rød er et stærkere signal om manglende dækning end en test der aldrig fandtes, fordi den aktivt beroliger.

Praktisk: formulér forventningen FØR kørslen ("dette skal brække X"), og behandl et afvigende resultat som et instrument-spørgsmål. Samme disciplin som `2026-08-14-preview-verificerede-den-forkerte-kodebase.md`: bekræft at måleren måler, før måleresultatet tolkes.

## Hvad der faktisk gav dækning i denne PR

- `statColor.contract.test.js` — monotoni, kontrastgulv, farveblind-adskillelse i rampen
- `seedData.consistency.test.js` — at fladerne er enige om samme rytters tal (ny; skrevet efter at seedet blev fanget i at modsige sig selv tre steder)
- `primaryLineAgreement.test.js` — at frontend og backend vælger samme primærlinje (ny)
- `riderRating.test.js` + `scoutingReport.test.js` — selve modellen
- `scouting-verdict.spec.js` — adfærd, ikke pixels

Ingen af dem er pixel-snapshots. Det er værd at huske næste gang en visuel ændring "kun" mangler et snapshot-refresh.

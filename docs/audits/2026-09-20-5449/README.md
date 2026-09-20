# #5449 — før/efter da Tailwind-globben fik `.ts`/`.tsx`

Målt 20/9 2026 i worktreet `fix/5449-tailwind-content-tsx`, to prod-builds af
`frontend/` der KUN adskiller sig ved `content` i `frontend/tailwind.config.js`:

| | glob |
|---|---|
| `before/` | `["./index.html", "./src/**/*.{js,jsx}"]` |
| `after/` | `["./index.html", "./src/**/*.{js,jsx,ts,tsx}"]` |

Markup, data og mocks er identiske i de to gennemløb, så hver forskel på
billederne ER en klasse der manglede i CSS'en.

Billederne tages af `frontend/tests/e2e/5449-tailwind-content.shots.mjs`
(ad-hoc capture-script, ikke i CI-suiten):

Begge kommandoer køres fra repo-roden:

```
npm --prefix frontend run build
node frontend/tests/e2e/5449-tailwind-content.shots.mjs <outDir>
```

Fire kombinationer pr. flade: desktop 1440×900 og mobil 390×844, lyst og mørkt.

## Klasser der kommer til

10 klasser, 0 forsvinder (målt på den byggede CSS, 114.753 → 115.353 bytes):

| Klasse | Fil | Flade |
|---|---|---|
| `fill-cz-subtle` | `components/training/TrainingScoreSparkline.tsx` | Daglig træning (Score-kolonnen) + rytterprofilens Træning-fane |
| `stroke-cz-1` | `components/training/TrainingScoreSparkline.tsx` | samme |
| `border-s-0` | `components/training/mobile/TrainingProgramGrid.tsx` | mobil-træning bag `training_mobile_table` |
| `pe-1` | `components/training/mobile/TrainingProgramGrid.tsx` | samme |
| `table-fixed` | `components/training/mobile/TrainingMobileRoster.tsx` | samme |
| `border-separate` | `components/training/mobile/TrainingMobileRoster.tsx` | samme |
| `border-spacing-0` | `components/training/mobile/TrainingMobileRoster.tsx` | samme |
| `w-[124px]` | `components/training/mobile/TrainingMobileRoster.tsx` | samme |
| `tracking-[.09em]` | `components/training/mobile/TrainingMobileRiderCard.tsx`, `TrainingRaceDayStrip.tsx` | samme |
| `space-y-px` | `components/planning/SelectionDeadlineReminder.tsx` | Planlægning |

## Kontrol

"Alle handler"-fanen (`pages/TradeListPage.tsx`) er også `.tsx`, men alle dens
klasser fandtes i forvejen fra en `.jsx`-fil. `5449-trades-desktop-*.png` er
derfor **byte-identiske** før/efter — beviset for at globben ikke ændrer noget
der ikke manglede. (Mobil-udgaven afviger med 8-54 pixels af styrke ≤21 i
tekst-antialiasing; ingen af de 10 klasser bruges på den flade.)

## Målte forskelle

| Billede | Forskel |
|---|---|
| `5449-sparkline-list-desktop-*` | Sort klat → 2 px streg med lyst fyld |
| `5449-sparkline-card-desktop/mobile-*` | Sort klat → 2 px streg med lyst fyld |
| `5449-training-desktop-*` | 3.456 px ændret, alle i Score-kolonnen |
| `5449-planning-reminder-*` | Højde 136 → 137 px (`space-y-px` giver 1 px mellem de to løb) |
| `5449-training-mobile-roster-mobile-*` | Højde 403 → 493 px: `table-fixed` + `w-[124px]` giver TODAY sin egen faste kolonne, og rytter-metalinjen ombrydes til to linjer |
| `5449-trades-desktop-*` | 0 px (kontrol) |

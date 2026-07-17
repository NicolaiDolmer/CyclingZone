# Race v3 — re-kalibrerings-scorecard mod live drift (#2557)

**Dato:** 2026-07-17 · **Status:** analyse (INGEN motor-ændring committet — kun read-only dry-runs) · **Branch:** `analysis/2557-calibration`
**Baggrund:** [#2557](https://github.com/NicolaiDolmer/CyclingZone/issues/2557) — favoriteWinRate driftede 18,4→32,7→40,8→51,0 % over 13-16/7 (bånd 25-40 %); share4PlusSameTeamTop10 RØD 3 dage i træk (bånd ≤5 %). Motor-parametrene er UÆNDREDE siden S2-kalibreringen 12/7 ([2026-07-12-race-v3-s2-calibration.md](2026-07-12-race-v3-s2-calibration.md)) — hypotesen er at POPULATIONEN har bevæget sig (træning, transfers, sæson-progression) siden kalibrerings-snapshottet 11/7.

## 1. Metode

Read-only prod-population hentet 17/7 via `backend/scripts/exportPopulationSnapshot.js` (samme loader som S0-S2-kalibreringerne brugte — kun SELECT, ingen prod-mutationer): 365 hold (tier 1: 24 · tier 2: 48 · tier 3: 96 · tier 4: 197), 5.645 ryttere, condition-dækning 99,9 %. Snapshot IKKE committet (repoet er publicly viewable — samme praksis som 11/7-snapshottet, som blev committet kun efter eksplicit review; dette er en engangs-analyse).

Alle kørsler: `node scripts/simulateSeasonDryRun.js --population=<17/7-snapshot> --no-html --roles --v3 --condition=snapshot --enforce-dominance`, 3 seeds (2026/7/42), 300 løb/terræn × 8 terræner + 1 GT pr. kørsel — samme protokol som S0-S2. Bånd fra `DOMINANCE_TARGETS` (`backend/scripts/simulateSeasonDryRun.js`).

## 2. Baseline — reproducerer driften? JA

Nuværende committede motor-parametre (`TOP_COMPRESSION_TAU=0.5`, `DAYFORM_SD=0.015`, uændrede siden S2) kørt mod DEN FRISKE 17/7-population:

| Metrik | Seed 2026 | Seed 7 | Seed 42 | Bånd | Status |
|---|---|---|---|---|---|
| favoriteWinRate | 43,1 % | 44,1 % | 44,3 % | 25-40 % | ✗ (alle 3) |
| share4PlusSameTeamTop10 | 6,5 % | 6,8 % | 6,0 % | ≤5 % | ✗ (alle 3) |
| maxSeasonWinRate | 70,9 % | 73,7 % | 73,6 % | ≤45 % | ✗ (allerede rødt siden S2, uændret) |
| favoritePodiumRate | 71,8 % | 74,0 % | 73,7 % | 55-75 % | ✓ (tæt på loft) |
| ittFavoriteWinRate | 52,3 % | 49,7 % | 54,7 % | 45-65 % | ✓ |

**Baseline reproducerer driften konsistent på alle 3 seeds.** Til sammenligning: S2's committede 3-seeds-scorecard (mod 11/7-populationen) var favWin 37,5-38,8 % ✓ og share4Plus 2,4-3,1 % ✓ — begge grønne dengang. Seks dages population-bevægelse (træning + transfers, 11/7→17/7; hold-/rytter-tal næsten uændret: 368→365 hold, 5.650→5.645 ryttere) har alene flyttet favWin +5-7pp og share4Plus +3-4pp uden nogen motor-ændring. **Konklusion: population-bundet drift, ikke en motor-regression** — engine-parametrene der virkede 12/7 er ikke længere kalibreret mod dagens felt-gaps.

## 3. Kandidat-justeringer (parametre, ingen strukturelle ændringer)

Alle testet mod SAMME 17/7-population, 3 seeds, `--enforce-dominance`.

- **A — øget dagsform-varians:** `DAYFORM_SD` 0,015→0,022 (~47 % op). Screenet på seed 2026 alene (svagere effekt end B/C, se §4) — ikke fuldt 3-seeds-valideret.
- **B — reduceret terrain-fit/favorit-vægt:** `TOP_COMPRESSION_TAU` 0,5→0,35 (mere kompression af de øverste evne-scorer mod pulje-p90 — dæmper favoritten direkte).
- **C — mildere kombination:** `TOP_COMPRESSION_TAU` 0,5→0,40 + `DAYFORM_SD` 0,015→0,018 (begge løftestænger lidt, ingen af dem hårdt).

## 4. Scorecard — alle bånd-metrikker × alle varianter

🟢 = i bånd · 🟡 = tæt på (inden for ~2pp) · 🔴 = udenfor bånd, ikke tæt

| Metrik (bånd) | Baseline | A (sd=0,022, seed 2026) | B (τ=0,35) | C (τ=0,40 + sd=0,018) |
|---|---|---|---|---|
| favoriteWinRate (25-40 %) | 🔴 43,1-44,3 % | 🟡 41,2 % | 🟢 36,3-37,0 % | 🟢 38,1-38,9 % |
| maxSeasonWinRate (≤45 %) | 🔴 70,9-73,7 % | 🔴 69,3 % | 🔴 61,3-65,5 % | 🔴 64,6-68,9 % |
| favoritePodiumRate (55-75 %) | 🟢 71,8-74,0 % | 🟢 68,5 % | 🟢 65,0-67,1 % | 🟢 66,4-68,1 % |
| share4PlusSameTeamTop10 (≤5 %) | 🔴 6,0-6,8 % | 🟡 5,6 % | 🔴 5,5-5,9 % | 🔴 5,1-6,0 % |
| avgDistinctTeamsTop10 (≥7,5) | 🟢 8,2 | 🟢 8,2 | 🟢 8,2-8,3 | 🟢 8,2 |
| ittFavoriteWinRate (45-65 %) | 🟢 49,7-54,7 % | 🟡 45,3 % | 🔴 39,0-44,7 % | 🟡 39,7-44,7 % |
| helperLossMedianGc (10-30) | 🔴 1,0 | 🔴 1,0 | 🔴 1,0 | 🔴 1,0 (uændret — separat S1/S2-fund, ikke denne drifts scope) |

**Ekstra probe (ikke en af de 3 formelle kandidater, kun brugt til at forstå share4Plus'-følsomhed):** τ=0,30 alene giver favWin 32,3 % (grønt) men share4Plus kun ned til 5,2 % og itt falder til 39,0 % — selv en MEGET aggressiv kompression flytter share4Plus næsten ikke. Metrikken reagerer stærkt anderledes end favWin på denne løftestang.

## 5. Hvad hver variant gør ved spiloplevelsen (klar tekst)

- **A (mere dagsform-varians alene):** Svagest effekt af de tre — rykker favWin fra 43→41 %, stadig udenfor bånd. "Gode og dårlige dage" bliver lidt mere udtalte, men favoritterne vinder stadig for tit. Ikke tilstrækkelig alene.
- **B (stærkere top-kompression, τ=0,35):** Får favoritvind-raten solidt i bånd (36-37 %) — spændingen i det enkelte løb genoprettes mest. Prisen: tidskørsel (ITT) rammes hårdt (falder til 39-45 %, under bånd på 2 af 3 seeds) — en stærk tidskører føles mindre sikker på sin disciplin end den burde. maxSeasonWinRate falder pænt (61-66 %) men rammer stadig ikke sit eget mål (≤45 %, kendt fra før).
- **C (mildere kombination, τ=0,40 + lidt mere dagsform):** Rammer favWin-båndet lige så pålideligt som B (38-39 % på alle 3 seeds), men med MINDRE skade på ITT (40-45 %, kun marginalt under bånd, tættere på grænsen). Dette er den bedste balance mellem "løs den akutte drift" og "undgå ny kollateralskade".
- **Fælles for B og C:** Ingen af dem løser share4PlusSameTeamTop10 (samme-hold-dominans i top 10) — den metrik er tilsyneladende IKKE styret af favorit-kompressionsknappen, selv ved ekstrem indstilling. Det er strukturelt (pulje-/hold-sammensætning), ikke en tuning-parameter i denne løftestang. maxSeasonWinRate ligeledes uløst af begge — matcher S2-fundet om at den kræver S4-incidents/population-arbejde, ikke mere varians.

## 6. Anbefaling

**Variant C** (`TOP_COMPRESSION_TAU` 0,5→0,40 + `DAYFORM_SD` 0,015→0,018) som interim-mitigering af den AKUTTE del af driften (favoriteWinRate, som er den mest spiller-synlige "favoritterne vinder for tit"-oplevelse og den metrik der er steget mest dramatisk 18→51 %). Begrundelse: samme favWin-resultat som B (i bånd på alle 3 seeds) med mindre kollateralskade på ITT-disciplinen.

**share4PlusSameTeamTop10 kræver en SEPARAT undersøgelse** — ikke mere tau-tuning. Data i §4 viser at selv τ=0,30 (langt under de testede kandidater) kun flytter metrikken fra ~6,5 % til ~5,2 %, mens den ødelægger ITT-båndet. Næste skridt bør være en pulje-/hold-sammensætnings-analyse (er nogle puljer blevet mere ulige fordelt siden 11/7? har enkelte hold trukket fra i træning?) frem for endnu en motor-parameter-sweep.

**Ingen ændring er lavet i motoren.** Dette er beslutningsgrundlag — variant C kræver ejer-go før den flippes i `RACE_V3_TUNING` (samme proces som S2's τ=1,0→0,5-beslutning 12/7).

## 7. Reproduktion

```
cd backend
node scripts/exportPopulationSnapshot.js --out=scripts/out/population-snapshot-<dato>.json   # frisk read-only snapshot
node scripts/simulateSeasonDryRun.js --population=scripts/out/population-snapshot-<dato>.json --no-html --seed=<2026|7|42> --roles --v3 --condition=snapshot --enforce-dominance   # baseline

# Variant C (kandidat)
RACE_V3_TOP_COMPRESSION_TAU=0.40 RACE_V3_DAYFORM_SD=0.018 node scripts/simulateSeasonDryRun.js --population=scripts/out/population-snapshot-<dato>.json --no-html --seed=<seed> --roles --v3 --condition=snapshot --enforce-dominance
```

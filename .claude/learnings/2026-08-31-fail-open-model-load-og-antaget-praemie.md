# 31/8: to fail-opens i økonomien, samme fejlklasse

Refs #3750, #1819. Begge fundet i natbølgen 30-31/8.

## Fejl 1: søndags-sweepen kunne loade et hvilket som helst model-artefakt

**Rod-årsag.** `backend/lib/marketValueSundaySweep.js` er den eneste runtime-sti
der skriver markedsblendede `base_value`. Den loadede `marketValueModelV1.json`
med et bart `JSON.parse(readFileSync(...))` og havde ingen vagt. Evidens-filteret
fra #3750 blev bygget og merget i PR #3836 (17/8), men det gav kun et NYT artefakt
(`marketValueModelV2.json` med en `evidence_filter`-blok). Ingen tvang runtime-stien
til at bruge et filtreret artefakt.

Det var en fail-open: v1.1 er fittet på 1.027 handler hvor tre fjerdedele af
bankens kroner clearede på nøjagtig startprisen. Målt read-only 30/8 fordeler
bankauktioner med køber sig 981 salg / 68,29 mio. (73,0 % af kronerne) på 0-1
budgiver med gennemsnitligt prisløft 1,003, mod 421 salg / 25,20 mio. på 2+
budgivere med løft 3,447. Modellen ville altså blive trænet på en konstant.

Det brændte ikke, fordi `app_config.market_value_sweep_enabled` står `off`. Men
et flag er én `update` fra at være `on`.

**Fix.** `assertQualifiedEvidenceModel()` afviser et artefakt uden
`evidence_filter` (eller med tom `criteria`). To detaljer der gør den til en vagt
og ikke en formalitet:

- Den kører på RESULTATET af `loadModel`, ikke kun inde i `defaultLoadModel`.
  `loadModel` er en injicerbar test-seam, og en vagt der kan omgås ved at injicere
  et artefakt er ingen vagt.
- Den ligger FØR `claimSweepDate`. Ellers ville et afvist artefakt brænde dagens
  claim, og en rettet model kunne ikke køre samme søndag.

`MODEL_PATH` er bevidst urørt. Hvilken model der skal være live er en
ejer-beslutning i #3449.

**Læring.** Når et filter bygges som et nyt artefakt, er arbejdet ikke færdigt før
runtime-stien ikke længere KAN læse det gamle. Et fit-script og en vagt er to
forskellige leverancer.

## Fejl 2: scorecardet kalibrerede mod et gæt der bar sit eget forbehold

**Rod-årsag.** `backend/scripts/moneySupplyScorecard.js` kalibrerede sponsor og
upkeep mod `PRIZE_ESTIMATE_BY_DIVISION = { 1: 160000, 2: 70000, 3: 25000 }` med
den printede note `proxy: ... (IKKE målt)`. Præcis samme gæt var rod-årsagen bag
#1816, hvor den antagne præmie viste sig 14x for lav. Mærkatet blev stående efter
præmie-reskaleringen ÷20, og ingen målte efter.

**Målt read-only mod prod 30/8** (sæson 2, afsluttet, 28 løbsdage): præmien
tilskrevet den division LØBET blev kørt i (`races.league_division_id`):

| Division | Hold | Gns. pr. hold | Median |
|---|---:|---:|---:|
| 1 | 0 hold | (pulje 13.963.575 / 24 pladser = 581.816) | ingen |
| 2 | 48 | 219.709 | 120.862 |
| 3 | 96 | 188.206 | 78.150 |
| 4 | 72 | 52.915 | 33.975 |

**Attributionen er det led der afgør tallene.** Triagen målte på holdets
NUVÆRENDE `teams.division` og fik D1 709.425 / D2 184.117 / D3 60.819. Det måler
hvad de hold der i dag ligger i D1 tjente, altså hvad et oprykker-hold tjente i
D2/D3. Sæson 2 havde NUL hold i division 1: alle 92.442 tier-1-resultatrækker har
`team_id = NULL`. D1-tallet i issuet er derfor ikke en D1-måling.

**Fix.** `backend/scripts/lib/measuredPrizeByDivision.js` bærer måling, dato,
metode, attributions-valg og D1-forbeholdet ét sted. Scorecardet importerer det.
Ingen konstant i `economyConstants.js` er rørt; om sponsor eller upkeep skal
justeres er en balance-beslutning til ejeren.

**Bifangst: en false-green i samme fil.** `§2.1`-trajektorie-tjekket var
`ratio <= 1.3`. En balance på -3,5 mio. (ratio -7,05) bestod derfor som ✅. Checket
skulle fange inflation og gav grønt lys til konkurs. Nu `ratio >= 0 && ratio <= 1.3`.
Samme false-green-klasse som #3009's "FAIL men exit 0". Backwards-check:
`inflationScorecard.js` (bånd 0,8-1,3) og `economyCalibrationSweep.js` er
to-sidede i forvejen, så det var den eneste forekomst.

**Læring.** Et forbehold skrevet ind i outputtet ("IKKE målt") er ikke en vagt,
det er en note man vænner sig til. Forward-guarden er en test der læser
scorecardets kildekode og fejler hvis mærkatet eller det hardkodede gæt kommer
tilbage.

## Forward-guards der landede

- `backend/lib/marketValueSundaySweep.test.js`: 6 tests, herunder at det rigtige
  v1-artefakt afvises og det rigtige v2-artefakt passerer, og at sweepen ikke
  claimer dagen når artefaktet afvises.
- `backend/scripts/lib/measuredPrizeByDivision.test.js`: 10 tests, herunder at
  scorecardets kildekode ikke må bære "(IKKE målt)" i output, ikke må hardkode
  præmie-objektet igen, og at begge trajektorie-tjek har en nedre grænse.

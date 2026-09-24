# 2026-09-20: en ny model-kontakt dækkede kun to af fem læsere, og jeg viste rå tal som om de var live

Session: orkestrator 20-21/9 (#5443 værdi-skiftet, PR #5446).

## Hvad skete der

1. **Kontakten var halv.** PR #5446 indførte `rider_valuation_model` (v4/v5) og førte søndagskørslen + sæsonskiftet gennem den. Tre andre produktions-læsere læste stadig `riderValuationModelV4.json` direkte: `routes/api.js`, `backfillCores.js`, `starterSquadAllocator.js`. Workeren byggede efter min brief, reviewer godkendte, CI var grøn. Hullet blev først fundet, da ejeren spurgte "hvad gør 5446?", og jeg læste diffen og greppede efter filnavnet. Var v5 blevet tændt, ville nye ryttere og startrupper være prissat med den gamle model.
2. **Rå tal vist som live.** Jeg viste ejeren type-indeks "i dag" med puncheur = 499, læst direkte fra `fit.offset` i model-JSON'en. Live-koden dæmper de tal (`riderValuationTypeDampening.js`, #4000, flippet 23/8), så det rigtige tal var 124. Ejeren fangede det: "det troede jeg vi allerede havde rettet?"
3. **Løn-koblingen var overset.** `current_production_value` (løngrundlaget) regnes af samme model. Ingen brief, rapport eller PR-body nævnte at v5 også ville flytte fremtidige lønkrav (+7,8 %, enkelte typer ±30 %). Fundet ved at læse `recomputeRiderValue` og måle CPV-kolonnen i tørkørslen.

## Rod-årsag

Briefen beskrev HVAD der skulle skiftes, ikke HVEM der læser det. En kontakt er kun en kontakt, hvis alle læsere går igennem den. Og et tal fra en model-fil er ikke et live-tal, før hele læse-stien (dæmpning, normalisering, skala) er lagt på.

## Forward-guard

- `backend/lib/valuationModelReaders.test.js` (merget i #5446): fejler hvis en fil under `backend/lib` eller `backend/routes` uden for model-select-modulet nævner en `riderValuationModelV*.json`.
- `backend/lib/valuationWageModelSplit.test.js`: pris og løngrundlag vælger model hver for sig; CPV er bit-identisk når kun prisen skifter.
- **Orkestrator-regel:** når en brief indfører en kontakt, et flag eller en ny kilde til et tal, skal briefen indeholde "grep efter ALLE læsere af det gamle, og før dem igennem, plus en vagt-test mod direkte læsning". Og orkestratoren læser selv diffen og grepper efter den gamle kilde FØR go-kortet, uanset reviewerens dom.
- **Tal til ejeren** regnes gennem produktionens egen funktion (som `predictBaseValue` med begge modeller), aldrig aflæst fra en parameter-fil.
- **Afledningstjek ved formel-skift:** list alt der beregnes af samme model (her: pris OG løngrundlag), og mål hver for sig i tørkørslen.

# Postmortem · 2026-08-04 · Finance-forecast forward-guard + hjælpetekst-præcision (#3332)

## Hvad skete der?
Issue #3332 ("sæsonprognosen mangler facility-/staff-/akademi-omkostninger") viste
sig ved opstart at være **allerede løst i hovedstammen**: PR #3251 (merged
2026-08-03 22:51 UTC, samme aften som ejerens Discord-annoncering 3/8 15:12 UTC)
havde tilføjet upkeep/facilitets-upkeep/staff-løn/akademi-drift til
`computeFinanceForecast` og rettet `help.json`'s "hele cashflowet"-påstand — se
`.claude/learnings/2026-08-03-forecast-missing-expense-side.md`. Issuet #3332 var
oprettet af en Discord-sweep SENERE samme dag (4/8 PM), uden at sweepet opdagede
at fixet allerede var landet. Ejeren havde da også allerede kommenteret #3236
("Shipped… Done-flippet manglede") — men #3332 forblev åbent som duplikat-issue.

## Root cause (proces, ikke kode)
Discord-sweep-automatikken (der genererer issues fra owner-annonceringer) kørte
igen på den SAMME kilde-besked uden at tjekke om et fix allerede var shipped og
issue'et lukket. To issues (#3236 og #3332) endte med at dække samme
Discord-besked, adskilt af timing (fix landede MELLEM annonceringen og sweepet).

## Hvad var reelt tilbage at gøre
Selvom kerne-fixet (de 4 udgiftsstrømme) allerede var live, havde #3236/#3251
IKKE leveret et af #3332's fire eksplicitte krav: **forward-guard mod tavs
udeladelse** (#1464-mønsteret anvendt på forecast-DÆKNING, ikke kun på
DB-constraint-dækning som den eksisterende `financeTypeConstraintGuard.test.js`
gør). Denne session:

1. Kørte en read-only SELECT mod `finance_transactions` (prod, `ghwvkxzhsbbltzfnuhhz`)
   og fik 20 observerede `type`-værdier — krydset mod `extractCodeWrittenTypes()`
   (genbrugt fra `scripts/lint-finance-types.mjs`, #2957) som fandt 27
   kode-skrevne typer + 1 kendt SQL-only blind-spot (`loan_repayment`,
   skrevet via `repay_loan_atomic`-RPC'en).
2. Klassificerede alle 28 typer eksplicit i en ny eksporteret konstant
   `FINANCE_FORECAST_TYPE_COVERAGE` (`backend/lib/financeForecast.js`) — 7
   modellerede (peger på det faktiske output-felt) + 21 bevidst udeladte (med
   en engelsk begrundelse hver — se i18n-fælde nedenfor).
3. Tilføjede `backend/lib/financeForecastTypeCoverage.test.js`: fejler hvis en
   NY kode-skrevet finance-type mangler i registeret, samt to sanity-tests der
   sikrer `modeled: true`-felterne rent faktisk findes i
   `computeFinanceForecast()`'s output og at `modeled: false`-typer har en
   ikke-tom begrundelse.
4. Udvidede `help.json`'s "ikke medregnet"-liste (en+da) fra 2 kategorier
   (race-day-sponsor + bonusklausuler + op-/nedrykning) til at dække ALLE 21
   bevidst udeladte typer, grupperet forståeligt (resultatafhængige strømme,
   fremtidige manager-beslutninger, sjældne administrative posteringer) — med
   en eksplicit sætning om at intet foldes tavst ind i tallet.
5. Validerede uafhængigt mod 5 rigtige hold (samme population som audit #3198 /
   PR #3251, den ENESTE reelle sæson-transition i prod): genberegnede
   `upkeep`/`academy_drift` fra rå konstanter (`UPKEEP_BY_DIVISION`,
   `ACADEMY.DRIFT_PER_SEASON`) og division/akademi-antal rekonstrueret fra
   `finance_transactions.metadata.params` — PRÆCIST match for alle 5 (0,0%
   afvigelse), mod 8,7-121,5% afvigelse for det gamle (pre-#3236) forecast.
6. Patch note v7.94 tilføjet — `patchNotes.js` manglede en entry for #3236/#3251,
   selvom fixet var live siden 3/8 aften. Eksplicit "det gamle tal var for
   optimistisk med omkring det halve".

## I18n-fælde undervejs
`FINANCE_FORECAST_TYPE_COVERAGE`'s `reason`-felter blev først skrevet på dansk
(matcher filens øvrige kode-kommentar-sprog) — men `scripts/i18n-check-leaks.mjs`
(#666/#1053-leak-guarden) flagger danske string-literaler på linjer med
`reason`-KONTEKST i `backend/lib/**` som en potentiel API-response-leak, uanset
om strengen rent faktisk forlader backend'en. Feltet hedder bogstaveligt
`reason`, som er præcis det ord guarden griber fat i. Fix: skrev `reason`-
værdierne på engelsk (de er interne test-/dokumentationsdata, aldrig en del af
`computeFinanceForecast()`'s return-værdi) — undgår enhver tvivl uden at
undergrave guardens formål.

## Forhindret-fremover
`financeForecastTypeCoverage.test.js` er nu den strukturelle garanti #3236's
egen postmortem efterlyste ("INTET automatisk der tvinger [forecastet] til at
følge med"): en 5. udgifts-/indtægtsstrøm der får sin egen `type`-værdi i
koden UDEN en tilsvarende linje i `FINANCE_FORECAST_TYPE_COVERAGE` fejler nu
testen med et eksplicit fix-forslag, i stedet for at glide stille forbi som
upkeep/facilitets-/stab-/akademi-strømmene gjorde i ~6 uger.

## Læring
1. En issue der lyder identisk med et allerede-lukket issue kan stadig
   indeholde reelt nyt scope — læs BEGGE issues og PR'en der lukkede det
   første, før du antager duplikat eller antager "intet at gøre".
2. Forward-guards mod "tavs udeladelse" bør bygges på KODENS faktiske adfærd
   (directory-walk + regex-scanner, #1464/#2957-mønsteret), ikke på en
   håndskrevet opremsning — ellers gentager guarden selv den fejl den er bygget
   til at forhindre.
3. i18n-leak-guarden er kontekst-følsom (matcher ordet `reason` bogstaveligt i
   backend/lib), ikke kun sprog-følsom — et engelsk feltnavn der semantisk
   ligner en fejlbesked-kontekst kan trigge selvom værdien aldrig leaker.

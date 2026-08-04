# Postmortem · 2026-08-03 · Finance-forecastet manglede hele udgiftssiden

## Hvad skete der?
Finance-sidens forecast ("hvad kommer der næste sæson") viste kun sponsor +
præmie - løn - lånerente. Økonomi-audit #3198 (fund #1) målte at forecastet for
D2-hold MED facilitets-/akademi-investering afveg 50,6-54,9% fra det
realiserede ved S1->S2-overgangen (26/7) - forecastet lovede over dobbelt så
stort overskud som virkeligheden gav. D3-hold uden investeringer afveg "kun"
8,0-8,4% (upkeep alene). Oveni påstod `help.json` at forecastet dækkede "hele
næste sæsons cashflow" og nævnte et lånegebyr-led der ikke fandtes i koden.
Ejer-prioritet 3/8: fix inden få dage, da spillerne planlægger sæsonskiftet
(23/8) efter dette forecast.

## Root cause
`computeFinanceForecast` (`backend/lib/financeForecast.js`) og dens API-route
(`/api/me/finance-forecast`) blev bygget i slice 07g og har siden ikke fulgt
med da `economyEngine.processTeamSeasonPayroll` fik 4 nye sæson-start-
udgiftsstrømme tilføjet over tid (upkeep #1441, facilitets-upkeep/staff-løn
#1441 Fase 3 A1, akademi-drift #1308): route'en hentede aldrig
`team_facilities`, `team_staff` eller akademi-antal, og den rene funktion
kendte slet ikke til `UPKEEP_BY_DIVISION`/`getFacilityUpkeepTotal`/
`ACADEMY.DRIFT_PER_SEASON`. Samme moenster som training-trainability-
postmortemen samme dag: en konsolideret motor-udvidelse blev ikke fulgt af
alle sine forbrugere.

## Fix
`financeForecast.js`: `projected_upkeep`/`projected_facility_upkeep`/
`projected_staff_salary`/`projected_academy_drift` tilføjet til
`computeFinanceForecast` + `computeMultiSeasonForecast`, med PRÆCIS samme
formler/konstanter som `economyEngine.processTeamSeasonPayroll`/
`chargeFacilityCosts` (samme `UPKEEP_BY_DIVISION`-opslag + sæson-1-deferral,
samme `getFacilityUpkeepTotal`, samme staff-sum, samme akademi-antal ×
`ACADEMY.DRIFT_PER_SEASON`). `api.js`'s `/me/finance-forecast` henter nu
`team_facilities`/`team_staff`/akademi-antal + `facilities_enabled`-flaget og
sender dem videre. `help.json` (en+da) rettet til at matche koden - fjernet
det ikke-eksisterende lånegebyr-led, tilføjet de 4 nye strømme + en eksplicit
"IKKE medregnet"-liste (race-day-sponsor-puljen, sponsor-bonusklausuler,
engangs-begivenheder). PR #3251.

Prod-verifikation (read-only SELECT, `ghwvkxzhsbbltzfnuhhz`): den faktiske
opdaterede funktion koeret med historisk-rekonstruerede inputs for auditens 5
stikprøvehold reproducerer auditens egne afvigelsestal praecist (8,0/8,4/8,4/
50,6/54,9% foer) og lander på 0,0% afvigelse efter - forventet, fordi de 4
strømme er deterministiske (samme formel som opkraevningen), ikke stokastiske
estimater som praemie.

## Forhindret-fremover
13 nye unit-tests i `financeForecast.test.js` dækker hver strøm isoleret
(division-skaleret upkeep, sæson-1-deferral, `facilitiesEnabled`-gate,
akademi-antal=0, multi-sæson status-quo) + et samlet D2-investerings-
scenarie der isolerer PRÆCIS de 3 nye strømmes bidrag til netto-afvigelsen.

## Læring
Når en motor (her `economyEngine`) får en ny sæson-start-udgiftsstrøm, er der
INTET automatisk der tvinger dens forward-looking forecast-søskende til at
følge med - de deler ingen fælles kilde-til-sandhed, kun en implicit
konvention om at "forecastet bør afspejle det motoren opkræver". En fremtidig
5. udgiftsstrøm (fx et evt. lejegebyr, hvis det nogensinde bygges) bør enten
tilføjes begge steder i samme PR, eller `financeForecast.js`'s docstring-liste
over "hvad forecastet medregner" bør have et eksplicit review-punkt i
`economyEngine`-relaterede PR'ers tjekliste.

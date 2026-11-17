# Postmortem · 2026-11-16 · Kalenderen viste hvert løb én gang pr. pulje

## Hvad skete der?
Når en spiller valgte en division i Kalenderen, stod hvert løb én gang pr. pulje: to gange i D2, fire gange i D3/D4, og "+10 flere" i hver dagscelle. Holdudtagelse sæson viste "Ingen løb på kalenderen endnu" for en kommende sæson, og Formplan havde ingen divisionsvælger. Fundet af #5841-undersøgelsen (PR #8252), rettet i PR #8261.

## Root cause
Kalender-API'et (`backend/routes/api.js`, `/races/calendar`) returnerer én række pr. pulje, og puljerne i samme division har identiske løb og ruter (målt S5). Grid'et (`frontend/src/lib/calendarGrid.js`) grupperede pr. division uden at slå ens løb sammen, så filteret "Division N" viste alle puljers kopier. For en kommende sæson er holdets pulje ukendt før skiftet, så "Mit hold"/egen pulje matchede intet og fladerne blev tomme.

## Fix
PR #8261, merget som `de70496b`: `mergePoolTwins` i `calendarGrid.js` (nøgle navn + datoer + rute; holdets egen pulje, ellers laveste nummer), `expectedDivision` (holdets nuværende tier, kun mens divisionen er uafgjort) i kalender- og peak-plan-svaret, divisionsvælger i Formplan med ét `switchSeason` der nulstiller valget. Kontrakten står i `docs/CALENDAR_RULES.md` §17 og `docs/PLANNING_CENTER_RULES.md`.

## Forhindret-fremover
- Enhedstests i `frontend/src/lib/calendarGrid.test.js` og `components/planner/plannerShared.test.js` låser sammenlægningen og standard-divisionen.
- SSOT-afsnittene ovenfor gør "én række pr. pulje fra API'et" til en dokumenteret præmis, så nye flader ved, at de selv skal slå tvillinger sammen.

## Læring
Når data ligger én gang pr. pulje, men spillet tænker i divisioner, skal sammenlægningen ske ét fælles sted (en ren funktion) og ikke pr. flade. Tjek også altid en flade for "kommende sæson", hvor holdets pulje endnu ikke findes: det er en egen tilstand, ikke et tomt resultat.

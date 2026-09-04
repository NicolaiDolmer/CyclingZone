# Postmortem · 2026-09-01 · Flerårsplan kunne gen-underskrives midt i planperioden

## Hvad skete der?
`getBoardRenegotiationLock` (#915) skulle forhindre gen-underskrivning af en
allerede-signeret bestyrelsesplan. En spiller rapporterede (#3575) at
genforhandlings-teksten lovede en "reset", men bestyrelses-requests forblev
låst resten af sæsonen — hvilket afslørede at "reset" faktisk skete, selvom
planen (3yr/5yr) langt fra var udløbet.

## Root cause
Låsen tjekkede KUN indeværende sæsons race-day-fremdrift (`race_days_completed`
vs. `race_days_total`), aldrig hvor langt selve flerårsplanen var nået
(`seasons_completed` vs. planens varighed). Tidligt i en NY sæson (lav
`race_days_completed`) ramte "sæsonstart"-undtagelsen og returnerede
`locked: false` — også for en 3/5-årsplan med 1-4 sæsoner tilbage. `/board/sign`
nulstillede derefter ubetinget `seasons_completed`, `cumulative_stage_wins`,
`cumulative_gc_wins` og rullede `plan_start_season_number` om, midt i
planperioden (re-roll-exploit).

## Fix
`backend/lib/boardRequests.js` (`getBoardRenegotiationLock`): en `completed`
3yr/5yr-plan er nu låst ubetinget, uanset sæson-fremdrift — den kan først
gen-underskrives når `negotiation_status` er flippet til `pending` af
season-end-flowet i `economyEngine.js` (dvs. planperioden reelt fuldført).
1yr-planer er uændrede. `backend/routes/api.js` eksponerer `renew_lock_code`
så frontend kan vise en præcis årsag i stedet for én generisk tekst.
`frontend/src/pages/BoardPage.jsx`: "Forny"-knappen forbliver synlig men
blokeret (useBlockedAction/BlockedNote) i stedet for at forsvinde, og
wizardens signatur-trin viser nu en ærlig reset-note FØR underskrift.

## Forhindret-fremover
`backend/lib/boardRenegotiationLock.test.js` udvidet med tests for: aktiv
3/5yr-plan låst tidligt i en ny sæson (den præcise exploit-vektor), udløbet
plan kan stadig gen-underskrives, 1yr-planer uændrede, og et kilde-scan der
låser at signLock/renewLock håndhæves FØR counter-reset-koden i `api.js`
(så en fremtidig omrokering af koden ikke genåbner hullet stille).

## Læring
En lås der kun ser på "hvor langt er VI nået i denne sæson" er ikke det samme
som "hvor langt er PLANEN nået" når planen spænder over flere sæsoner — same-
sæson-metrikker (race-days, progress-pct) er blinde for multi-sæson-tilstand.
Guard-funktioner der beskytter en flerperiodisk ressource skal eksplicit
tjekke ressourcens EGEN livscyklus-tilstand (her: `negotiation_status`), ikke
kun et lokalt tidsvindue.

# Postmortem · 2026-09-03 · Skadet rytter kunne ikke udtages til løb der starter efter skaden er ovre (#4701)

## Hvad skete der?
En manager kunne ikke udtage en skadet rytter til et løb, selv når løbet først startede
EFTER skaden var udløbet — udtagelses-panelet viste ham som skadet og disablede checkboksen,
og et gem-forsøg (single eller via sæson-matrixens bulk-gem) blev afvist med
`selection_rider_injured`. Fundet af spilleren @jaxx_38086_92839 på Discord 2/9, ejer-bekræftet
utilsigtet samme dag. Ramte planlægning direkte: en skadet rytter kunne ikke lægges ind i
sæsonen på forhånd, selv langt ude i fremtiden.

## Root cause
`riderEligibility.isRiderInjured(injuredUntil, todayStr)` er det korrekte, kanoniske
skades-predikat (`>=` mod en reference-dato) — men EN af de mange kaldere brugte konsekvent
`todayStr = copenhagenDateString()` (dagens dato, "nu") som reference, i stedet for det
LØB rytteren skulle udtages til. `raceSelection.js: getSelectionContext` byggede hver
riders `injured`-flag mod "nu", og dette flag drev BÅDE UI-checkboksens disabled-state
(`RaceSelectionPanel.jsx`) OG selve backend-valideringen (`validateSelection`'s
`injuredRiderIds`, kaldt fra `prepareSelectionChange` — som BÅDE PUT
`/races/:raceId/selection` og PUT `/races/selection/bulk`, dvs. sæson-matrixens "Gem plan",
deler). To beslægtede endpoints (POST `/races/:raceId/selection/auto` — spillerens
"auto-udfyld"-knap — og POST `/races/distribution/regenerate`) havde samme mønster: egen
lokal `todayStr = copenhagenDateString()` i stedet for løbets dato.

Selve engine-laget (`raceRunner`/`filterOutInjuredEntries`, `raceEntryGenerator`'s
proaktive sweep) var IKKE ramt — de vurderer allerede korrekt mod den faktiske
etape-/simulerings-dag, ikke "nu" (samme mønster #3896/#2637 allerede lukkede for
committede entries). Bugget var isoleret til udtagelses-GATEN (kan jeg overhovedet
VÆLGE ham), ikke til hvad der rent faktisk starter i løbet.

## Fix
- `backend/lib/riderEligibility.js`: ny `raceSelectionReferenceDateStr(race, todayStr)` —
  `max(todayStr, copenhagenDateString(race.scheduled_for))`, falder tilbage til `todayStr`
  når `scheduled_for` mangler (kalender ikke materialiseret endnu).
- `backend/lib/raceSelection.js: getSelectionContext` bruger nu denne i stedet for rå
  `copenhagenDateString()` — retter BÅDE UI-visningen og backend-valideringen ét sted,
  da begge udledes af samme `riderRows.injured`.
- `backend/routes/api.js`: tilføjede `scheduled_for` til `races`-selects på alle steder
  der fodrer `getSelectionContext`/`prepareSelectionChange` (GET/PUT
  `/races/:raceId/selection`, PUT `/races/selection/bulk`, GET `/races/distribution`),
  og rettede de to selvstændige `todayStr`-beregninger i `/selection/auto` (assist,
  enkelt-løb) og `/distribution/regenerate` (multi-løb — bruger tidligste `scheduled_for`
  blandt regenererings-dagens løb som reference, konservativt).
- **Ikke rørt** (bevidst, ude af scope): `GET /races/selection/season` (sæson-matrixens
  data-endpoint) har samme "nu"-mønster i sit `riders[].injured`-felt, men feltet er
  DØDT i frontend lige nu (`SeasonMatrix.jsx`/`SeasonMatrixCellPopover.jsx`/
  `seasonMatrix.js` læser det aldrig) — ingen observérbar adfærd at rette, flaget noteret
  hvis feltet nogensinde bruges. `raceEntryGenerator.js`'s proaktive/late-fill-sweep har
  også et globalt `injuredIds`-filter mod "nu" på tværs af flere løb — teknisk samme
  bug-klasse, men kræver en game-day→kalenderdato-oversættelse for at rette korrekt
  (sweepen arbejder i in-game-dag-vinduer, ikke kalenderdatoer) og er en større,
  selvstændig opgave; ikke en del af #4701's rapporterede symptom (manuel udtagelse/
  matrix-planlægning). PR #4538/#4681 (etape-taktik-redigering) blev tjekket og bruger
  en HELT anden mekanisme (`race_incidents`/abandon, ikke `injured_until`) — urelateret,
  ingen ændring nødvendig der.

## Forhindret-fremover
- Regressionstests i `riderEligibility.test.js` (ren `raceSelectionReferenceDateStr`) og
  `raceSelection.test.js` (integration via `getSelectionContext` + `validateSelection`,
  med rytter skadet til dag X og løb der starter dag X+1 vs. dag X+2 — begge relative til
  ægte "i dag" via `copenhagenDateString()`, så testene aldrig bliver tidsafhængige/flaky).
- Patch note 7.242 + help.json (en+da) opdateret så teksten matcher den rettede regel.

## Læring
Et "kanonisk, ét-sted"-predikat (`isRiderInjured`) beskytter kun mod DUPLIKERET LOGIK —
ikke mod at forskellige kaldere sender FORKERT INPUT til det. Her var predikatet altid
korrekt; bugget var at 4 forskellige call-sites alle gættede "nu" som reference-dato i
stedet for at spørge "hvilken dag gælder dette overhovedet for?". Ved enhver dato-baseret
gate: spørg eksplicit "hvilken specifik hændelses-dato skal denne vurderes mod?" i stedet
for at antage "nu" er korrekt bare fordi det er den nemmeste værdi at hente.

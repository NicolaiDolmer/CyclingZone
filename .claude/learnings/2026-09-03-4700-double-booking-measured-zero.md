# Postmortem · 2026-09-03 · #4700 (CYCLINGZONE-44) — malt 0 levende par, ingen aktiv bypass fundet

## Hvad skete der?
Vagten `riderDoubleBookingWatch` (CYCLINGZONE-44) alarmerede sidst 2/9 kl. 12:49 med 48
rytter-par udtaget til to overlappende lob i S3 (25 nyligt opstaede). Issuet bad om at
finde OG rette den skrivesti der stadig kan lave overlappende udtagelser uden at ramme
game_day-guarden.

Malt read-only mod prod 3/9 (Supabase MCP, samme algoritme som vagten selv: raceBindingWindow
span-overlap + #1823-afmeldt-filter + #3185-ghost-filter): **0 levende par lige nu**. De 25
"radata"-par (uden filtrene) var alle IKKE-levende: 20 fordi holdet siden er meldt fra det
ene lob, 5 fordi rytteren siden er solgt/skiftet hold (ghost). Ingen commits rorte
`raceBinding.js`/`riderEntryGenerator.js`/`riderDoubleBookingWatch.js` mellem 31/8 og 3/9 —
0-malingen skyldes altsa naturlig churn (afmeldinger + holdskifter), ikke en kode-rettelse i
denne session.

## Root cause
Gennemgik ALLE skrivestier til `race_entries` (grep + laesning): manuel udtagelse
(PUT /:raceId/selection + PUT /races/selection/bulk, ikke-brugervendt endnu), auto-fill/
regenerate (POST /races/distribution/regenerate), assistent (POST /races/:raceId/selection/auto
+ raceEntryGeneratorSweep inkl. #4673 sen-udfyldning), race-start-redning (raceRunner.js
fillMissingTeamEntries). Akademi/transfer-filerne (academyGraduation/academyTransfer/
transferExecution/stageRaceTransferDefer) SLETTER kun ghost-entries, de INDSAETTER aldrig.

Alle fire indsaettelsesstier bruger SAMME delte helper (`raceBinding.js`:
`raceBindingWindow`/`windowsOverlap`/`loadTeamBindingContext`/`isRiderDayInvariantViolation`)
PLUS en DB-niveau deferred UNIQUE-constraint (`no_rider_double_booking_day` pa
`race_entry_days`, span-baseret siden #4217) som sidste linje. Malt i prod: alle 529 S3-lob
er fuldt game_day-backfillet lige nu, sa DB-backstoppet er vandtaet for enhver ny insert.

Den DOKUMENTEREDE rod-arsag til klassen "GT-rytter frigivet pa hviledag -> straks
dobbeltbooket i et endagslob" star allerede i `database/2026-08-24-4203-...sql`s egen
kommentar: #4173 (24/8) skiftede binding fra SPAEND til KUN-de-koerte-dage, hvilket frigjorde
GT-ryttere pa hviledage og lod entry-generator-sweepen straks udtage dem til et Monument i
samme slot. Det blev rettet af #4217 (25/8, span-binding i BADE JS og DB) med dedikerede
regressionstests (`raceBinding.test.js` #4217-testene, `raceEntryGenerator.test.js`s
game_day-spaend-test). Ingen kode-aendring siden.

## Fix
Ingen kode-rettelse i denne session — jeg kunne ikke reproducere en aktivt-bypassende
skrivesti. Leveret i stedet:
- `backend/scripts/audit-4700-double-booked-riders.js` — read-only dump-script (ingen
  --apply) der genbruger de SAMME rene funktioner som vagten (`findDoubleBookedRiders`,
  `splitLiveConflicts` fra `riderDoubleBookingWatch.js`; `raceBindingWindow` fra
  `raceBinding.js`; `filterEligibleEntries` fra `riderEligibility.js`) og lister den FULDE
  parliste (rytter, hold, begge lob, game_day-vindue, is_auto_filled, created_at) —
  vagtens egen Sentry-capture er hardt begraenset til 25 par.
- `backend/scripts/audit-4700-double-booked-riders.test.js` — 4 regressionstests
  (overlap-rapportering, #1823-afmeldt-filter, #3185-ghost-filter, tom-saeson).

## Forhindret-fremover
Scriptet er reusable: koeres igen naar vagten naeste gang alarmerer, for at fa den FULDE
liste (ikke kun et 25-par-sample) til triage, uden at skulle skrive engangs-SQL igen.
Fordi det genbruger de eksisterende rene funktioner er der IKKE tilfojet en tredje kopi af
overlap-logikken (som er PRAECIS den fejlklasse #4700 selv advarer imod).

## Laering
Et Sentry-snapshot fra 36 timer for maling kan vaere fuldstaendig forsvundet via normal
spilaktivitet (afmeldinger, salg) UDEN at rod-arsagen er rettet i denne session — og
UDEN at det betyder rod-arsagen aldrig var reel (#4173-klassen var ægte, malt og rettet
24-25/8). "0 lige nu" er derfor hverken bevis for at faerdigt er faerdigt eller for at
issuet var falsk positivt; det er kun et tidsstemplet datapunkt. Naeste skridt hvis vagten
alarmerer igen: koer `audit-4700-double-booked-riders.js` STRAKS (for churn nar at rydde
op), ikke dagen efter.

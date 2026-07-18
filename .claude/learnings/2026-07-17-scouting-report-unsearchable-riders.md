# Postmortem · 2026-07-17 · Scouting-rapporter viste ryttere ingen kunne søge frem

## Hvad skete der?
To hold rapporterede på Discord samme morgen (#2581) at deres spejder kom
tilbage med rytternavne (fx "Stijn Maes", "Bartosz Vrba") de ikke kunne finde
via nogen søgning eller marked — "de findes faktisk slet ikke".

## Root cause
Ingen data-tab, ingen fabrikerede navne. Read-only prod-audit fandt 0 ægte
orphans blandt de 46 ryttere der nogensinde er blevet shortlistet af en
scouting-mission (`scout_assignments.result.shortlist`). Men **17/46 (37%)**
er lige nu globalt usøgbare for alle ikke-admins pga. riders-RLS-policyen
"Public read riders" (`is_offered_intake_rider`): en rytter der står som et
UAFKLARET akademi-intake-tilbud til et hold (`academy_intake.status =
'offered'`, endnu ikke accepteret/afvist) skjules fra HELE spillerbasen, ikke
kun for hold der ikke er tilbuddet. `scoutSweep.js`s `defaultLoadCandidates`
kendte ikke til denne tilstand og kunne derfor placere en sådan rytter i en
mission-shortlist — spilleren fik et helt ægte navn han ikke kunne slå op
noget sted. Sekundært (2/46 tilfælde): candidate-poolen ekskluderede heller
ikke holdets EGNE ryttere, så en mission kunne "opdage" en rytter holdet
allerede ejede.

## Fix
`backend/lib/scoutSweep.js` (`defaultLoadCandidates`): henter nu
`academy_intake`-rækker med `status='offered'` parallelt med rytter-loadet og
ekskluderer de rider_ids fra kandidat-poolen (samme diskriminator som
RLS-policyen). Tilføjer også `ownerTeamId` (fra `riders.team_id`) på hver
kandidat. `backend/lib/scoutMission.js` (`generateShortlist`): ekskluderer nu
kandidater hvor `ownerTeamId === teamId` (holdets egne ryttere), no-op når
`ownerTeamId` er `undefined` (bagudkompatibelt med eksisterende test-fixtures).
Tests: `scoutSweep.test.js` (3 nye `defaultLoadCandidates`-tests) +
`scoutMission.test.js` (2 nye `generateShortlist`-tests). PR #<udfyldes ved merge>.

## Forhindret-fremover
Regressionstests dækker begge exclusion-grene direkte på de rene funktioner
(`defaultLoadCandidates`, `generateShortlist`) — ingen mock-af-mock, samme
mønster som `scoutSweep.test.js`s øvrige suite. Data-reparation af
EKSISTERENDE forældreløse mission-rapporter (de 17 allerede-udsendte) er
IKKE udført her — flagget til ejeren (antal + plan) i PR-body/ownerFlags,
da det kræver en beslutning om UI-håndtering (skjul/mærk gamle rapport-
entries) frem for en stille datamutation.

## Læring
En riders-relateret usøgelighed kan komme fra RLS-policyer/andre gates
LÆNGERE VÆK end de åbenlyse "er rytteren i DB"-tjek — `is_offered_intake_rider`
var usynlig fra scouting-kodestien indtil man fulgte "søg direkte i DB" hele
vejen til RLS-laget. Generel regel: enhver "vis en tilfældig rytter fra
populationen"-generator (scouting, matchmaking, anbefalinger) skal eksplicit
ekskludere samme skjulte tilstande som den generelle rytter-søgning gør,
ellers lækker den navne brugeren ikke selv kan verificere — samme
klasse-fejl som `feedback_match_ui_filter_for_capacity_logic`
(match UI'ets filter i "findes"-logik), nu udvidet til også at dække RLS-lag,
ikke kun `is_ai`/`is_test`/`is_frozen`-diskriminatoren.

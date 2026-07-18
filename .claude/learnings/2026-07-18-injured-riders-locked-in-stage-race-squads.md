# Postmortem · 2026-07-18 · Injured riders locked into auto-selected stage-race squads

## Hvad skete der?
Discord #bugs (18/7, @manuelessl): to skadede ryttere sad fastlåst i en auto-udtaget
etapeløbs-trup uden nogen vej ud ("I can't remove them now. Will they be riding
injured?"). Samtidig kunne en anden rytter ikke vælges til et etapeløb fordi han var
auto-udtaget til et endagsløb inden for etapeløbets vindue, og clear-fejlen nævnte
hverken rytter eller løb ved navn. Alle tre er opfølgning på #2599's auto-udtagelses-
rollout. Issue #2637.

## Root cause
Tre uafhængige huller i samme flow:

1. `backend/lib/raceEntryGenerator.js` (den proaktive Race Hub Fase 0b-sweep) og
   `POST /races/distribution/regenerate` (spillerens egen "auto-udfyld") byggede begge
   deres kandidat-population UDEN at filtrere `rider_condition.injured_until` — spec 6.5
   (#1306) lukkede kun hullet for `raceRunner.fillMissingTeamEntries` (race-tids-
   autofyld). En rytter der blev skadet efter at være auto-udtaget blev derfor ALDRIG
   fjernet af nogen efterfølgende sweep-kørsel.
2. `PUT /races/:raceId/selection` blokerede ALLE ændringer når `stages_completed>0`
   (#1825-frysningen), inkl. en ren fjernelse — der var ingen undtagelse for "kun
   fjerner, tilføjer intet". Samme endpoint afviste også enhver udtagelse hvor en
   ønsket rytter var bundet i et OVERLAPPENDE løb, uanset om den konfliktende entry var
   assistentens eget (endnu ikke startede) forslag eller en ægte manuel udtagelse.
3. Frontend (`RaceSelectionPanel.jsx`) satte `disabled = rider.injured || ...`
   UBETINGET — en allerede-udtaget skadet rytters checkbox var disabled uanset
   `checked`-state, så selv hvis backend havde tilladt fjernelsen, kunne UI'et ikke
   sende den. `RaceColumn.jsx`s låste (aktive løb) kolonne-visning havde slet ingen
   fjern-knap. `RaceDetailPage.jsx` erstattede hele udtagelses-panelet med en statisk
   "trup låst"-besked så snart løbet var "live".

## Fix
- `backend/lib/raceEntryGenerator.js`: ny injured-filter (mirror raceRunner) før
  kandidat-populationen bygges; en rytter der bliver skadet EFTER auto-udtagelse
  diff'es ud af næste sweep-tick.
- `backend/routes/api.js` (`/races/distribution/regenerate`): samme injured-filter.
- `backend/lib/raceActiveGuard.js` (`assertLineupMutationAllowed`) + `raceSelection.js`
  (`saveSelection`): nyt `allowRemovalOnly`/`removalOnly`-flag — en ren delmængde-
  fjernelse omgår frysningen; completed løb forbliver hårdt låst.
- `backend/routes/api.js` (`PUT /races/:raceId/selection`): beregner `isRemovalOnly`
  (ny rytter-liste ⊆ eksisterende) og bypasser `selection_race_started` for den. Ny
  `classifyBindingConflicts` (backend/lib/raceBinding.js, ren funktion) skelner
  auto-genererede+ikke-startede konflikter (frigives automatisk) fra manuelle/startede
  konflikter (afvises med navngivet 409 inkl. rytter- + løbnavn).
- Frontend: `RaceSelectionPanel.jsx` disabled-logik rettet til `(rider.injured &&
  !checked)`; `validateSelectionClient` fik `requireFull`-parameter (kun krævet ved
  førstegangs-udtagelse); `RaceColumn.jsx` fik en fjern-knap i låst visning;
  `RaceDetailPage.jsx` viser nu panelet også når løbet er "live".

## Forhindret-fremover
Nye regressionstests: `raceEntryGenerator.test.js` (skadet rytter aldrig auto-valgt +
fjernes ved næste sweep), `raceActiveGuard.test.js`/`raceSelection.test.js`
(`allowRemovalOnly`/`removalOnly` bypasser frysningen, completed forbliver låst),
`raceBinding.test.js` (`classifyBindingConflicts` klassificerer korrekt),
`raceSelectionLogic.test.js` (`requireFull=false` tillader delvis trup).

## Læring
Et nyt guard/filter tilføjet ét sted (spec 6.5 i `raceRunner.js`) beskytter IKKE
automatisk søster-koden der gør det samme arbejde et andet sted (den proaktive sweep
kom senere, #1810/#2599, og fik aldrig den samme injured-guard). Når en invariant
("skadede ryttere auto-vælges aldrig") håndhæves ét sted, søg efter ALLE steder der
bygger samme kandidat-population, ikke kun den oprindelige. Desuden: en "frys hele
mutationen"-guard (#1825) er nem at indføre for at beskytte re-simulering, men den må
skelne mellem fjernelse (ufarligt, ændrer ikke historikken fremad) og tilføjelse
(ændrer startfeltet) — en generel frysning uden den skelnen låser spillere ude af
akutte rettelser (skade) midt i et aktivt løb.

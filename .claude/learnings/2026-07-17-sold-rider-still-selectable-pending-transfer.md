# Postmortem · 2026-07-17 · Solgt rytter kunne stadig vælges til et nyt løb mens transferen afventede flush

## Hvad skete der?
Discord-bugrapport (#bugs, @jeppek): en solgt rytter kunne stadig tastes ind i en udtagelse til et løb, selvom selve holdskiftet var blokeret pga. rytterens aktive etapeløb hos sælger (#1995's defer-mekanik). Issue #2579.

## Root cause
Når en handel (transfer/swap/auktion) confirmes mens rytteren er i et AKTIVT fleretape-løb (`stages_completed>0`), parkerer #1995-mekanikken selve holdskiftet: `pending_team_id` sættes til køber, men `team_id` forbliver hos SÆLGER indtil løbet finaliseres (`stageRaceTransferDefer.js`). Handlen er accepteret og betalt med det samme.

Problemet: den delte eligibility-gate (`riderEligibility.js::applyRiderEligibilityFilter`), som bruges af BÅDE manager-udtagelsen (`raceSelection.js::getSelectionContext`), entry-generatoren (`raceEntryGenerator.js`) og sim-tids-autofill (`raceRunner.js::fillMissingTeamEntries`), filtrerede kun på `is_academy`/`is_retired` — ikke på `pending_team_id`. Da `team_id` stadig peger på sælger i parkerings-perioden, fremstod en allerede-solgt rytter som en helt almindelig rosterrytter for sælgeren, og kunne derfor tilføjes til NYE løb (ikke bare det ene han allerede var låst i) — både manuelt og via auto-generatoren.

Desuden: `clearFutureRaceEntriesSafe` (rydder en rytters fremtidige, ikke-startede entries) blev KUN kaldt i den ikke-parkerede gren af transfer-/swap-/auktions-flowene (`if (!deferRegistration)`). En rytter der allerede var manuelt udtaget til et ANDET, ikke-startet løb hos sælger FØR salget, blev derfor hængende der efter salget, indtil den aktive løbs flush ryddede op — et helt separat vindue for den samme klasse bug.

## Fix
- `backend/lib/riderEligibility.js`: `applyRiderEligibilityFilter` udelukker nu også `pending_team_id IS NOT NULL` — samme ét-sted-gate som allerede dækkede akademi/pensioneret. Dækker alle 3 rigtige call-sites (raceSelection.js, raceEntryGenerator.js, raceRunner.js) uden kodeduplikering.
- `backend/routes/api.js` (`POST /races/distribution/regenerate`): den duplikerede rå-query erstattet med samme delte filter.
- `backend/lib/transferExecution.js` + `backend/lib/auctionFinalization.js`: `clearFutureRaceEntriesSafe` kaldes nu UANSET `deferRegistration` — handlen er accepteret/betalt ved confirm, så rytterens fremtidige (ikke-startede) entries ryddes med det samme, ikke først ved race-flush. Rammer strukturelt ikke det aktive låste løb (kun `stages_completed=0`-løb).

## Forhindret-fremover
Regressionstests: `riderEligibility.test.js` (query-kæde), `raceSelection.test.js` (getSelectionContext ekskluderer pending-rytter), `raceEntryGenerator.test.js` + `raceRunnerAutofill.test.js` (auto-generator/sim-tids-autofill vælger ALDRIG en pending-rytter til et nyt løb) — samme mønster som de eksisterende akademi-regressionstests (Rod B).

## Læring
Når en "lock"/"defer"-invariant indføres på ÉT sted (#1995: hold rytteren midlertidigt hos sælger via pending_team_id), skal ALLE steder der spørger "hvem må jeg vælge til et nyt løb lige nu" opdateres til at kende invarianten — ikke kun de steder der spørger "hvem ejer rytteren nu". Den delte `riderEligibility.js`-gate viste sig at være den rigtige eneste-sted-fix (samme mønster som #1800/#1742-akademi-filteret), men den var ikke automatisk konsistent bare fordi #1995 fandtes — en ny felt-tilstand (pending_team_id) kræver eksplicit at blive lagt ind i eligibility-kontrakten, ellers "arver" candidate-pool-forbrugerne den ikke.

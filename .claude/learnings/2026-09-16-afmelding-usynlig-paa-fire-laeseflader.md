# Postmortem · 2026-09-16 · Afmelding fra et løb var usynlig på fire læseflader

## Hvad skete der?

En spiller (egomadsen) meldte sit hold fra Tour du Hedjaz den 14/9, to dage før start. Bagefter viste spillet stadig hans hold som deltagende fire steder: sæsonmatrixen, divisionens startlister, løbssidens udtagelses-panel (med kaptajn og sprint-kaptajn afkrydset) og Dashboard-nudgen, der bad ham vælge trup. Han spurgte på Discord, om rytterne ville køre alligevel, og om han skulle melde til igen, rydde opstillingen og melde fra på ny.

Rytterne ville aldrig have startet. Motoren har respekteret afmeldingen siden #4306 (28/8, v7.211): `raceRunner.loadEntrantsForRace` filtrerer afmeldte hold **før** autopick og **før** 6-mands-gulvet. Men spillet fortalte ham det modsatte fire steder, og hans egen foreslåede workaround ville have fejlet.

## Root cause

`race_entries` **bevares bevidst** ved afmelding (#4306), så "gen-deltag" kan gendanne opstillingen med ét klik. Dermed er *"har holdet entries i løbet?"* ikke længere det samme som *"stiller holdet op?"* — men fire læseflader udledte deltagelse af `race_entries` alene og slog aldrig op i `race_withdrawals`:

| Endpoint | Hvad det viste |
|---|---|
| `GET /races/distribution/browse` | Fantom-hold på divisionens startliste, synligt for **alle andre managers i puljen** |
| `GET /races/selection/season` | Matrixen låste rytterne ude af overlappende løb via `conflictingEntryForRace` |
| `GET /races/:raceId/selection` | Redigerbar opstilling, som `PUT` afviser med 409 `selection_withdrawn` |
| Dashboard-nudgen | Arvede ovenstående via `isSquadSelectionMissing` (5 bevarede < `size.max` 8) |

Det dybere mønster: hver flade afgjorde **selv**, om den ville spørge om afmeldinger. Race Hub-tavlen og deadline-påmindelsen huskede det; fire gjorde ikke. Der fandtes ingen delt indgang, så "husk `race_withdrawals`" var en regel i hovedet på den, der skrev koden — ikke en egenskab ved datalaget.

En femte, latent fejl af samme familie: `DELETE /races/:raceId/withdrawal` tjekkede intet. Afmeldingen NULLer entries' `binding_span` (`race_entries_binding_span` + `trg_race_withdrawals_resync_binding`), så de samme ryttere lovligt kan bruges i et overlappende løb imens. Fjernes afmeldingen, genberegner trigger'en spanet på de bevarede entries og rammer exclusion-constrainten med en rå Postgres-fejl. Rapportøren stod præcis dér: tre af hans fem bevarede Hedjaz-ryttere var i mellemtiden udtaget til L'Enfer du Nord 17/9.

## Fix

PR #5303 (`Refs #5301`).

- `backend/lib/raceWithdrawal.js` — nye delte opslag `loadWithdrawnPairs` (på tværs af hold), `loadWithdrawnRaceIdsForTeam` og `withdrawalKey`, begge chunkede og deterministisk ordnede på PK'en `(race_id, team_id)`.
- `backend/routes/api.js` — de fire flader bruger dem nu; `DELETE .../withdrawal` måler konflikten **før** sletningen med samme maskineri som `PUT /selection`s gate (`loadTeamBindingContext` + `mapRiderBindingDetails`) og svarer 409 `rejoin_rider_bound` med rytter- og løbsnavn.
- `frontend/src/lib/seasonMatrix.js` — `conflictingEntryForRace`, `countProblems` og `riderLoadDays` springer afmeldte løb over.
- `frontend/src/lib/raceSquadSelectionStatus.js` — nudgen tier ved `withdrawn`.
- `SeasonMatrix.jsx` / `RaceSelectionPanel.jsx` — afmeldt løb vises som afmeldt (hængelås, tonet opstilling, read-only kort), ikke som en redigering der afvises ved gem.

Ingen ændring af motoren, af withdrawal-semantikken eller af at entries bevares. Ingen migration.

## Forhindret-fremover

- `backend/lib/apiWithdrawalVisibility.routes.test.js` — route-kontrakt for alle fem huller, inkl. **rækkefølge**: konflikt-guarden skal ligge før sletningen, afmeldings-filtret før rytteropslaget.
- Samme fil håndhæver at `api.js` importerer de delte helpers. **En femte kopi af `race_withdrawals`-opslaget er selve fejlklassen**, ikke en stilistisk detalje.
- `raceWithdrawal.test.js` — pagineringens `.order()` er testet eksplicit: en tabt afmeldings-række over en `.range()`-grænse ville genindføre præcis denne bug.
- Begge retninger testet overalt: et *aktivt* overlappende løb skal stadig låse, og et manglende `withdrawn`-felt skal opføre sig som før.

## Læring

**Når et felt bevidst holdes i live efter at have mistet sin betydning, skal den nye betydning have sin egen delte indgang — ellers arver enhver ny læseflade den gamle.** #4306 traf det rigtige valg (bevar opstillingen, så fortrydelse er gratis) og lukkede skrive- og afviklingsvejene. Men beslutningen gjorde `race_entries` tvetydig for *alle fremtidige læsere*, og den del blev aldrig lukket. Motoren var korrekt i tre uger, mens UI'et løj — og det er værre end en åbenlys fejl, fordi spilleren ikke kan se forskel på "spillet tager fejl" og "jeg tog fejl".

Beslægtet med #3410's postmortem (lås og årsag udledt to steder driver fra hinanden). Fælles regel: **to flader må aldrig udlede samme tilstand hver for sig.** Her var det værre end drift — tavlen og matrixen gav modsatte svar på det samme spørgsmål, i samme session, for den samme rytter.

Sekundær læring: rapporten kom fra en spiller, ikke fra en test eller en alarm. Den eneste grund til at vi ved, hvor længe det stod på, er at han skrev det ned i stedet for at arbejde udenom.

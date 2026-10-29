# #6912 B: motor-beregnet udbrudschance i jæger-boksen

> Designbord S7, variant B (ejer 26/10). Variant A (#7271) fjernede "Breakaway odds", fordi tallet kom fra en fast tabel i frontend og ikke fra motoren. Variant B giver en rigtig chance, beregnet af motoren for netop det løb, den etape og det felt.

## Mål

Jæger-boksen i udtagelsen viser, når motoren kan stå inde for det:

- **"cirka k af n"**: hvor ofte dagens udbrud vinder etapen.
- **En kort årsag**: holdenes interesse i at jage (få hold, et eller to hold, flere hold).

Kan motoren ikke stå inde for tallet, vises intet tal. Linjen fra variant A står altid.

## Valgt løsning: kort Monte Carlo på etapens ægte motor-input

1. **Input fra den ægte afviklingssti.** `raceRunner.simulateStageByIndex` køres i `dryRun` (skriver intet). En indpakning om v4-motoren (`resolveV4Engine`, ny injicerbar parameter med den ægte resolver som default) fanger etapens argumenter: felt, roller, form, træthed, klassement, trøjeførere og regel-revision. Prognosen bruger dermed præcis samme input som den rigtige etape, uden en kopi af input-logikken der kan drive.
2. **Egne seeds.** Motoren køres `OUTLOOK_SEEDS` gange på de fangede argumenter med seeds i navnerummet `breakaway-outlook:<løb>:<etape>:<k>`. Løbets rigtige seed er saltet server-side og bruges aldrig, så prognosen kan ikke afsløre dagens faktiske udfald.
3. **API'et står ikke stille.** Kørslerne sker én ad gangen med `setImmediate` imellem, så event-loopet får luft mellem hver motorkørsel.
4. **Udfald pr. kørsel.** Vinderens `breakaway_win` (motorens egen dom, `groups.isBreakawayWin`) og `breakaway_caught`-events med `chasing_team_ids` (#6050). Ét ukendt udfald, og der vises intet tal.
5. **Visning.** Andelen rundes til en enkel brøk (1 af 10, 1 af 8, ... 1 af 2, 2 af 3, ... 9 af 10). Ingen sejre giver "under 1 af 10", alle sejre "over 9 af 10". Et endeligt antal kørsler beviser aldrig nul.

### Hvornår står motoren inde for tallet

Alle skal være opfyldt, ellers `{ available: false, reason }`:

- Flaget `race_breakaway_outlook` er tændt for seeren (off/beta/on, `featureStage.js`).
- v4-motoren kører (`race_engine_v4`).
- Løbets regel-revision er `s5_profiles_v3` eller nyere. Et ikke-startet løb previewes på den aktuelle revision (som `bindRaceRulesRevision` i dryRun).
- Etapen er løbets næste etape (`stages_completed`), og den har et morgenudbrud (ikke itt/itt_hilly/ttt).
- Alle kørsler har et kendt udfald.

### Privatliv: ingen private ordrer i prognosen

Holdenes taktik-ordrer (`team_orders`) er private. Indgik de, kunne en spiller aflure et andet holds ordre ved at se tallet ændre sig. Prognosen fjerner derfor alle ordre-rækker. Rollernes standardordrer og AI-holdenes egne ordrer (M14) gælder. Tallet er det samme for alle seere og kan caches pr. løb.

Rest-risiko: rollerne (fx hvem der er jæger) indgår, fordi de er en del af feltet. Brøk-afrundingen og cachen gør det svært at læse et enkelt holds rolle ud af tallet.

## Ydelse (målt baseline, før bygning)

Målt lokalt offline på det anonymiserede Giro-felt (`backend/scripts/baselines/giro-field-6088-*.json`), alle vejetaper, `s5_profiles_v3`: én motorkørsel tager på størrelse med 50-100 ms. En prognose er dermed få sekunders CPU, spredt ud over event-loopet. Fordelingerne pr. etape (udbrudssejre, antal jagende hold) står kun privat i `balance-internals/6912/` (hard rule 17).

Målingen viste også, at den fjernede tabels "Low" på højbjerg med lang slutstigning var forkert for netop det felt. Det bekræfter fundet fra 25/10.

**Cache + single-flight:** én beregning pr. (løb, `stages_completed`) ad gangen, genbrugt i 30 minutter. En kørt etape giver en ny nøgle. Fejl caches ikke.

**Regnekraft er ejerens beslutning.** Flaget leveres slukket. `beta` lader ejeren og beta-testere se tallet på prod, før det åbnes for alle.

## Fravalgt

- **En målt tabel fra testporten** (andel udbrudssejre pr. profil og finale): stadig en fast tabel, ikke "netop det løb og felt". Det er præcis fejlklassen fra variant A.
- **En kopi af input-logikken i en ny fil:** hurtigere at skrive, men den ville drive fra afviklingen (form, træthed, roller, klassement). Den injicerbare resolver giver samme input uden kopi.
- **Prognosen med seerens egne ordrer:** kræver en beregning pr. hold og giver dårligere cache. Kan komme senere, hvis ejeren ønsker det.

## Filer

- `backend/lib/breakawayOutlook.js`: beregning, gates, brøk, årsag, cache.
- `backend/routes/breakawayOutlook.js`: `GET /api/races/:raceId/breakaway-outlook` (auth + read-limiter).
- `backend/lib/raceRunner.js`: ny injicerbar `resolveV4Engine` i `simulateStageByIndex` (default uændret).
- `frontend/src/lib/breakawayOutlook.ts`: svar til i18n-nøgler.
- `frontend/src/components/race/HunterExplainer.jsx`: henter og viser linjen.
- `frontend/public/locales/*/races.json`: `racehub.hunterExplainer.outlook.*` i alle 5 sprog.

## Test

- Enhedstests for brøk, årsag, udfald, gates, cache og route.
- Integrationstest gennem den ægte `simulateStageByIndex` i dryRun med den rigtige v4-motor: intet skrives, kun prognose-seeds, ingen ordre-rækker.
- e2e (mobil 375px): linjen vises for endagsløb og etapeløb og skjules når backend siger nej.

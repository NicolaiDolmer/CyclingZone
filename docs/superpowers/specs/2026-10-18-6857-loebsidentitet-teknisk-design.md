# Teknisk design #6857: Løbsidentitet (8 typer + signatur + håndskrevne monumenter)

Arkitekt: Fable (18/10). Ejerbeslutningerne i #6857 er låst og ikke genåbnet. Baseline er målt offline (fixture = prod-katalog 14/10). Prod-tal hentes med SQL i §4.

## 0. Nøglefund der styrer designet
- **Ingen nye løb og ingen nye datoer.** S5 er skrevet i prod 15/10 (437 løb, `upcoming`, start 28/10). Offline-planen har etapeløb pr. division D1 16 (13 korte + 3 GT), D2 19, D3 16 og D4 17, altså præcis ejerens 13/19/16/17. Typen tildeles de 65 allerede valgte løb, så kalender-golden-diff (måler placering, ikke terræn) er uændret.
- **Profiler kan regenereres på stedet.** `race_stage_profiles` er nøglet på `races.id` + `stage_number`. Alt spillerdata (`race_entries`, `race_entry_days`, `rider_peak_plans.target_race_id`, `race_stage_schedule`) peger på `races.id`. `engine_rules_revision` bindes ved første claim (null i dag). Konsumenterne læser kun `profile_type`/`demand_vector`/rute-kolonner. Samme antal rækker pr. løb giver ingen brud.
- **Entries findes ikke før 25/10.** `season_entry_generator` skriver S5-entries ved cutover. Vinduet 19-24/10 er derfor tomt for spillerdata.
- `backfillRaceStageProfiles.js` kan ikke bruges som den er (kender ikke `profileModel: "s5"`, `makeS5TierProfileGenerator` eller benchmark-gaten). Der skal et nyt script til.

## 1. Datamodel
**Type og signatur ligger på `race_pool`**, så identiteten følger løbet på tværs af sæsoner. Migration `database/2026-10-19-6857-race-identity.sql` (additiv, `IF NOT EXISTS`):
- `race_pool.race_identity_type text` CHECK IN (`sprinters`, `climbers_gt_prelude`, `hilly`, `cobbles_benelux`, `time_trial`, `gravel`, `mountains_first`, `allround`). Gælder kun etapeløb, og NULL betyder som i dag.
- `race_pool.signature jsonb`: 1-2 faste kendetegn, fx `{"features":[{"kind":"climb","name":"Oude Kwaremberg","category":"2","length_km":2.2,"avg_gradient":9.5,"stage_hint":"queen","summit_finish":true},{"kind":"itt","stage_hint":"last","band":"hilly"}]}`. `kind` ∈ climb/summit_finish/itt/prologue/sector og `stage_hint` ∈ first/last/queen/any.
- `race_pool.authored_route jsonb`: bruges kun til monumenterne. Indeholder den fulde rute i samme form som `race_stage_profiles` (`profile_type, finale_type, distance_km, elevation_gain_m, climbs[], sprints[], sectors[]`). `segments`, `weather` og `elevation_profile` beregnes stadig.

Versionsstyret kilde: `database/seed/race_identity.json` + `backend/scripts/applyRaceIdentity.js` (samme mønster som `applyRacePoolArchetypes.js`, dry-run som standard). Fixturen `racePoolCatalog.prod.json` udvides med felterne. `/api/race-pool` vælger eksplicitte kolonner og røres ikke.

Ordforråd i den nye rene fil `backend/lib/raceIdentityTypes.js`: `RACE_IDENTITY_TYPES`, `SIGNATURE_KINDS`, `TIER_IDENTITY_DISTRIBUTION` (ejerens tabel A), `validateSignature()` og `validateAuthoredRoute()`.

### L1-kontrakt (19/10)
Validatorerne returnerer `true` eller kaster `TypeError` med feltsti. Kun eksplicit `null` betyder legacy; manglende felter, ukendte nøgler, numeriske strenge og ikke-endelige tal afvises. Signaturens `climb`/`summit_finish` kræver navn, kategori, længde, gradient, stage_hint og boolean summit_finish (true for summit_finish-kind). `itt`/`prologue` kræver band flat/hilly; prologue kræver first. `sector` kræver surface cobbles/gravel, navn, længde og stage_hint. Authored route bruger eksisterende climb/crest_km-, sprint/km- og sector/start_km-former; alle placeringer skal ligge inden for ruten. Afledte felter må ikke forfattes.

Seed-envelope: `version: 1`, beskrivende `schema`, `examples` og `entries`. Kun entries anvendes; L1 leverer tom entries og tre syntetiske eksempler. Hver række kræver external_id og alle tre nullable identitetsfelter. Hele filen og alle katalogreferencer valideres før første mutation; dubletter og ukendte IDs stopper. Type/signatur kræver stage_race; authored_route kræver single med katalogklassen Monuments. `--apply` er eksplicit; ingen andre flag end `--file` accepteres. Skrivninger matches på katalogets id, kontrollerer én returneret række og er genkørbare; en netværksfejl under skrivning kan efterlade en delvis anvendelse (antal afsluttede skrivninger står i fejlen).

Tabel A gælder korte etapeløb: D1's 13 inkluderer de 3 GT-optakter; de tre Grand Tours er udenfor. Snapshot-kolonnelisten udvides til den kommende migration uden at ændre tidspunktet for seneste prod-udtræk. Fixturefelter er null, og API/generator er uændrede. Lokal migrationstest: `database/manual/2026-10-19-6857-local-pg17-test.ps1`. Ingen patch notes/FEATURE_REGISTRY-ændring i L1: ingen spilleradfærd eller flag aktiveres; releasekommunikation tilhører den samlede levering.

## 2. Generatorændringer
Hver type har et fast garanti-sæt, filler-vægte og en ordnings-arketype. Det lægges i en ny tabel `IDENTITY_PROFILES` i `raceStageProfileGenerator.js`, som erstatter `archetypeFor(race)` i S5-stien, når typen er sat. v5 forbliver bit-identisk.

| Type | Garantier | Filler | Ordning |
|---|---|---|---|
| sprinters | flat, flat, hilly | flat, rolling, hilly | sprint_finale; bjergfri |
| climbers_gt_prelude | mountain, high_mountain, flat | hilly, mountain, medium_mountain, high_mountain (#6995), itt | summit_finale |
| hilly | hilly, hilly, rolling | hilly, rolling, medium_mountain, flat | circuit_finale; bjergfri |
| cobbles_benelux | cobbles, flat, hilly | cobbles, flat, rolling | sprint/circuit; bjergfri |
| time_trial | itt (prolog, etape 1), itt_hilly (sidste tredjedel), flat | flat, rolling, hilly | tt_finale |
| gravel | gravel, flat, hilly | gravel, rolling, hilly | circuit_finale; bjergfri |
| mountains_first | mountain, high_mountain, flat, flat | flat, rolling | ny ordning `mountains_first`: bjerge forrest, fladt sidst |
| allround | flat, mountain, itt | som balanced_week | eksisterende vægte |

**Signaturen fastlåses i pass 2** (`raceRouteGenerator.js`, ny `applySignature`). En `climb` erstatter klimaks-stigningen på den etape, som `stage_hint` udpeger. Terrænet læses igen med `deriveTerrainType`, og hvis det skifter, kastes der (valideres i seed-testen). `itt`/`prologue` låser etapetypen før ordningen. Variationen pr. sæson bevares (`seedKeyFor` med `season_id`).

**Queen (#6995):** en `stage_hint: "queen"`-signatur er løbets hårdeste etape. Ingen garanti, filler eller kvote-type må ligge over queen-etapens terræn (uafgjort er tilladt); en garanti over den kaster (fail-closed).

**Monumenter:** `buildSingle` returnerer `authored_route`, når den findes. Finale-rampen (stigende spurt, mur, bakke) er et afledt felt og læses af rutens målstigning, holdt i afslutningens bånd (#6995). `generator_version` = 7 for identitets-stien.

**Kvoter:** `s5StageRaceFillerSlots` læser `IDENTITY_PROFILES`, og fillerne begrænses til typens liste. Brosten 5 % og ITT ~10 % måles i tørkørslen pr. division. `TIER_MOUNTAIN_FREE_STAGE_RACE_MIN` og `tierCalendarGuarantees.test.js` opdateres i samme PR. D1's 3 `climbers_gt_prelude` tildeles de tre korte D1-etapeløb, der slutter lige før Giro (1/11), Tour (8/11) og Vuelta (22/11).

## 3. S5-migration på stedet
Nyt script `backend/scripts/regenS5StageProfiles.mjs` (dry-run som standard; `--apply` kræver `--season 5 --confirm-season-upcoming`):
1. Læs S5-løb (senior), `race_pool` og `league_divisions.tier`. Byg seed-løb som `tierCalendarMaterializer.seedRaceFor`.
2. Generér med `makeS5TierProfileGenerator` pr. tier, og kør benchmark-gaten og dæknings-tjek. Er gaten rød, stoppes der.
3. Invariant-tjek (fail-closed): samme `races.id`-sæt, samme `stages`, `stages_completed = 0`, 0 claims, `engine_rules_revision IS NULL`, ingen `is_manual` og sæsonen `upcoming`. Efter 25/10 kræves ejer-go og `--allow-active`.
4. Snapshot: JSON til `docs/snapshots/6857/` + `backup_6857_race_stage_profiles_<dato>`-tabel før `--apply`.
5. Skriv pr. løb (DELETE + INSERT, batch 200). Post-verify: `count(profiles) = sum(stages)`, divergens 0 (`checkStageProfileSeedDivergence.js --season 5`) og tom `calendar`-cache.
6. Idempotent og deterministisk.

Tørkørslens rapport pr. division: etapeløb pr. type mod tabel A, brosten/ITT/højbjerg før og efter, bjergfrie etapeløb før og efter, §5-gulve, benchmark-gate 1-4, monument-ruter (km/hm/sektorer/sidste top) og signatur-pins. Rollback sker fra backup-tabellen.

## 4. Baseline (offline, fixture) og prod-SQL
Offline: D1 37 løb/160 etaper, D2 44/128, D3 37/96, D4 41/96. Benchmark-gaten er grøn 1-4. Sæsonens fordeling i procent: flad 23,5, kuperet 31,7, bjerg 29,2, ITT 10,0, brosten 5,6. Prod-SQL (read-only) til A) etapeløb pr. division med sammensætning, B) andele pr. division, C) monumenterne og D) sikkerhed før regen (entries, claims, peaks, manual, bound) ligger i Fables rapport på #6857.

## 5. Risici og testplan
Risici: låste tal i guarantees-testen, ITT/brosten kan skyde over ±2 pp, en signatur der bryder terrænet, cache-TTL og et snævert D1-rolling-gulv. Tests: alle 8 typer × 3-8 etaper × 200 seeds, signatur-pin, monument-spec, pass1-golden regenereret bevidst, kalender-golden uændret, benchmark-gaten grøn, `seasonCalendarGatesOffline --season 5` grøn, `s5MotorBench` på nye ruter og divergens 0.

## 6. PR-opdeling (bølge, 4 spor)
| Spor | Model | Filer |
|---|---|---|
| L1 kontrakt + DB (først) | opus | migration, `raceIdentityTypes.js` (+test), `race_identity.json` (skelet), `applyRaceIdentity.js`, fixture, schema-snapshot |
| L2 generator | opus | `raceStageProfileGenerator.js`, `raceRouteGenerator.js`, `s5TierTerrainQuota.js`, `tierCalendarGuarantees.js`, `tierCalendarMaterializer.js` + tests |
| L3 regen-script + rapport | opus | `regenS5StageProfiles.mjs` (+test), `CALENDAR_RULES.md` §7d |
| L4 forfatning + Hjælp | sonnet | indhold i `race_identity.json` (65 typer, signaturer med fiktive navne, 5 monumenter), `help.json` EN+DA `season.raceIdentity` + `HelpPage.jsx` |

## 7. Tidslinje
19/10: L1 merget og migration kørt, L2-L4 i gang. 20/10: L2+L3 grønne offline, L4 forfattet. **21/10 formiddag:** tørkørsel mod prod → ejer-kort med tal og billede. 21-22/10: ejer-go → apply, post-verify. 23/10: buffer. 25/10 cutover, 28/10 start.

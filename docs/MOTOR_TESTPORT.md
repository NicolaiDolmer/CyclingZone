# Motor-testport (#6750)

Én kommando der tester en ny motor-revision mod den aktuelle på alle kommende løb og laver ét samlet kort. Ren tooling: motoren ændres ikke, og prod læses kun (SELECT).

## Kør

```powershell
# Alle kommende (ikke startede) løb fra prod, read-only:
infisical run --env=prod --silent -- node backend/scripts/dev/motorTestport.mjs --candidate=<ny revision>

# Uden prod, fra en eksisterende eksport (mappe med <race_id>/cache.json, som tourDryRun --save-cache skriver):
node backend/scripts/dev/motorTestport.mjs --candidate=<ny revision> --from-dir=<eksport> --limit=5

# Saml kortet igen fra en tidligere kørsel:
node backend/scripts/dev/motorTestport.mjs --report-only --out=<tidligere out>
```

`--baseline` er som default den aktuelle revision (`CURRENT_RACE_RULES_REVISION`). Øvrige flag står i scriptets header: `--seeds` (default 8), `--parallel` (default 4), `--out`, `--limit`, `--races`, `--ids-file`, `--include-running`, `--no-bench`, `--bench-only`, `--bench-scope`, `--no-png`, `--season`, `--synthetic-field`, `--breakaway-intent`, `--intent-rates`, `--routes-from`, `--time-budget`.

## Før sæsonskiftet: syntetisk startfelt og foreslåede ruter (#6909)

```powershell
# S5-ruterne nu, før løbene har tilmeldinger (prod read-only):
infisical run --env=prod --silent -- node backend/scripts/dev/motorTestport.mjs --candidate=<ny> --baseline=<aktuel> --season=5 --synthetic-field --time-budget=8

# Foreslåede ruter (fx #6857's tørkørsel) i stedet for prod's nuværende:
infisical run --env=prod --silent -- node backend/scripts/dev/motorTestport.mjs --candidate=<ny> --routes-from=<mappe> --synthetic-field
```

- **`--synthetic-field`** (= `generator`): løb uden tilmeldinger får et startfelt i hukommelsen. Tilmeldingsgeneratoren (`raceEntryGenerator.runRaceEntryGenerator`) køres som dry-run på de nuværende trupper med en klient der afviser enhver skrivning; tilstanden er `late_fill` med "nu" sat til hvert løbs egen start (etape 1; løb med samme start køres sammen), så assistenten udtager alle hold i puljen med den dags skader og Train now-låse, ligesom redningen ved etape 1 gør i spillet. Hver kørsel ser kun sine egne løb; ryttere der allerede er udtaget til et overlappende løb, skjules. Holdene står i deres nuværende division (før op- og nedrykning), og ingen holdordrer er sat. Løb uden tildelt felt (fx uden tidsvindue) springes over og tælles.
- **`--synthetic-field=bench`**: det anonymiserede Giro-bench-felt (`s5MotorBench.loadBenchField`) i alle løb uden tilmeldinger. Kræver ikke prod, men er ikke de rigtige puljer; brug det kun når generatoren ikke kan køres.
- **`--breakaway-intent`** (#6804 P0, ejer 21/10; default `prod` med `--synthetic-field=generator`, kun tilladt dér: bench-feltet har kun AI-hold): menneskeholdene i et syntetisk felt får udbrudsvilje som i prod. Satserne læses read-only fra seneste afsluttede sæson (`seasons.status`; `--intent-season=<n>` vælger en anden), senior: pr. division og løbsgruppe (endagsløb, etapeløb, Grand Tour) hvor mange jægere og frie roller et menneskehold stiller pr. løb, og hvor mange "Forsøg udbrud" det giver pr. vejetape (tidskørsler tælles ikke). Små celler bruger gruppens samlede sats; grænsen er privat (`breakawayIntentMinCellTeamStages` i den private tærskelfil, hard rule 17), kræves når satserne hentes fra prod (mangler den, stopper kørslen), og står i satsfilen. Hvert menneskehold får det forventede antal, deterministisk: jæger-rollen går til holdets hjælpere med højest aggression og udholdenhed, "Forsøg udbrud" til den bedste hjælper på dagens terræn. Kaptajner, AI-hold, prod-tilmeldinger og et holds egne ordre-rækker røres aldrig. Satserne gemmes som `breakaway-intent-rates.json` i `--out`, og en genoptagelse med andre satser afvises; med `--from-dir` skal de gives med `--intent-rates=<fil>`. `--breakaway-intent=none` giver det gamle felt uden ordrer (fanger "intet udbrud"-tilfældet). Kode: `lib/breakawayIntent.mjs`.
- Løb der allerede har tilmeldinger, kører på dem. Kortet viser feltets kilde ("Startfelt: ...") og ruternes kilde ("Ruter: ...").
- **`--season=<n>`** begrænser prod-listen til én sæson. **`--time-budget=<min>`** starter ingen nye opgaver efter budgettet; samme kommando igen genoptager (de færdige løb springes over).

### Foreslåede ruter: formatet `cz-race-routes/v1`

En mappe med én fil pr. løb, `<race_id>.json`, og en valgfri `manifest.json`:

```json
{
  "format": "cz-race-routes/v1",
  "race_id": "<races.id>",
  "stages": 3,
  "profiles": [
    { "stage_number": 1, "profile_type": "...", "finale_type": "...", "demand_vector": { "sprint": 1 }, "generator_version": 7,
      "distance_km": 0, "elevation_gain_m": 0, "climbs": [], "sprints": [], "sectors": [], "segments": [],
      "weather": null, "elevation_profile": [] }
  ]
}
```

```json
{ "format": "cz-race-routes/v1", "label": "S5 identitet, tørkørsel 21/10", "season": 5, "generated_at": "<ISO>" }
```

- `profiles` er præcis de rækker der ville blive skrevet til `race_stage_profiles` for løbet: kun dens kolonner (`stage_number`, `profile_type`, `finale_type`, `demand_vector`, `generator_version`, `distance_km`, `elevation_gain_m`, `climbs`, `sprints`, `sectors`, `segments`, `weather`, `elevation_profile`; `id`, `race_id`, `is_manual` og `generated_at` er også tilladt; et `race_id` skal være løbets). Alle etaper skal med. Eksemplets `demand_vector` er skematisk (en gyldig form, ikke en rigtig vægtning). `demand_vector` er påkrævet (ikke-negative tal, mindst ét > 0), fordi generatoren udtager det syntetiske felt efter etapens krav. Det syntetiske felt udtages på hvert løbs egen startdato (etape 1), og en genoptaget kørsel afviser ruter hvis indhold er ændret (fingeraftryk i meta).
- Fail-closed: forkert `format`, `race_id` der ikke er filnavnet, ukendte kolonner, manglende `profile_type`, `stage_number` der ikke er 1..n uden huller, `stages` forskellig fra antallet af profiler, eller et etapeantal forskelligt fra løbets `races.stages` stopper kørslen før noget køres.
- Uden `--races`/`--ids-file` er udvælgelsen mappens løb; ellers skal hvert valgt løb have en fil. Løbet (navn, klasse, trup) og dets tilmeldinger hentes fra prod; kun etaperne udskiftes.

Kørslen bygger løbets `cache.json` i løbsmappen (tourDryRun-formen) med det syntetiske felt og/eller de foreslåede etaper, og tourDryRun læser den. Ved genoptagelse genbruges en eksisterende `cache.json`; en `--out` tilhører én kombination af revisioner, seeds, syntetisk felt, rute-mappe og sæson.

## Form og formtoppe (#6818, #6156)

Testporten og Tour-gennemtesten kører som udgangspunkt uden rytternes form: eksporten bærer ikke `rider_condition.form` eller formtoppe. Formtesten lægger dem på i to trin:

1. **Data (read-only, prod):** `infisical run --env=prod --silent -- node backend/scripts/dev/formTestData.mjs --from-dir=<eksport>/races --out=balance-internals/<...>/form-data.json`. Scriptet henter formen for feltets ryttere, formtoppene for løbets egen sæson (med spillets egen træningskvalitet, `resolvePeakTrainingQualities`), etapedagene (`race_stage_schedule.scheduled_at`) og et #6158-tjek af alle formtoppe (pr. sæson, S5-planer oprettet før S5-start, mål i en anden sæson, S4-vinduer der rager ind i S5). Klienten kan kun læse, og outputtet skal ligge under `balance-internals/`.
2. **Caches (offline):** `node backend/scripts/dev/formTestCaches.mjs --from-dir=<eksport>/races --form-data=<fil> --out-dir=balance-internals/<...>/races [--peaks=on|off|tq1]`. Startlisten får `form` og `peakWindows`, og etaperne får `peakDay`. `off` giver kun formen (kontrol), og `tq1` giver fuld træningskvalitet (øvre grænse). **Forbehold:** træningskvaliteten og formen er dem på data-dagen. For et kommende løb er optakten til et vindue ikke kørt endnu, så `on` er en nedre grænse (outputtets `leadup` tæller vinduerne med ufærdig optakt), og formen er dagens, ikke løbsdagens. Kør `--from-dir` på de nye caches uden `--routes-from`/`--synthetic-field`, ellers erstattes profiler og startliste. Derefter kører `motorTestport.mjs --from-dir=<ny eksport>` som normalt.

`tourScorecard.splitEntrants` tager `form` og `peakWindows` med, når startlisten har dem; uden dem er motor-input byte-identisk med før. Kode: `formTestData.mjs`, `formTestCaches.mjs`. Test: `formTest.test.mjs`.

## Tænd-gaten for v3: G16-G19 og G2 på flad (#6804, ejer valg 8 A)

Kortet dømmer v3-tilvalgenes gates for begge revisioner (spec `docs/superpowers/specs/2026-10-23-6804-v3-tilvalg-design.md` §2 og §5). De **blokerer** kun en kandidat fra `s5_profiles_v3` og frem: en gate der er FAIL eller MANGLER giver "TAEND-GATE v3 BLOKERET" på kortet og exit 1. For andre kandidater vises dommen til orientering.

- **G16 (#6937) bjergtrøjen:** pr. løbsgruppe (etapeløb, Grand Tour) hvor ofte klassementsvinderen også vinder bjergtrøjen, og hvor ofte bjergtrøjens vinder har udbrudspoint.
- **G17 (#6938) udgåede:** andelen af startere der udgår pr. løbsgruppe; kaptajner udgår ikke oftere end hjælpere.
- **G18 (#2757) pointtrøjen:** i etapeløb med nok flade etaper vinder en sprinter (sprint-kaptajn eller en af feltets bedste sprintere) trøjen, og klassementsvinderen sjældent.
- **G19 (#6486) bjerg uden topankomst:** nr. 10 (median, etaper hvor udbruddet ikke vandt) inden for loftet i hver division. Ingen sådan etape i kørslen = N/A.
- **G2 på flad (#6912):** ingen flad eller rullende etape over den øvre zone uden "ingen jagt-interesse", og ingen over den hårde grænse.

Fail closed: mangler målingen i scorecardet (et motor-spors felt er ikke leveret endnu) eller det private bånd, står gaten som MANGLER. Feltkontrakten pr. seed og etape står øverst i `lib/v3Gates.mjs`; `pointsWinner`/`komWinner` (`lib/jerseyTally.mjs`, samme akkumulering som raceRunner) og `sprintTop10` skrives af `tourScorecard.runTour`. Båndene ligger i den private tærskelfil under nøglen `v3Gates` (hard rule 17). Løbskonteksten (roller, sprint-rang, flade etaper, bjerg uden topankomst, division) læses fra løbets `cache.json`; eksportens mappe gemmes som `cacheDir` i `testport-meta.json`, så `--report-only` finder den igen.

**#2757 S0, spurtfinalen (måling, ingen gate):** på flade og brostens-etaper med massespurt hvor udbruddet ikke vandt: hvor ofte feltets bedste sprinter (og top 3) vinder, vinderens sprint-rang, vinderens rolle, hvor ofte en hjælper på sprint-kaptajnens hold vinder foran ham (holdordrernes lead-out-markering er ikke i scorecardet), og hvor godt top 10 følger sprint-evnen. Pr. terræn og løbsgruppe. Tallene står kun på det private kort.

## Hvad den gør

1. **Kommende løb:** ikke afsluttede løb uden kørt etape (dem en ny revision binder til), eller en eksport/id-liste.
2. **Tour-gennemtest pr. løb:** `tourDryRun.mjs` som child-proces pr. løb, kandidat og baseline side om side over samme seeds, `--parallel` ad gangen. Hvert løb får sin mappe med log og en `done`-markør; en afbrudt kørsel genoptages ved at køre samme kommando igen.
3. **S5-motor-bench:** `s5MotorBench` (`--scope=all`) under begge revisioner.
4. **Ét kort:** `testport.md`, `testport.json` og `testport.png` (overblikket; kræver Playwright i `frontend/node_modules`, ellers springes PNG over).

**Løbsgrupper (#6804 P7):** kortet har et afsnit med udbrudssejre pr. løbsgruppe (Grand Tour, etapeløb, endagsløb) × terræn og samlet pr. gruppe (gate G1' og G14), og tidsgab i korte etapeløb (2-4 og 5-8 etaper: slutklassementets nr. 10 og vindermarginen, median og hale; gate G12). Båndene står kun i den private tærskelfil (`breakawayWinShareByGroup`, `breakawayGroupTotalBands`, `shortStageRaceGapBands`); mangler et bånd, er dommen "-". Scorecardet (`tourScorecard.summarizeTour`) dømmer aldrig et kort etapeløb mod Grand Tour-båndene: tourDryRun alene giver N/A, og testport-kortet dømmer hvert kort løbs nr. 10 og vindermargin mod de private bånd (`withShortRaceGapBands`), så de også tæller i dommene pr. måling.

**Klassementsjagten (#6804 G11):** scorecardet markerer pr. vejetape om klassementsjagten hentede udbruddet i første del af etapen (en indhentning inden for motorens egen "første del", hvor et af de jagende hold havde en igangværende klassementsreaktion i filmen), og om der var yo-yo (hentet, nyt udbrud, hentet igen). Kortet viser andelene for Grand Tours og etapeløb side om side. Lofterne er private og valgfrie (`gcChaseCatchBands` i tærskelfilen); uden loft er dommen "-". Kode: `tourScorecard.gcChaseCatchFacts`, `motorTestportReport.aggregateRaceGroups`.

**Forspring (#6804 G2):** hver vejetape i kortets json har udbruddets største forspring (`breakawayMaxLead`, sekunder) og om motoren meldte "intet hold ville jage" (`breakawayUnchased`, P2's `breakaway_unchased`). Forspringet måles i motorens segment-snapshots mod feltet: den forreste gruppe uden for udbruddet med en reel andel af rytterne; er feltet splittet så ingen gruppe er så stor (fx på slutstigningen), tæller snapshottet ikke. Zonerne (mellemzone, øvre zone, hård grænse) står privat; dommen (median i mellemzonen, andel over den øvre zone, nul over den hårde grænse, og over den øvre zone kun med "intet hold ville jage") laves i dag uden for kortet fra json'en. Under `s5_profiles_v3` gælder G2 for hold med *effektiv* interesse (interesse og ryttere at jage med): "intet hold ville jage" kan også være årsagen `no_riders` (klatre-jagten, P2.4), som rapporteres for sig. Kode: `tourScorecard.breakawayLeadFacts`.

**Sammensætning (#6804 G3, måling):** hver vejetape har morgenudbruddets antal klassementsfavoritter (klassementets forreste før etapen; på 1. etape startfeltets bedste på klassementsevne), etapefavoritter (startfeltets bedste på dagens afslutnings-evne) og flest ryttere fra samme hold (`breakawayGcFav`, `breakawayStageFav`, `breakawayMaxSameTeam`). Definitionerne er arbejdsvalg, lofterne private; dommen laves i dag uden for kortet. Kode: `tourScorecard.breakawayCompositionFacts`.

**Pointtrøjen (#2757 S0, måling):** hver vejetape har vinderens plads på sprint-evne i startfeltet (`winnerSprintRank`, 1 = feltets bedste sprinter), og hvert seed af et etapeløb har pointtrøjens vinder ud fra motorens egne passage-point (`pointsJersey`: rolle, sprint-plads og om det er klassementsvinderen). Dermed kan pointtrøjens vinder-type (sprinter, klassementsvinder, andre) og hvem der vinder de flade spurtetaper opgøres pr. løbsgruppe. Ingen gate og intet bånd endnu (G18 er privat og ikke fastlagt); tallene står privat. Leadout-effekten måles kun når feltet har leadout-ordrer. Kode: `tourScorecard.sprintRankIn`, `tourScorecard.pointsJerseyWinner`.

Kortet viser kandidat og baseline side om side: scorecard-mål (domme pr. måling), hårde gates (mærkning, minuttab på 0 km, flad udbrudssejr med minutter, GC-top-10 i udbrud, hold der jagter egne, ramt loft), udbrud pr. terræn og profiltype, favorit-udbrudssejre (kaptajn vinder fra udbruddet), GC-vinder fra udbrud, tidlige indhentninger (og om et nyt udbrud gik), bench-gatens dom pr. afslutning og en tabel pr. løb sorteret efter størst forværring.

## Tal

Hard rule 17: kortet indeholder målte tal og løbsnavne og skrives kun til `balance-internals/` (default `balance-internals/<issue>/<dato>/`, gitignoreret); scriptet afviser en `--out` uden for en `balance-internals`-mappe. Et forventet løb uden læsbart scorecard eller en fejlet opgave står som advarsel på kortet og giver exit 1. Repoet har værktøjet og definitionerne, aldrig tallene. Testene bruger syntetiske fixtures.

Balance-tærskler kortet bruger (fx hvornår en udbrudssejr har "stort forspring") ligger i en privat fil, `balance-internals/motor-testport-thresholds.json` (eller `--thresholds=<fil>`), aldrig i koden. Mangler filen, vises de målinger som "-". En `--out`-mappe tilhører én løbsudvælgelse: genoptagelse med samme løb er ok, et andet sæt afvises.

Kode: `backend/scripts/dev/motorTestport.mjs` (kørsel), `backend/scripts/dev/lib/motorTestportReport.mjs` (samling, ren), `backend/scripts/dev/lib/motorTestportInputs.mjs` (syntetisk felt og foreslåede ruter, #6909), `tourScorecard.testportStageFacts` (etapens vinder, udbrudsryttere og tidlig indhentning).

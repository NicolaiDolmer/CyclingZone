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

`--baseline` er som default den aktuelle revision (`CURRENT_RACE_RULES_REVISION`). Øvrige flag står i scriptets header: `--seeds` (default 8), `--parallel` (default 4), `--out`, `--limit`, `--races`, `--ids-file`, `--include-running`, `--no-bench`, `--bench-only`, `--bench-scope`, `--no-png`, `--season`, `--synthetic-field`, `--routes-from`, `--time-budget`.

## Før sæsonskiftet: syntetisk startfelt og foreslåede ruter (#6909)

```powershell
# S5-ruterne nu, før løbene har tilmeldinger (prod read-only):
infisical run --env=prod --silent -- node backend/scripts/dev/motorTestport.mjs --candidate=<ny> --baseline=<aktuel> --season=5 --synthetic-field --time-budget=8

# Foreslåede ruter (fx #6857's tørkørsel) i stedet for prod's nuværende:
infisical run --env=prod --silent -- node backend/scripts/dev/motorTestport.mjs --candidate=<ny> --routes-from=<mappe> --synthetic-field
```

- **`--synthetic-field`** (= `generator`): løb uden tilmeldinger får et startfelt i hukommelsen. Tilmeldingsgeneratoren (`raceEntryGenerator.runRaceEntryGenerator`) køres som dry-run på de nuværende trupper med en klient der afviser enhver skrivning; tilstanden er `late_fill` med "nu" sat til hvert løbs egen start (etape 1; løb med samme start køres sammen), så assistenten udtager alle hold i puljen med den dags skader og Train now-låse, ligesom redningen ved etape 1 gør i spillet. Hver kørsel ser kun sine egne løb; ryttere der allerede er udtaget til et overlappende løb, skjules. Holdene står i deres nuværende division (før op- og nedrykning), og ingen holdordrer er sat. Løb uden tildelt felt (fx uden tidsvindue) springes over og tælles.
- **`--synthetic-field=bench`**: det anonymiserede Giro-bench-felt (`s5MotorBench.loadBenchField`) i alle løb uden tilmeldinger. Kræver ikke prod, men er ikke de rigtige puljer; brug det kun når generatoren ikke kan køres.
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
2. **Caches (offline):** `node backend/scripts/dev/formTestCaches.mjs --from-dir=<eksport>/races --form-data=<fil> --out-dir=balance-internals/<...>/races [--peaks=on|off|tq1]`. Startlisten får `form` og `peakWindows`, og etaperne får `peakDay`. `off` giver kun formen (kontrol), og `tq1` giver fuld træningskvalitet (øvre grænse). Derefter kører `motorTestport.mjs --from-dir=<ny eksport>` som normalt.

`tourScorecard.splitEntrants` tager `form` og `peakWindows` med, når startlisten har dem; uden dem er motor-input byte-identisk med før. Kode: `formTestData.mjs`, `formTestCaches.mjs`. Test: `formTest.test.mjs`.

## Hvad den gør

1. **Kommende løb:** ikke afsluttede løb uden kørt etape (dem en ny revision binder til), eller en eksport/id-liste.
2. **Tour-gennemtest pr. løb:** `tourDryRun.mjs` som child-proces pr. løb, kandidat og baseline side om side over samme seeds, `--parallel` ad gangen. Hvert løb får sin mappe med log og en `done`-markør; en afbrudt kørsel genoptages ved at køre samme kommando igen.
3. **S5-motor-bench:** `s5MotorBench` (`--scope=all`) under begge revisioner.
4. **Ét kort:** `testport.md`, `testport.json` og `testport.png` (overblikket; kræver Playwright i `frontend/node_modules`, ellers springes PNG over).

Kortet viser kandidat og baseline side om side: scorecard-mål (domme pr. måling), hårde gates (mærkning, minuttab på 0 km, flad udbrudssejr med minutter, GC-top-10 i udbrud, hold der jagter egne, ramt loft), udbrud pr. terræn og profiltype, favorit-udbrudssejre (kaptajn vinder fra udbruddet), GC-vinder fra udbrud, tidlige indhentninger (og om et nyt udbrud gik), bench-gatens dom pr. afslutning og en tabel pr. løb sorteret efter størst forværring.

## Tal

Hard rule 17: kortet indeholder målte tal og løbsnavne og skrives kun til `balance-internals/` (default `balance-internals/<issue>/<dato>/`, gitignoreret); scriptet afviser en `--out` uden for en `balance-internals`-mappe. Et forventet løb uden læsbart scorecard eller en fejlet opgave står som advarsel på kortet og giver exit 1. Repoet har værktøjet og definitionerne, aldrig tallene. Testene bruger syntetiske fixtures.

Balance-tærskler kortet bruger (fx hvornår en udbrudssejr har "stort forspring") ligger i en privat fil, `balance-internals/motor-testport-thresholds.json` (eller `--thresholds=<fil>`), aldrig i koden. Mangler filen, vises de målinger som "-". En `--out`-mappe tilhører én løbsudvælgelse: genoptagelse med samme løb er ok, et andet sæt afvises.

Kode: `backend/scripts/dev/motorTestport.mjs` (kørsel), `backend/scripts/dev/lib/motorTestportReport.mjs` (samling, ren), `backend/scripts/dev/lib/motorTestportInputs.mjs` (syntetisk felt og foreslåede ruter, #6909), `tourScorecard.testportStageFacts` (etapens vinder, udbrudsryttere og tidlig indhentning).

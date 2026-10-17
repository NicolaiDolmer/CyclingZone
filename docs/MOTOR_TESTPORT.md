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

`--baseline` er som default den aktuelle revision (`CURRENT_RACE_RULES_REVISION`). Øvrige flag står i scriptets header: `--seeds` (default 8), `--parallel` (default 4), `--out`, `--limit`, `--races`, `--ids-file`, `--include-running`, `--no-bench`, `--bench-only`, `--bench-scope`, `--no-png`.

## Hvad den gør

1. **Kommende løb:** ikke afsluttede løb uden kørt etape (dem en ny revision binder til), eller en eksport/id-liste.
2. **Tour-gennemtest pr. løb:** `tourDryRun.mjs` som child-proces pr. løb, kandidat og baseline side om side over samme seeds, `--parallel` ad gangen. Hvert løb får sin mappe med log og en `done`-markør; en afbrudt kørsel genoptages ved at køre samme kommando igen.
3. **S5-motor-bench:** `s5MotorBench` (`--scope=all`) under begge revisioner.
4. **Ét kort:** `testport.md`, `testport.json` og `testport.png` (overblikket; kræver Playwright i `frontend/node_modules`, ellers springes PNG over).

Kortet viser kandidat og baseline side om side: scorecard-mål (domme pr. måling), hårde gates (mærkning, minuttab på 0 km, flad udbrudssejr med minutter, GC-top-10 i udbrud, hold der jagter egne, ramt loft), udbrud pr. terræn og profiltype, favorit-udbrudssejre (kaptajn vinder fra udbruddet), GC-vinder fra udbrud, tidlige indhentninger (og om et nyt udbrud gik), bench-gatens dom pr. afslutning og en tabel pr. løb sorteret efter størst forværring.

## Tal

Hard rule 17: kortet indeholder målte tal og løbsnavne og skrives kun til `balance-internals/` (default `balance-internals/<issue>/<dato>/`, gitignoreret); scriptet afviser en `--out` uden for en `balance-internals`-mappe. Et forventet løb uden læsbart scorecard eller en fejlet opgave står som advarsel på kortet og giver exit 1. Repoet har værktøjet og definitionerne, aldrig tallene. Testene bruger syntetiske fixtures.

Balance-tærskler kortet bruger (fx hvornår en udbrudssejr har "stort forspring") ligger i en privat fil, `balance-internals/motor-testport-thresholds.json` (eller `--thresholds=<fil>`), aldrig i koden. Mangler filen, vises de målinger som "-". En `--out`-mappe tilhører én løbsudvælgelse: genoptagelse med samme løb er ok, et andet sæt afvises.

Kode: `backend/scripts/dev/motorTestport.mjs` (kørsel), `backend/scripts/dev/lib/motorTestportReport.mjs` (samling, ren), `tourScorecard.testportStageFacts` (etapens vinder, udbrudsryttere og tidlig indhentning).

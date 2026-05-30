# Secret-leak: `infisical secrets --plain` slap forbi deny-list-hul

**Dato:** 2026-05-30
**Type:** Secret-leak (3. bekræftede store leak — jf. #296, #620)
**Eksponeret:** `SUPABASE_SERVICE_KEY` (fuld DB-adgang, bypasser RLS) + `TEST_ACCOUNT_PASSWORD` i transcript. `VITE_SUPABASE_ANON_KEY` lækkede også, men anon-key er public per Supabase-model (ingen handling).
**Refs:** [#634](https://github.com/NicolaiDolmer/CyclingZone/issues/634) (hook-systemet), [#201](https://github.com/NicolaiDolmer/CyclingZone/issues/201) (SERVICE_KEY allerede flagget til rotation).

## Hvad skete der

Under #767-follow-up (sync af test-konto-password til Infisical) ville jeg verificere hvilken nøgle anon-key lå under. Jeg kørte `infisical secrets --env=dev --plain`, som printede ALLE secret-values i klartekst til transcript.

PostToolUse `sanitize-secrets.sh` fyrede korrekt (`leak=True count=3`), men det er en BAGEFTER-defense — værdierne nåede min context før redaction.

## Rod-årsag (ikke symptom)

To uafhængige fejl:

1. **Deny-list-hul (primær).** PreToolUse `block-dangerous-secret-commands.{sh,ps1}` blokerede kun `infisical secrets list --format json` — den GAMLE CLI-form. Den moderne Infisical-CLI bruger `infisical secrets` (tabel m. value-kolonne) + `infisical secrets --plain` (KEY=VALUE) + `infisical export` (dotenv). Ingen af dem matchede. Catalog-doc'en (`SECRET_LEAK_VECTORS.md`) pegede oven i købet på `--raw=false` som mitigation — et flag der ikke findes i moderne CLI. Deny-lists fejler ALTID open på nye kommando-former.

2. **Adfærd.** Jeg behøvede ikke value'en overhovedet — kun at vide om en key var sat. Det rigtige værktøj (`verify-infisical-injection.js`, printer navne/antal uden values) fandtes allerede.

## Fix (verificeret samme session)

- **Kategorisk blok** af `infisical (secrets|export)` i begge hooks — INGEN allow-pipe-undtagelse (det var netop en snæver undtagelse der skabte hullet). Kun `infisical run -- <cmd>` (runtime-injection, printer intet) + `infisical login` slipper igennem.
- Test: 8/8 (bash) + 7/7 (pwsh) — alle dump-former exit 2, `run`/`login` exit 0. Regression: sanitize-suite 17/0.
- Catalog-række + leak-tabel opdateret i `SECRET_LEAK_VECTORS.md`.

## Forward-guard / generel regel

- **Secrets inspiceres ALDRIG for values.** "Er key X sat?" → `infisical run --env=dev -- node backend/scripts/verify-infisical-injection.js`. Aldrig `infisical secrets`/`--plain`/`export`.
- **Deny-list → allow-list (retning).** Deny-lists er strukturelt utætte. P1: én godkendt probe pr. secret-store, rå store-reads blokeres kategorisk. Tracket separat.
- **Når en CLI-vektor blokeres: dæk ALLE subcommand-former + flags**, ikke kun den ene jeg lige så. Test både blokerede og tilladte former.

## Bonus-fejl i samme session (separat learning-værdi)

Jeg skrev "login verificeret for alle 3 konti" i en commit FØR jeg havde et grønt bevis (probe fejlede faktisk pga. env-navn-mismatch `SUPABASE_ANON_KEY` vs Infisicals `VITE_SUPABASE_ANON_KEY`). Overclaim rettet i `d9e4319`. Regel (`feedback_runtime_verify_first`): skriv kun "verificeret" hvis det grønne bevis ligger i DENNE session. Korrekt verifikation gøres ved at smide token-stdout væk og kun tjekke exit-kode.

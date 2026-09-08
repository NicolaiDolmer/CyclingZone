# 2026-09-07: Migration halvt applied i prod: INSERT med 4 kolonner og 3 værdier

**Issue:** #4943 (in-app spørgeskema). PR #5006 (merget 309b46c73), hotfix PR #5024. Aftenbølge 7/9.

## Hvad skete

Seedet i `database/2026-09-07-4943-in-app-survey.sql` havde `INSERT INTO public.surveys (slug, title_en, title_da, status) VALUES (<3 værdier>)`. Fejlen stod i det oprindelige seed fra dagbølgen og overlevede: workerens egen gennemgang, `scripts/lint-sql-strings.mjs`, to CodeRabbit-runder, indholdsrettelsen samme aften (11 spørgsmål) og orkestratorens diff-læsning. `auto-migrate.yml` kører hver fil med `psql -v ON_ERROR_STOP=1` uden `-1`, så alt før fejlen (4 tabeller, indeks, 11 RLS-policies) blev committet, mens skema-rækken og spørgsmålene ikke blev skrevet og filen ikke landede i `schema_migrations`. Main var rød på auto-migrate i ca. 35 minutter, og næste merge ville have gentaget fejlen.

## Rod-årsag

Ingen migration køres mod en rigtig Postgres før merge. Supabase Preview-checket står til "skipping". Alle vagter er tekstuelle. En arity-fejl er usynlig for dem alle.

## Hvad der virkede

- Idempotent design (IF NOT EXISTS, DROP POLICY IF EXISTS, ON CONFLICT DO UPDATE) gjorde at hotfixet blot var at rette én linje og lade CI gen-køre samme fil. Ingen manuel prod-SQL, ingen oprydning.
- Merge-køen (#4919) stoppede resten af køen, så intet blev merget oven på rød main.
- Post-verify via MCP efter hver migration (hard rule 9) fangede det inden for få minutter: `surveys` = 0 rækker mens tabellen fandtes.

## Forward-guard

- Bygget i #5024: `scripts/lint-sql-insert-arity.mjs` (kolonner mod værdier i literal INSERT ... VALUES i `database/*.sql`), koblet på preflight (ubetinget) og lint-staged. Kørt mod hele `database/`: 0 andre fund.
- Foreslået, ikke bygget (ejer: "intet nyt i aften"): CI-job der kører alle pending `database/*.sql` mod en tom Postgres-service-container med `ON_ERROR_STOP` på hver PR, som en rigtig tør-kørsel. Kandidat til issue ved næste ops-slot. Det ville også have fanget denne klasse uden lint.
- Orkestrator-regel: efter HVER merge med `database/*.sql` tjekkes auto-migrate-runnet eksplicit (`gh run list --workflow auto-migrate.yml`) FØR næste merge sættes i kø. Merge-køen venter på CI (main) og Deploy verify, ikke på auto-migrate.

## Bonus-fund samme nat

Git Bash' `date` på denne PC printer UTC uden zone-mærke; PowerShell `Get-Date` printer lokal tid. Flere issue-kommentarer 7/9 fik derfor tidsstempler to timer for tidligt. Brug `Get-Date -Format "yyyy-MM-dd HH:mm zzz"` til tidsstempler.

Refs #4943 #5006 #5024 #2642 #4919

## Efterladt under-agent (fundet 8/9 kl. 09:00)

En worker fra aftenboelgen spawnede selv en under-agent ("Kortlaeg frontend-moenstre") ca. 20:40, som hang paa en kommando i 12 timer uden fremdrift (188,8k tokens, 54 kald) og foerst blev stoppet da ejeren saa den i task-panelet. Regel til worker-skabelonen: workers spawner ALDRIG egne agenter (ingen Agent-tool-kald i workers); orkestratoren ejer alle spawns og TaskStop. Orkestratoren tjekker ved close-out task-listen for fremmede agenter (TaskStop-fejlbeskeden lister dem).

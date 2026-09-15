# 2026-09-15: main rød to gange på én formiddag (ratchet mod forældet base + name[] = text[])

## Hvad skete

1. **PR #5205** (træning pr. løbsdag, bag flag) merget kl. 08:54. auto-migrate.yml fejlede på migrationens constraint-opslag: `array_agg(a.attname ...) = ARRAY['team_id','tick_date']` sammenligner `name[]` med `text[]`, som Postgres afviser. De to `ALTER TABLE` før fejlen var allerede kørt; constraint-DROP, indexe, historiktabel og flag manglede. Fail-safe holdt (flag mangler = off).
2. **PR #5214** (anmeld handel) merget kl. 09:04 via merge-køen. PR'en var grøn på sin egen base, men main havde natten før fået fetch-wiring-ratchetten (#5248): `check-fetch-wiring.mjs` afviser nye bare `fetch()`. `ReportTradeDialog.tsx` havde ét. main's frontend-build rød.

Begge rettet i PR #5258 (cast `::text` + `apiFetch`).

## Rod-årsager

- **Migrationstest kørte aldrig mod Postgres.** CodeRabbit læste SQL'en, backend-suiten mocker Supabase, og migration-idempotency-CI kører kun lint. En `name[] = text[]`-fejl kan kun fanges af en ægte psql-kørsel.
- **Merge-køen kræver ikke opdateret base.** `mergeStateStatus = MERGEABLE` betyder "ingen konflikt", ikke "grøn mod nuværende main". En ratchet (guard der strammer over tid) merget på main gør alle ældre grønne PR'er potentielt røde uden at nogen check fortæller det.

## Forward-guards (foreslået, ikke bygget)

- `scripts/merge-queue.ps1`: før merge, tjek `git merge-base --is-ancestor origin/main <pr-head>`; ellers `gh pr update-branch` og vent på ny CI. Én ekstra CI-runde pr. PR er billigere end en rød main.
- `migration-idempotency-CI`: kør hver ny `database/*.sql` mod en Postgres-service-container (samme psql-kald som auto-migrate.yml), ikke kun lint. Ville have fanget begge migrationsfejl-klasser (#4846 i dag, kolonne-rækkefølge-fejlen CodeRabbit fandt 14/9).

## Regler der holdt

- Merge-køen stoppede selv på rød check før næste PR. Auto-migrate's fail-safe (`ON_ERROR_STOP`, ingen schema_migrations-række) gjorde genkørslen ren.
- Post-verify efter migration-merge (memory: Claude post-verificerer) fangede den manglende tabel/flag inden for 5 minutter.

Refs #4846 #4346 #5242 #5258

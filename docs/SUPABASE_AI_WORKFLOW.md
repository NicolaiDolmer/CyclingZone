# Supabase AI Workflow

Formålet er at give Codex tæt, billig og sikker Supabase-kontekst uden at dumpe brede tabeller ind i chatten.

## Standard

1. Brug altid repo-root fra `git rev-parse --show-toplevel`.
2. Brug `.codex.local/supabase-readonly.env` til live-inspektion.
3. Start med små probes:

```powershell
npm run db:ai:status
npm run db:ai:schema
npm run db:ai:season-flow
npm run db:ai:import-health
npm run db:ai:views
```

4. Kør kun bredere live-inspektion, hvis probes viser drift eller manglende data.

## Lokal opsætning

Opret mappen og kopier templates:

```powershell
New-Item -ItemType Directory -Force .codex.local
Copy-Item docs\templates\supabase-readonly.env.example .codex.local\supabase-readonly.env
Copy-Item docs\templates\SUPABASE_CONTEXT.example.md .codex.local\SUPABASE_CONTEXT.md
```

Udfyld derefter:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_READONLY_KEY=PASTE_READ_ONLY_KEY_HERE
```

Brug ikke `SUPABASE_SERVICE_KEY` til rutinearbejde. Hvis der midlertidigt bruges en stærkere nøgle lokalt, skal det være en bevidst one-off og aldrig committes.

## Hvad probes gør

- `db:ai:status`: aktiv sæson, centrale row counts og seneste import-log.
- `db:ai:schema`: kompakt kontraktcheck af de vigtigste tabeller/kolonner.
- `db:ai:season-flow`: aktiv sæson, races, standings, race_results og prize finance counts.
- `db:ai:import-health`: seneste importforsøg og lille sample af importfejl.
- `db:ai:views`: verificerer om de optional `ai_*` views er installeret og læsbare.
- `db:ai:all`: alt ovenstående i én kompakt JSON.

## Optional AI views

Kør [database/ai_readonly_views.sql](../database/ai_readonly_views.sql) i Supabase SQL Editor, hvis Codex skal have endnu billigere status-spørgsmål via views. Almindelig `SUPABASE_URL` + anon/read-only key kan ikke oprette views; det kræver SQL Editor, `psql` med DB-password eller en Supabase CLI-session med databaseadgang.

## Supabase MCP

Hvis Supabase MCP aktiveres senere, skal den scopes til ét projekt og helst read-only. MCP er bedst til schema, logs, advisors og målrettede SQL-spørgsmål. De repo-lokale probes forbliver førstevalg, fordi de er reproducerbare og token-billige.

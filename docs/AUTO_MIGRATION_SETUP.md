# Auto-migration setup

GitHub Actions workflow `.github/workflows/auto-migrate.yml` kører automatisk
nye SQL-filer fra `database/` mod live Supabase ved push til main. Erstatter
manuel "kopier SQL ind i dashboard"-proces.

## Setup (én gang)

### 1. Hent connection string fra Supabase

Åbn https://supabase.com/dashboard/project/ghwvkxzhsbbltzfnuhhz/settings/database

Scroll til **"Connection string"** → vælg **"URI"** tab → kopiér hele strengen.
Format: `postgres://postgres:[YOUR-PASSWORD]@db.ghwvkxzhsbbltzfnuhhz.supabase.co:5432/postgres`

(Hvis du har glemt password: klik "Reset database password" først — dette
ændrer `SUPABASE_SERVICE_KEY` ikke, kun postgres-direct password.)

### 2. Tilføj GitHub secret

Åbn https://github.com/NicolaiDolmer/CyclingZone/settings/secrets/actions

- Klik "New repository secret"
- **Name:** `SUPABASE_DB_URL`
- **Secret:** hele `postgres://`-strengen fra step 1
- "Add secret"

### 3. Verificér

Næste push der ændrer `database/2026-*.sql` triggerer workflow'et automatisk.
Eller test med manual trigger:
https://github.com/NicolaiDolmer/CyclingZone/actions/workflows/auto-migrate.yml
→ "Run workflow" → main → "Run workflow".

## Hvordan det virker

1. **Trigger:** push til main hvor `database/2026-*.sql` er ændret (eller manuel dispatch).
2. **Wait 3 min:** frontend (Vercel) og backend skal være færdig-deployet før SQL kører — ellers race condition mellem ny migration og gammel kode.
3. **Detect pending:** workflow lister local `database/2026-*.sql` filer og finder dem der ikke er i `schema_migrations` tabel (filename PK).
4. **Apply:** for hver pending — kør SQL via `psql` med `ON_ERROR_STOP=1` (fail-fast), insert filename i `schema_migrations`.
5. **Concurrency:** group `auto-migrate-prod` sikrer at to runs ikke kollideret. `cancel-in-progress: false` betyder en kørende migration får lov til at færdiggøre selv hvis ny push ankommer.

## Fail modes

| Symptom | Action |
|---|---|
| `SUPABASE_DB_URL secret missing` | Følg step 2 ovenfor |
| `psql: connection refused` | Tjek IP allowlist i Supabase → Settings → Database. GitHub Actions runner-IPs er dynamiske; Supabase tillader alle by default |
| Migration SQL fejler | Workflow stopper og marker run som failed. Hot-fix: kør SQL manuelt via dashboard, indsæt filename i `schema_migrations`, retrig workflow via "Re-run failed jobs" |
| Migration kører 2x ved race | `concurrency: group + cancel-in-progress: false` forhindrer det. Hvis det alligevel sker: idempotente migrations (IF NOT EXISTS) er safe. Ikke-idempotente (DROP COLUMN osv.) skal koordineres manuelt |

## Manuel marker som applied (skip workflow)

Hvis en migration er kørt manuelt via dashboard og du vil forhindre workflow i at køre den:

```sql
INSERT INTO schema_migrations (filename) VALUES ('database/2026-05-04-yourfile.sql');
```

## Manuel re-run (kør en applied migration igen)

```sql
DELETE FROM schema_migrations WHERE filename = 'database/2026-05-04-yourfile.sql';
-- Næste workflow-run vil se den som pending
```

## Sleep-tid optimering

Den hardcodede `sleep 180` er en pragmatisk margin. Hvis dine deploys tager længere/kortere: rediger `.github/workflows/auto-migrate.yml`. Alternativ: implementér health-check polling der venter til backend `/health` eksponerer ny git SHA — kræver backend-ændring.

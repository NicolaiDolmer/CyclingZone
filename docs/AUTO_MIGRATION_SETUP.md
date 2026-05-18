# Auto-migration setup

GitHub Actions workflow `.github/workflows/auto-migrate.yml` kører automatisk
nye SQL-filer fra `database/` mod live Supabase ved push til main. Erstatter
manuel "kopier SQL ind i dashboard"-proces.

## Setup (én gang)

### 1. Hent connection string fra Supabase

Åbn projekt-dashboard → klik **"Connect"**-knappen øverst (toolbaren ved siden af projekt-navn).

**VIGTIGT — brug Session Pooler, IKKE Direct connection:**
GitHub Actions-runners bruger IPv4. Direct connection (`db.<ref>.supabase.co:5432`)
er IPv6-only på free tier → workflow vil fejle med "connection refused".

I "Connect"-modalet:
1. Klik **"Pooler settings"**-knappen
2. Vælg **Session Pooler** (IKKE Transaction Pooler — DDL virker ikke i transaction-mode pooling)
3. Format: `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
4. Erstat `[YOUR-PASSWORD]` med din database-password (klik "Reset database password" hvis glemt — det påvirker IKKE `SUPABASE_SERVICE_KEY`)

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
| `psql: connection refused` eller `Network is unreachable` | Du brugte sandsynligvis Direct connection (IPv6-only). Skift til Session Pooler URL — se step 1 ovenfor |
| Migration SQL fejler | Workflow stopper og marker run som failed. Hot-fix: kør SQL manuelt via dashboard, indsæt filename i `schema_migrations`, retrig workflow via "Re-run failed jobs" |
| Migration kører 2x ved race | `concurrency: group + cancel-in-progress: false` forhindrer det. Hvis det alligevel sker: idempotente migrations (IF NOT EXISTS) er safe. Ikke-idempotente (DROP COLUMN osv.) skal koordineres manuelt |

## Manuel marker som applied (skip workflow)

Hvis en migration er kørt manuelt via dashboard og du vil forhindre workflow i at køre den:

```sql
INSERT INTO schema_migrations (filename) VALUES ('database/2026-05-04-yourfile.sql');
```

**VIGTIGT — brug `database/`-prefix:** Auto-migrate skriver filename som `database/<file>.sql`
(jf. `ls database/2026-*.sql` i workflow). Hvis du indsætter en record uden prefix
(`'2026-05-04-yourfile.sql'`), vil auto-migrate ikke matche den og køre migrationen
igen — resulterer i duplikat-record + Detector C-finding i feature-liveness auditen
([#478](https://github.com/NicolaiDolmer/CyclingZone/issues/478) postmortem). Idempotente migrations er safe at re-køre, men bookkeeping forbliver beskidt indtil duplikat slettes manuelt.

## Manuel re-run (kør en applied migration igen)

```sql
DELETE FROM schema_migrations WHERE filename = 'database/2026-05-04-yourfile.sql';
-- Næste workflow-run vil se den som pending
```

## Sleep-tid optimering

Den hardcodede `sleep 180` er en pragmatisk margin. Hvis dine deploys tager længere/kortere: rediger `.github/workflows/auto-migrate.yml`. Alternativ: implementér health-check polling der venter til backend `/health` eksponerer ny git SHA — kræver backend-ændring.

# 2026-07-02 — Manager-profilens sæsonhistorik tavst tom: ORDER BY på kolonne der aldrig eksisterede

**Issue:** #2111 · **Fix-PR:** fix/2111-manager-profile-season-history · **Fejlklasse:** samme som 2026-06-10-standings-podium-column-never-existed.md + det tavse `|| []`-mønster fra #1851.

## Hvad skete der

`GET /api/managers/:teamId` (backend/routes/api.js) sorterede `season_standings` på `created_at` — men tabellen har kun `updated_at` (schema.sql). Postgres afviste queryen med `42703 column season_standings.created_at does not exist` ved HVER visning af en manager-profil, siden endpointet blev flyttet fra Edge Functions til api.js i `fa4799a3` (2026-04-18).

## Hvorfor det ikke blev opdaget i ~2,5 måned

1. **Tavs degradering:** svaret blev bygget med `historyRes.data || []` → 200 OK med `season_history: []`. Ingen 500, ingen Sentry-event, ingen bruger-synlig fejl — bare en tom sektion der lignede "holdet har ingen historik endnu".
2. **Fejlen var kun synlig i Supabase Postgres-logs** (Log Type=postgres, Level=error) — en flade ingen kiggede på rutinemæssigt.
3. Supabase-js kaster ikke; `{ data: null, error }` skal tjekkes eksplicit.

## Læring / forward-guards

- **ORDER BY/SELECT-kolonner er en kontrakt mod DB'en** — verificér mod skemaet (eller kør queryen mod ægte DB) når en query skrives ELLER flyttes/kopieres. Denne opstod ved en migrering af kode, ikke ved nyskrivning.
- **`|| []` uden `error`-tjek konverterer DB-fejl til "tom liste".** Minimum: log/capture `res.error` før fallback. (Scope-beslutning: selve fixet her er én linje; systematisk error-tjek på tværs af api.js er sin egen opgave.)
- **Supabase Postgres error-logs er et blindt punkt.** 42703 mod prod burde alarmere — kandidat: periodisk log-probe eller Logflare-alert på severity=ERROR.

## Backwards-check (2026-07-02)

Grep på `season_standings` + `order("created_at")`: kun api.js:8327 ramt. De øvrige call-sites (api.js:8577, TeamProfilePage.jsx:87) sorterer korrekt på `updated_at`. Prod-skema verificeret via execute_sql: kolonnelisten indeholder `updated_at`, ingen `created_at`; den fixede query kørt mod prod returnerer rækker.

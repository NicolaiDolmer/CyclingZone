# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-01 Salary GENERATED column (v2.25) + S-01.1 Auto-migrate workflow.** Kode + tests + docs leveret. Auto-migrate workflow (`.github/workflows/auto-migrate.yml`) kører S-01-migrationen automatisk ved næste push — eliminerer manuelt "kopier SQL"-step. Setup: `docs/AUTO_MIGRATION_SETUP.md` (1× `SUPABASE_DB_URL` GitHub secret).

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. **Launch-dato: åben** (kvalitet > deadline besluttet 2026-05-04).

## Senest leveret
- 2026-05-04: **S-01 Salary GENERATED column (v2.25)** + **S-01.1 Auto-migrate workflow** — `riders.salary` Postgres-beregnet, 5 write-paths fjernet, GitHub Action kører fremtidige migrations automatisk via `psql` + `schema_migrations`-tabel
- 2026-05-04: **Roadmap & docs-leverance** — `LAUNCH_ROADMAP.md`, `PUBLIC_ROADMAP.md`, 6 slice-briefs, `AI_LOOPS.md`, opdateret `AGENTS.md`, postmortem-skabelon
- 2026-05-04: **Lint-baseline ryddet (v2.24.1)** + **S8.5 Import-feedback UI (v2.24)** + **v2.23.1 polish** + **S9b Sæson-snapshot (v2.23)** + **S9a Løb-hub (v2.22)**
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. Verificér auto-migrate workflow + smoke-test S-01 i prod (auktion/transfer)
2. **S-04 Admin-cancel + S-06 Webhook-smoke** (korte P0'er, ryd småt) — se `docs/LAUNCH_ROADMAP.md`

## Kritiske invarianter
- **Verificér runtime FØR claim** (etableret 2026-05-04) — grep koden før du listet noget som TODO/bug
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76 + v2.25: `SALARY_RATE = 0.10` (nu i DB-formel), sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- **`riders.salary` er GENERATED** — kan IKKE skrives fra application-kode efter v2.25-deploy; DB beregner fra `uci_points` + `prize_earnings_bonus`
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits: D1 20-30, D2 14-20, D3 8-10 — håndhæves S-03
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

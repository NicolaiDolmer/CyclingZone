# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-01 Salary GENERATED column (v2.25) — kode klar, migration afventer deploy.** Lokal kode + tests + schema færdige; migration `database/2026-05-04-salary-generated-column.sql` skal køres mod live Supabase via MCP samtidig med Vercel-deploy af branch `claude/elastic-solomon-d23189`. Se `docs/RUNBOOK_S01_DEPLOY.md`.

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. **Launch-dato: åben** (kvalitet > deadline besluttet 2026-05-04).

## Senest leveret
- 2026-05-04: **S-01 Salary GENERATED column (v2.25)** — `riders.salary` bliver Postgres-beregnet, eliminerer 10/15-konflikt permanent. 5 write-paths fjernet, `calculateMarketSalary`/`calculateAuctionSalary` slettet, 103 backend-tests grønne. Migration deployer med PR-merge.
- 2026-05-04: **Roadmap & docs-leverance** — `LAUNCH_ROADMAP.md`, `PUBLIC_ROADMAP.md`, 6 slice-briefs, `AI_LOOPS.md`, opdateret `AGENTS.md`, postmortem-skabelon
- 2026-05-04: **Lint-baseline ryddet (v2.24.1)** + **S8.5 Import-feedback UI (v2.24)** + **v2.23.1 polish** + **S9b Sæson-snapshot (v2.23)** + **S9a Løb-hub (v2.22)**
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Deploy S-01:** Følg `docs/RUNBOOK_S01_DEPLOY.md` — merge til main, push, kør migration via MCP, kør stikprøve-query, smoke-test auktion
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

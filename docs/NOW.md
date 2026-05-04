# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S-04 Admin-cancel auktion (v2.26) leveret.** S-01 prod-smoke verificeret: 8699/8699 ryttere matcher 10%-formel, GENERATED column live. Auto-migrate workflow blokeret af manglende `SUPABASE_DB_URL` GitHub secret — bruger skal tilføje (se `docs/AUTO_MIGRATION_SETUP.md`); S-04-migrationen blev kørt manuelt via Supabase MCP.

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. **Launch-dato: åben** (kvalitet > deadline besluttet 2026-05-04).

## Senest leveret
- 2026-05-04: **S-04 Admin-cancel auktion (v2.26)** — `auctionCancellation.js` (atomar status-transition, 5 unit tests), endpoint `POST /admin/auctions/:id/cancel` + `GET /admin/auctions/active`, ny `Aktive auktioner`-sektion i AdminPage, `auction_cancelled` notification type
- 2026-05-04: **S-01 prod-smoke ✅** — `riders.salary` GENERATED ALWAYS verificeret, 8699/8699 ryttere matcher 10%-formel
- 2026-05-04: **S-01 Salary GENERATED column (v2.25)** + **S-01.1 Auto-migrate workflow** — `riders.salary` Postgres-beregnet, 5 write-paths fjernet
- 2026-05-04: **Roadmap & docs-leverance** + **Lint-baseline ryddet (v2.24.1)** + **S8.5 Import-feedback UI (v2.24)** + **S9a/S9b Løb-hub + Sæson-snapshot**
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Bruger:** tilføj `SUPABASE_DB_URL` GitHub secret så auto-migrate workflow ikke længere fejler ved push
2. **S-06 Webhook-smoke** (kort P0) — se `docs/LAUNCH_ROADMAP.md`
3. Derefter S-03 Trupstørrelse-håndhævelse

## Kritiske invarianter
- **Verificér runtime FØR claim** (etableret 2026-05-04) — grep koden før du listet noget som TODO/bug
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76 + v2.25: `SALARY_RATE = 0.10` (nu i DB-formel), sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- **`riders.salary` er GENERATED** — kan IKKE skrives fra application-kode efter v2.25-deploy; DB beregner fra `uci_points` + `prize_earnings_bonus`
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits: D1 20-30, D2 14-20, D3 8-10 — håndhæves S-03
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

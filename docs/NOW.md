# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S9b Sæson-snapshot leveret + pushet (v2.23, a612069).** `/seasons/:seasonId` deelbar URL der samler kalender + slutstilling + 4 vinder-kort (præmie-leader, største transfer, mest aktive, stage-king) på ét skærmbillede. SeasonEndPage refaktoreret (genbrug, ikke ny side). Sidebar `Sæson-snapshot`, Bibliotek-tab Sæson-celle nu klikbar. Pending: browser-smoke per soak-gate.

## Soak-gate
**Aktiv: ja** — S9a (v2.22) + S9b (v2.23) er user-facing. Næste session: smoke `/seasons/{id}` direkte URL, sidebar `Sæson-snapshot`, Bibliotek-tab Sæson-cell-klik, dropdown ↔ URL-sync, `/season-end` redirect, vinder-kort på live data, kalender kronologi. S9a-detaljer i FEATURE_STATUS § Løb-hub. **S9a kode-smoke kvitteret:** alle 5 tabs + redirects + back-link + sidebar IA OK statisk; browser-smoke pending.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-04: **S9b Sæson-snapshot** (v2.23) — `/seasons/:seasonId` udvidet SeasonEndPage. Kalender-sektion + 4 vinder-kort (💰 præmie · 💸 transfer · 🔄 aktivitet · 🚴 stage). Sidebar `Sæson-snapshot`, `/season-end` redirect, Bibliotek-tab Sæson-celle klikbar. Ingen ny backend. Lint 0/41, build 10.74s, tests 104/104.
- 2026-05-04: **S9a Løb-hub konsolidering** (v2.22) — `/races` udvidet med Bibliotek + Point & præmier-tabs. Filtre, useMemo, URL-sync. `/race-archive` redirect, sidebar renset.
- Ældre v2.21 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md` + FEATURE_STATUS

## Næste session — prioriteter
1. Browser-smoke S9a + S9b kombineret (soak-gate kvittering — punkter listet ovenfor)
2. S8.5: import-feedback UI (preview-tilstand til `POST /api/admin/import-results-sheets`)
3. S10: Admin økonomi-panel

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

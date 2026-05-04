# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Soak-gate S9 lukket + v2.23.1 polish-fix shipped.** Browser-smoke 10/10 punkter (8 PASS, 2 PARTIAL pga. data-state). 0 P0/P1. P2-B (tomme vinder-kort hover-bug) fixet i samme session — `disabled` + `cursor-default` på empty cards. Resterende 3 P2'er → S9-polish-slice. Rapport: `docs/archive/SMOKE_S9_2026-05-04.md`.

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04. S9a + S9b verificeret. P2-A (filter URL-sync), P2-C (deadline-day dedup), P2-D (race-slug encoding) deferred til polish-slice.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-04: **v2.23.1 polish + Soak-gate S9 rapport** — tomme vinder-kort `/seasons/:id` ikke-klikbare. 10/10 punkter, 4 P2 identificeret, ship OK. Lint 0/41, build 9.87s.
- 2026-05-04: **S9b Sæson-snapshot** (v2.23) — `/seasons/:seasonId` udvidet SeasonEndPage med kalender + 4 vinder-kort. Sidebar `Sæson-snapshot`, `/season-end` redirect.
- 2026-05-04: **S9a Løb-hub konsolidering** (v2.22) — `/races` udvidet med Bibliotek + Point & præmier-tabs.
- Ældre v2.21 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md` + FEATURE_STATUS

## Næste session — prioriteter
1. S8.5: import-feedback UI (preview-tilstand til `POST /api/admin/import-results-sheets`)
2. S10: Admin økonomi-panel
3. S9-polish-slice (samlet): filter URL-sync på Bibliotek (P2-A), deadline-day dedup (P2-C), race-slug kebab-case (P2-D)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

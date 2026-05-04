# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Session lukket 2026-05-04.** Leveret: S-03 Trupstørrelse-håndhævelse (v2.29). Cron auto-køber/-sælger ryttere ved vinduesluk så D1 20-30, D2 14-20, D3 8-10 håndhæves; 100K bøde + 200p fradrag pr. afvigende rytter.

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. **P0-status: 3/6 leveret (S-03, S-04, S-06).** Launch-dato: åben.

## Senest leveret
- 2026-05-04: **S-03 Trupstørrelse-håndhævelse (v2.29)** — `backend/lib/squadEnforcement.js` + cron-trigger; `enforceTeamSquadCompliance` auto-køber cheapeste rytter ved under_min (nødlån-fallback) og auto-sælger senest-erhvervede ved over_max. `riders.acquired_at` migration + 6 write-path-opdateringer. `updateStandings` ranking bruger `effective = total − penalty`. Rangliste viser `total (−penalty)`-notation. 7/7 unit tests grønne; backend total 115/115. Migration: `database/2026-05-04-squad-enforcement.sql`
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-04_part2.md` + `NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Manuel smoke-verifikation S-03** — admin lukker test-vindue på beta og verificér at hold under/over limit auto-justeres + bøde/fradrag bogføres korrekt
2. **Næste P0-slice** (3/6 P0 leveret; resterende i `docs/PRODUCT_BACKLOG.md` / `docs/LAUNCH_ROADMAP.md`)

## Kritiske invarianter
- **Verificér runtime FØR claim** (etableret 2026-05-04) — grep koden før du listet noget som TODO/bug
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `/profile` → `ProfilePage` — `ManagerProfilePage` er read-only view
- Economy v1.76 + v2.25: `SALARY_RATE = 0.10` i DB-formel, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- **`riders.salary` er GENERATED** — kan IKKE skrives fra app-kode efter v2.25; DB beregner fra `uci_points` + `prize_earnings_bonus`
- **UCI-sync må aldrig nulle high-value ryttere** — popularity ≥ 70 OR uci_points ≥ 100 auto-protected; token-set + æ/ø/å-norm i scraper + sheetsSync skal forblive byte-equivalent
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- **Squad limits håndhæves automatisk (S-03 v2.29)** — `processSquadEnforcementCron` claimer `transfer_windows.squad_enforcement_completed_at` atomisk. `riders.acquired_at` SKAL opdateres i ALLE write-paths der ændrer `team_id`. `season_standings.penalty_points` preserves på tværs af `updateStandings`-recompute fordi den ikke er i upsert-rows; ranking bruger `total - penalty`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

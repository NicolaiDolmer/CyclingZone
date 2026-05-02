# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S7 — Launch readiness** (open beta go-live). Deadline Day-rækken (S1–S4) er færdig.

## Gate-checks S7
| # | Check | Status |
|---|---|---|
| 1 | Beta reset koordineret med alle 17 managers | ✅ |
| 2 | Smoke-test: login, auktion, transfer, finance, bestyrelse | ✅ AR |
| 3 | Help + PatchNotes afspejler S2–S6 | ✅ |
| 4 | Deploy verify (`pwsh -File scripts/verify-deploy.ps1`) | ✅ |
| 5 | salary-sync + dyn_cyclist sync; spot-check 10 ryttere mod Sheet | 🔒 7/5 |
| 6 | Board end-to-end — budget_modifier opdateres ved season-end | ✅ |
| 7 | Notifikation smoke-test — outbid, offer_received, board_update | ✅ AR |

## Senest leveret
- v2.03 (2026-05-02): Deadline Day S4 — T-24h/T-2h/T-30min cron + Final Whistle Discord-rapport
- v2.02 (2026-05-02): Deadline Day S3 — Flash Auktion + hastebudsignal

## Næste session — prioriteter
1. Gate #5 (🔒 7/5): salary-sync + spot-check 10 ryttere
2. Start ny sæson → open beta live

## Kritiske invarianter
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `processSeasonEnd` loader teams/riders/board_profiles separat og fejler hårdt på errors
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: **maks 30 linjer** — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

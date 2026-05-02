# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S7 — Launch readiness** (open beta go-live)

## Gate-checks S7

| # | Check | Status |
|---|---|---|
| 1 | Beta reset koordineret med alle 17 managers | ⬜ |
| 2 | Smoke-test: login, auktion, transfer, finance, bestyrelse | ✅ AR |
| 3 | Help + PatchNotes afspejler alle S2–S6 ændringer | ✅ |
| 4 | Deploy verify (`pwsh -File scripts/verify-deploy.ps1`) | ✅ |
| 5 | S7-A: Kør salary-sync + dyn_cyclist sync; spot-check 10 ryttere mod Sheet | 🔒 7/5 |
| 6 | S7-B: Board end-to-end test — budget_modifier opdateres ved season-end? | ✅ |
| 7 | S7-C: Notifikation smoke-test — `auction_outbid`, `transfer_offer_received`, `board_update` | ✅ AR |

## Senest leveret
- v2.00 (2026-05-02): S7.5 — `supabase.js` → `supabase.ts`, `createClient<Database>` koblet
- v1.99 (2026-05-02): Developer tooling — ESLint+Prettier (backend+frontend), Supabase TS types, verify-invariants, bugfix api.js:768
- v1.98 (2026-05-02): Præmieudbetaling adskilt fra import — admin kontrollerer via ny panel-sektion

## Næste session — prioriteter
1. Gate #1: Koordiner beta-reset med alle 17 managers
2. Gate #5 (🔒 7/5): Kør salary-sync + dyn_cyclist sync; spot-check 10 ryttere mod Sheet
3. Beta-reset → start ny sæson → open beta live

## Kritiske invarianter
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `processSeasonEnd` loader teams/riders/board_profiles separat og fejler hårdt på errors
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: **maks 30 linjer** — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

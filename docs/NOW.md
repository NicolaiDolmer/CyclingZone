# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S7 — Launch readiness** (open beta go-live)

S6 ✅ lukket (v1.78) — onboarding MVP, navn-wizard, velkomstmodal.

## Gate-checks S7

| # | Check | Status |
|---|---|---|
| 1 | Beta reset koordineret med alle 17 managers | ⬜ |
| 2 | Smoke-test: login, auktion, transfer, finance, bestyrelse | ⬜ |
| 3 | Help + PatchNotes afspejler alle S2–S6 ændringer | ✅ |
| 4 | Deploy verify (`pwsh -File scripts/verify-deploy.ps1`) | ✅ |

## Næste session (i morgen)
1. Admin → Beta-testværktøjer → **Fuld nulstilling** (koordinér med managers)
2. Klik smoke-test: login · auktion på fri rytter · send transfer-tilbud · finance-side · bestyrelse
3. Admin → start ny sæson hvis season-flow skal testes
4. Erklær open beta live

## Post-launch → `docs/PRODUCT_BACKLOG.md`

## Kritiske invarianter
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy: `DEFAULT_BETA_BALANCE = 800.000 CZ$`, sponsor = 240.000 CZ$/sæson (v1.46)
- Prize-money: `prize_money = race_points × 15.000`; type=`bonus` divisionsbonus ved sæsonslut
- Economy v1.76: `SALARY_RATE = 0.10`, default sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `processSeasonEnd` loader teams/riders/board_profiles separat og fejler hårdt på errors
- NOW.md: **maks 30 linjer** — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

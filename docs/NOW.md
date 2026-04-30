# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S4 — Prize-money backend** ✅ lukket (v1.75, commit 10ac130).

## Næste sessioner (pre-launch, ~1 uge til open beta)

| Prioritet | Slice | Type |
|---|---|---|
| **S5 — NÆSTE** | Prize-money frontend + economy baseline rerun + let tuning | `small_feature` |
| S6 | Onboarding MVP: first-login modal, navn-wizard, 3 tooltip-cards | `small_feature` |
| S7 | Launch readiness: beta reset, smoke, Help + PatchNotes final | `investigation` |

## Post-launch → `docs/PRODUCT_BACKLOG.md`

## Kritiske invarianter
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy: `DEFAULT_BETA_BALANCE = 800.000 CZ$`, sponsor = 240.000 CZ$/sæson (v1.46)
- Prize-money: `prize_money = race_points × 15.000`; type=`bonus` divisionsbonus ved sæsonslut
- `processSeasonEnd` loader teams/riders/board_profiles separat og fejler hårdt på errors
- NOW.md: **maks 30 linjer** — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S3 — Prize-money investigation** ✅ lukket (2026-04-30).

## Næste sessioner (pre-launch, ~1 uge til open beta)

| Prioritet | Slice | Type |
|---|---|---|
| **S4 — NÆSTE** | Prize-money backend: per-løb CZ$ + sæsonslut rangliste-/divisionsbonus | `small_feature` |
| S5 | Prize-money frontend + economy baseline rerun + let tuning | `small_feature` |
| S6 | Onboarding MVP: first-login modal, navn-wizard, 3 tooltip-cards | `small_feature` |
| S7 | Launch readiness: beta reset, smoke, Help + PatchNotes final | `investigation` |

## Post-launch → `docs/PRODUCT_BACKLOG.md`

## S3 — Besluttede præmie-tal (klar til S4)
- `points_earned` = `race_points[race_class][result_type_dk][rank]`
- `prize_money` = `points_earned × 15.000`
- result_type mapping: `stage`→`Etapeplacering`, `gc`→`Klassement`/`Klassiker` (stage_race/single), `points`→`Pointtroje`, `mountain`→`Bjergtroje`, `young`→`Ungdomstroje`, `team`→`EtapelobHold`/`KlassikerHold`, `leader`→`Forertroje`
- Divisionsbonus ved sæsonslut (type=`bonus`): D1: 300K/200K/100K/50K · D2: 150K/100K/50K/25K · D3: 75K/50K/25K (top 4/4/3)
- `prize_tables` + `DEFAULT_PRIZES` droppes
- Fallback: ingen `race_class` → `prize_money = 0`

## Kritiske invarianter
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy: `DEFAULT_BETA_BALANCE = 800.000 CZ$`, sponsor = 240.000 CZ$/sæson (v1.46)
- `processSeasonEnd` loader teams/riders/board_profiles separat og fejler hårdt på errors
- NOW.md: **maks 30 linjer** — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

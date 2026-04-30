# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S1 — Docs + token-infra cleanup** ✅ lukkes i denne session.

## Næste sessioner (pre-launch, ~1 uge til open beta)

| Prioritet | Slice | Type |
|---|---|---|
| **S2 — NÆSTE** | Profile/settings fix: `/profile` → `ProfilePage` med hold-/managernavn-edit | `bugfix` |
| S3 | Prize-money investigation: kortlæg `buildRacePrizeLookup`, design payout-skala | `investigation` |
| S4 | Prize-money backend: per-løb CZ$ + sæsonslut rangliste-/divisionsbonus | `small_feature` |
| S5 | Prize-money frontend + economy baseline rerun + let tuning | `small_feature` |
| S6 | Onboarding MVP: first-login modal, navn-wizard, 3 tooltip-cards | `small_feature` |
| S7 | Launch readiness: beta reset, smoke, Help + PatchNotes final | `investigation` |

## Post-launch → `docs/PRODUCT_BACKLOG.md`

## Kritiske invarianter
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Prize-money: per-løb CZ$ ≠ resultatpoint; skal i `finance_transactions` med gyldig type
- Economy: `DEFAULT_BETA_BALANCE = 800.000 CZ$`, sponsor = 240.000 CZ$/sæson (v1.46)
- `processSeasonEnd` loader teams/riders/board_profiles separat og fejler hårdt på errors
- NOW.md: **maks 30 linjer** — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

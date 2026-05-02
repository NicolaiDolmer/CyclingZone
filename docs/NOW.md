# NOW — Aktuel arbejdsstatus

## Aktiv slice
**S7 — Launch readiness** (open beta go-live)

## Gate-checks S7

| # | Check | Status |
|---|---|---|
| 1 | Beta reset koordineret med alle 17 managers | ⬜ |
| 2 | Smoke-test: login, auktion, transfer, finance, bestyrelse | ⬜ |
| 3 | Help + PatchNotes afspejler alle S2–S6 ændringer | ✅ |
| 4 | Deploy verify (`pwsh -File scripts/verify-deploy.ps1`) | ✅ |
| 5 | S7-A: Kør salary-sync + dyn_cyclist sync; spot-check 10 ryttere mod Sheet | ⬜ |
| 6 | S7-B: Board end-to-end test — budget_modifier opdateres ved season-end? | ✅ |
| 7 | S7-C: Notifikation smoke-test — `auction_outbid`, `transfer_offer_received`, `board_update` | ⬜ |

## Senest leveret
- v1.95 (2026-05-02): Fix: Præmieformlen rettet til 1 pt = 1.500 CZ$ (var fejlagtigt 15.000)
- v1.94 (2026-05-02): S9-C — Point- og præmieoversigt: /race-points side med UCI-pointtabel + præmieformlen, ny GET /api/race-points rute
- v1.88 (2026-05-01): Sæsonstatus-banner på dashboard — dage til sæsonslut, løbsdage-progress, transfervindue
- v1.87 (2026-05-01): Sticky tabeloverskrift på rytteroversigt og auktionsside
- v1.85 (2026-05-01): Fix auktions-sortering — rytterkolonner (navn, værdi, stats, potentiale) sorterede ikke
- v1.84 (2026-05-01): Fix dyn_cyclist sync — Supabase 1000-rækker limit + europæisk decimal → 7.616/8.699 ryttere har nu potentiale
- v1.83 (2026-05-01): Potentiale-stjerner på alle rytteroversigter — guld/sølv, halvstjerner, filter+sort
- v1.81 (2026-04-30): Nationalitetsflag på alle 8.699 ryttere

## Kritiske invarianter
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `processSeasonEnd` loader teams/riders/board_profiles separat og fejler hårdt på errors
- NOW.md: **maks 30 linjer** — flyt historik til `docs/archive/` i samme session som arbejdet lukkes

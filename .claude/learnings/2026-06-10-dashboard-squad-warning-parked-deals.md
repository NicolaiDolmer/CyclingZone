# Dashboard-trupadvarsel ignorerede parkerede deals (#1090)

**Dato:** 2026-06-10
**Issue:** #1090 — trupstørrelse-advarslen på dashboardet medregnede ikke ryttere på vej ind/ud til næste sæson.

## Symptom
Discord-feedback (@jeppek): advarslen "Squad too large/small" opdaterede sig ikke når
ryttere var på vej ind eller ud af holdet til den kommende sæson.

## Rod-årsag
Dashboardets tælle-queries divergerede fra den autoritative kapacitets-beregning
(`getTeamMarketState` i `backend/lib/marketUtils.js`, som AL auktions-/transfer-/
swap-/lån-validering bruger) på to punkter:

1. **Lån:** dashboardet talte kun `loan_agreements.status = "active"`. Backend
   tæller `["active", "window_pending"]` — en lejeaftale accepteret mens vinduet
   er lukket (rytter ankommer næste sæson) var dermed usynlig for advarslen.
2. **Pending-in:** `.neq("team_id", mig)` ekskluderer rækker med `team_id IS NULL`
   (SQL trevalent logik) — fx en fri agent vundet på auktion mens vinduet var
   lukket (`pending_team_id = mig`, `team_id = NULL`) blev ikke talt.

## Fix
- `frontend/src/lib/dashboardSquadStats.js`: ny `fetchSquadCountInputs(supabase, teamId)`
  med PRÆCIS samme diskriminatorer som backend (`INCOMING_LOAN_STATUSES =
  ["active", "window_pending"]`; `or(team_id.is.null,team_id.neq.X)`).
  `buyout_pending` bevidst udeladt (rytteren tælles via `pending_team_id`, jf. #19-audit).
- `DashboardPage.jsx` bruger helperen i stedet for inline-queries; `activeLoanCount`
  omdøbt til `incomingLoanCount` så navnet ikke lyver om window_pending.
- Regressionstests asserter de eksakte query-filtre via chainable supabase-stub.

## Læring (3. bid af samme mønster — jf. feedback_match_ui_filter_for_capacity_logic)
Tælle-/kapacitets-logik der skal FORUDSIGE en backend-håndhævelse skal genbruge
backendens diskriminator 1:1 — ikke en lokal genopfindelse. To fælder der bed her:
- `.neq(col, x)` i PostgREST/SQL dropper NULL-rækker stille; brug
  `or(col.is.null,col.neq.x)` når NULL semantisk betyder "ikke mig".
- Status-enums med parkerede varianter (`window_pending`, `buyout_pending`):
  tjek altid backendens statusliste i stedet for at antage "active" er nok.

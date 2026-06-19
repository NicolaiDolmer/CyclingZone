# Enum/CHECK-drift + reset-FK-audit (#1465)

Dato: 2026-06-19 · Read-only audit mod prod-skemaet (project `ghwvkxzhsbbltzfnuhhz`)
via Supabase MCP `execute_sql` (kun SELECT) + RPC `audit_foreign_keys()`.

Backwards-check efter PR #1463, der under relaunch-rehearsal afslørede to bug-klasser:
1. Kode-enum-værdi mangler i DB-CHECK (`'upkeep'` i `finance_transactions_type_check`).
2. Ny FK-tabel ikke håndteret i reset-stien (`academy_intake` → `seasons`).

Refs #1465 (+ #1464 enum/CHECK-companion-spor · #1463 · #1441 · #1308).

## Resultat (TL;DR)

- **Opgave A (CHECK-drift): 1 reel drift fundet** — `finance_transactions.type = 'forced_debt_sale'`
  skrives af koden, men mangler i `finance_transactions_type_check`. Samme klasse som
  `'upkeep'`-bug'en. Draft-migration `database/2026-06-19-finance-forced-debt-sale-type.sql`
  vedlagt (DRAFT — ejer applier).
- **Opgave B (uhåndteret reset-FK): 0 uhåndterede FK.** Alle FK-children til reset-delete-targets
  er enten håndteret i `betaResetService.js` (null-/delete-before-parent) eller auto-resolves via
  `ON DELETE CASCADE/SET NULL`. Reset DELETE'er kun fra `seasons` (+ market/økonomi/race/board-children),
  aldrig fra `teams`/`riders` (de UPDATE'es kun). CI-guarden `reset-fk-audit.yml` + `BLOCKING_FK_BASELINE`
  matcher prod-skemaet 1:1.

Native pg-enum-typer i `public`: **ingen** — alle enum-lignende kontrakter er CHECK-constraints.

## Opgave A — CHECK-constraint-drift

Metode: enumererede alle `contype='c'` CHECK-constraints i `public` (pg_constraint) og diffede
de tilladte værdilister mod de literaler koden faktisk skriver (grep af backend for
insert/update/RPC-payloads på de relevante kolonner).

### Drift-tabel

| Kolonne | CHECK tillader | Kode skriver | Status |
|---|---|---|---|
| `finance_transactions.type` | sponsor, prize, salary, transfer_in, transfer_out, interest, bonus, starting_budget, loan_received, loan_repayment, loan_interest, emergency_loan, admin_adjustment, auto_squad_purchase, auto_squad_sale, squad_violation_fine, academy_signing, academy_drift, upkeep | …alle ovenstående **+ `forced_debt_sale`** (`economyEngine.js:540`) | **DRIFT** — `forced_debt_sale` mangler i CHECK |
| `finance_transactions.actor_type` | cron, api, admin, system, migration | = `FINANCE_ACTOR_TYPE` (samme 5) | OK |
| `finance_transactions.related_entity_type` | auction, loan, transfer, swap, race, season, manual | = `FINANCE_RELATED_ENTITY` (samme 7) | OK |
| `loans.loan_type` | short, long, emergency | short / long / emergency (`loanEngine.js`) | OK |
| `loans.status` | active, paid_off | active / paid_off | OK |
| `notifications.type` | 35 værdier (bid_received … academy_graduated) | `notifyUser`-callsites: academy_*, board_update/board_critical, season_started/ended, salary_paid, sponsor_paid, loan_*, transfer_*, auction_*, watchlist_*, deadline_day_warning, squad_enforced, rider_retired m.fl. | OK — alle attribuerbare værdier findes i CHECK |
| `auctions.status` | active, extended, completed, cancelled | active/extended/completed/cancelled (+ reset → cancelled) | OK |
| `transfer_listings.status` | open, negotiating, sold, withdrawn | samme | OK |
| `transfer_offers.status` | pending, accepted, rejected, countered, awaiting_confirmation, withdrawn, window_pending | samme delmængde | OK |
| `swap_offers.status` | pending, countered, awaiting_confirmation, accepted, rejected, withdrawn, window_pending | samme delmængde | OK |
| `loan_agreements.status` | pending, active, window_pending, buyout_pending, completed, rejected, cancelled, buyout | samme delmængde (reset → cancelled) | OK |
| `races.status` | scheduled, active, completed | samme | OK |
| `pending_race_results.status` | pending, approved, rejected | samme | OK |
| `academy_intake.status` | offered, signed, rejected, expired | samme | OK |
| `academy_graduation.status` | pending, promoted, sold, released, expired | samme | OK |
| `seasons.status` | upcoming, active, completed | active/completed (relaunch seeder sæson 0 = active) | OK |
| `board_profiles.{focus,plan_type,negotiation_status}` | (se schema) | matcher engine-konstanter | OK |

### Fundet drift — detalje

**`finance_transactions.type = 'forced_debt_sale'`** (`backend/lib/economyEngine.js:537-552`)

`processTeamSeasonPayroll` B3-eskalering (#1441/#97 debt-ceiling) tvangssælger holdets dyreste
rytter når gælden har overskredet divisions-loftet i ≥2 på hinanden følgende sæsoner, og krediterer
markedsværdien via `creditTeam(..., "forced_debt_sale", ...)` → `increment_balance_with_audit`-RPC
→ INSERT i `finance_transactions`. Typen `'forced_debt_sale'` er IKKE i `finance_transactions_type_check`.

- Søster-stien `squadEnforcement.executeAutoSale` (`squadEnforcement.js:222`) bruger `'auto_squad_sale'`
  (som ER i CHECK'et). B3-stien har bevidst sin egen distinkte type — bekræftet af
  `docs/GAME_INVARIANTS.md` §Eskalerende gældhåndhævelse og af `economyEngine.test.js:3011-3013`,
  der asserter præcis én `forced_debt_sale`-row.
- **LATENT:** fyrer kun ved sæson-slut-payroll for et hold med ≥2-sæsoners loftbrud. Unit-testene
  kører mod en mock-supabase uden ægte CHECK → grønne, mens en RIGTIG prod-INSERT fejler med
  check_violation (23514) midt i payroll-cron'en → halv-kørt payroll-batch.
- **Fix (additiv):** tilføj `'forced_debt_sale'` til CHECK'et. Draft:
  `database/2026-06-19-finance-forced-debt-sale-type.sql` (DRAFT, idempotent, additiv — bryder
  ingen eksisterende række). **Ejeren applier** (migration auto-applies ved merge → ikke auto-merge).

## Opgave B — uhåndterede FK i reset/teardown-stierne

Metode: enumererede ALLE FK'er der peger på reset-targets `seasons`/`teams`/`riders`
(pg_constraint + confdeltype) og krydstjekkede mod den live RPC `audit_foreign_keys()` (1:1-match).
Sammenholdt med `RESET_DELETE_TARGETS` + delete/update-kaldene i `betaResetService.js` og
relaunch-sekvensen i `relaunchOrchestrator.js`.

**Nøgleobservation:** reset/relaunch DELETE'er kun rækker fra `seasons` (+ market/økonomi/race/board-
children der selv er targets). `teams` og `riders` bliver **kun UPDATE'et** (roster-flyt,
balance/division-reset, `retireLegacyRiders` sætter `is_retired=true,team_id=null`) — aldrig slettet.
Derfor kan kun FK'er der peger på `seasons` (eller på de øvrige delete-targets `loans`/`races`)
blokere en reset. FK'er på `teams`/`riders` er ikke en blocker-klasse i denne reset-arkitektur.

### FK-children → `seasons` (eneste reset-DELETE'ede target blandt de tre)

| Child.kolonne | ON DELETE | Håndtering | Status |
|---|---|---|---|
| `academy_graduation.season_id` (NOT NULL) | NO ACTION | `resetBetaSeasons`: delete academy_graduation før seasons | OK (baselined) |
| `academy_intake.season_id` (NOT NULL) | NO ACTION | `resetBetaSeasons`: delete academy_intake før seasons | OK (baselined) |
| `board_plan_snapshots.season_id` (NOT NULL) | NO ACTION | `resetBetaSeasons`: delete board_plan_snapshots før seasons | OK (baselined) |
| `board_profiles.season_id` (nullable) | NO ACTION | `resetBetaSeasons`: null før delete | OK (baselined) |
| `board_profiles.season_start_anchor_season_id` (nullable) | NO ACTION | `resetBetaSeasons`: null før delete | OK (baselined) |
| `finance_transactions.season_id` (nullable) | NO ACTION | `resetBetaSeasons`: null før delete | OK (baselined) |
| `board_profiles.tradeoff_active_until_season_id` | SET NULL | auto | OK |
| `board_consequences.expires_at_season_id` | SET NULL | auto | OK |
| `board_request_log.season_id` | SET NULL | auto | OK |
| `hall_of_fame.season_id` | SET NULL | auto | OK |
| `races.season_id` | CASCADE | auto (races slettes desuden eksplicit) | OK |
| `board_satisfaction_events.season_id` | CASCADE | auto | OK |
| `rider_development_log.season_id` | CASCADE | auto | OK |
| `scout_actions.season_id` | CASCADE | auto | OK |
| `season_standings.season_id` | CASCADE | auto (slettes desuden eksplicit) | OK |
| `training_plans.season_id` | CASCADE | auto | OK |
| `transfer_windows.season_id` | CASCADE | auto | OK |

### Blocking-FK på øvrige delete-targets (`loans`, `races`)

| Child.kolonne | Parent | ON DELETE | Håndtering | Status |
|---|---|---|---|---|
| `finance_transactions.related_loan_id` | loans | NO ACTION | `resetBetaLoans`: null før delete | OK (baselined) |
| `finance_transactions.race_id` | races | NO ACTION | `resetBetaRaceCalendar`: null før delete | OK (baselined) |

**Ingen uhåndterede blocking-FK.** De 6 NO ACTION-FK'er → `seasons` + de 2 → `loans`/`races`
matcher præcist `BLOCKING_FK_BASELINE` (8 entries) i `betaResetService.js`, og CI-guarden
`reset-fk-audit.yml` adjudicerer dette live mod prod ved hver PR/cron.

> Note: `board_profiles.tradeoff_active_until_season_id` er bevidst UDELADT af baseline (SET NULL i
> prod, men NO ACTION i de statiske dumps) — kommenteret i `betaResetService.js`. Live-auditen er
> autoritativ; bekræftet SET NULL i denne audit.

## Anbefalinger

1. **Apply draft-migrationen** `database/2026-06-19-finance-forced-debt-sale-type.sql` (ejer-kørt)
   FØR næste prod-relaunch eller før et hold rammer ≥2-sæsoners gældsloft-brud. Same-klasse som
   `upkeep`-bug'en — ville crashe payroll-cron'en, ikke kun relaunch.
2. **Forward-guard for CHECK-drift (#1464):** Opgave B har en live CI-guard (`reset-fk-audit.yml`).
   Den symmetriske enum/CHECK-companion mangler stadig. Foreslå en analog guard der enumererer
   `finance_transactions.type` (+ evt. `notifications.type`, statusfelter) fra prod-CHECK'et og
   differ mod en checked-in liste af kode-skrevne værdier — så `forced_debt_sale`-klassen fanges ved
   PR-tid frem for ved cron/relaunch. Dette er #1464's kerne-leverance.
3. **Test-troværdighed:** `economyEngine.test.js`-mock'en håndhæver ikke CHECK-constraints, så den
   grønne test gav falsk tryghed. Overvej at lade mock-insert validere mod den checked-in type-liste
   (genbrug guarden fra anbefaling 2).

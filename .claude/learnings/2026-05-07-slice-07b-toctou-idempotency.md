# 2026-05-07 — Slice 07b: TOCTOU + idempotency-keys på cron-payouts

## Bug

Fire cron-payouts (sponsor sæson-start, salary/bonus sæson-end, loan-interest sæson-end) havde ingen DB-håndhævet uniqueness. App-niveau "alreadyPaid"-checks (kun i `payDivisionBonuses`) er TOCTOU-følsomme: 2 cron-runs kan begge bestå tjekket og INSERT'e duplicate `finance_transactions`. `processLoanInterest` havde slet ingen idempotency. Tilsvarende for `createLoan` debt-ceiling: SELECT-then-INSERT-pattern kunne lade 2 parallelle requests samle gæld over loftet (manager fandt mønstret 2026-05-06 og pressede sin gæld 54 CZ$ over D3-loftet via stack af små lån — fixed app-niveau i v2.48, men race-vinduet bestod).

`createEmergencyLoan` havde slet ingen ceiling-tjek, så et nødlån kunne presse en konkurs-tæt manager vilkårligt over loftet uden advarsel.

## Root cause

Bug-mønster identisk med 2026-05-06 auction-double-create racen ([2026-05-06-auctions-unique-active-rider.sql](../../database/2026-05-06-auctions-unique-active-rider.sql)): "tjek så indsæt" uden DB-håndhævet uniqueness. App-niveau guards giver T-of-check men ikke T-of-use atomicitet.

## Fix

Migration [database/2026-05-07-economy-idempotency.sql](../../database/2026-05-07-economy-idempotency.sql):
- 4 partial UNIQUE indices på `finance_transactions` (sponsor/salary/bonus per team+season + loan_interest per loan+season)
- Ny `related_loan_id`-kolonne så lånerenter er sporbare per individuelt lån
- `create_loan_atomic` Postgres-RPC med `pg_advisory_xact_lock(hashtextextended(team_id::text, 0))` der serialiserer concurrent createLoan-calls på team-niveau

Backend ([economyEngine.js](../../backend/lib/economyEngine.js), [loanEngine.js](../../backend/lib/loanEngine.js)):
- `creditTeam`/`debitTeam` opt-in `{idempotent: true}` flag — INSERT-først, fang 23505, skip uden balance-mutation
- `processLoanInterest` sender `related_loan_id` i finance row + fanger 23505
- `createEmergencyLoan` SOFT debt_ceiling-tjek (lånet oprettes uanset, men manager får `emergency_loan_breach`-notifikation per beslutning 2026-05-07)
- `createLoan` bruger `create_loan_atomic` RPC når tilgængelig, falder tilbage til app-niveau check (graceful degradation)

## Læring

**1. Skriv tests FØR fix når racer påstås.** Issue #80 påstod 3 race-conditions. Jeg skrev 7 tests i [economyInvariants.test.js](../../backend/lib/economyInvariants.test.js) først; 5 fejlede mod uændret kode → racerne var reelle. Hvis testene havde passet uden fix, var scope reframed. Udgift: 1 ekstra test-fil. Værdi: bevist regression-protection + ingen risiko for at "fixe" et ikke-bug.

**2. DB-niveau er sandheden, ikke app-laget.** App-niveau "alreadyPaid"-tjek (eksisterende i `payDivisionBonuses`) løste retry-tilfælde men ikke parallelle race-windows. Partial UNIQUE indices flytter invariant-håndhævelsen til DB hvor den ikke kan omgås. Backend fanger 23505 og skipper — det er backstop, ikke primær defense.

**3. Sammenfald mellem balance-mutation og finance-insert er en lurking risk.** I `creditTeam.idempotent`-grenen flippes rækkefølgen: INSERT først, så balance-update. Hvis insert fejler 23505, mutates balance ikke (forrige cron har allerede gjort begge dele). Edge case ved server-crash mellem insert og balance-update — accepteret for 07b, løses fuldt af 07c's `increment_balance_with_audit` RPC.

**4. Migration-precheck mod prod er ikke valgfri.** UNIQUE-index oprettelse fejler hvis dubletter findes. Jeg fandt 1 historisk dublet i prod via `execute_sql` før `apply_migration` — en sponsor-kompensering fra v2.49. Reklassificeret til `admin_adjustment` (afvist fra `sponsor_correction` af eksisterende CHECK constraint — schema-kendskab undgik et 2nd-attempt). Pre-flight er billigere end rollback.

**5. End-to-end execution når værktøjerne findes.** Initial close-out producerede en opgave-comment med 4 manuelle steps til brugeren (ryd dublet, apply migration, merge PR, verificér). Brugeren afviste tilgangen: "den bedste AI-udvikler ville udføre". Memory opdateret ([feedback_execute_end_to_end.md](../../C:/Users/ndmh3/.claude/projects/C--dev-CyclingZone/memory/feedback_execute_end_to_end.md)). Hele kæden udført i samme session: dublet ryddet via execute_sql, migration via apply_migration, PR merged via gh CLI, smoke-test af `create_loan_atomic` live (ceiling=0 → check_violation, 0 rows inserted).

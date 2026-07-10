# repayLoan var ikke-atomisk og ulåst (#2302)

**Root cause:** `repayLoan` (backend/lib/loanEngine.js) opdaterede
`loans.amount_remaining`/`status` FØRST, og debiterede `teams.balance` i et
separat `increment_balance_with_audit`-RPC-kald bagefter. To problemer:

1. Fejlede debiteringen efter loan-opdateringen, var gælden allerede slettet
   uden matchende betaling (penge skabt).
2. Read-modify-write uden lås: to samtidige repayments på samme lån kunne
   begge læse samme `amount_remaining` og begge passere balance-checks
   (last-writer-wins).

Fundet i finance-audit 10/7, samme mønsterklasse som allerede løst for
`createLoan`/`createEmergencyLoan` via `create_loan_atomic`/
`create_emergency_loan_atomic` (Slice 07b) og for generel balance-mutation
via `increment_balance_with_audit` (Slice 07c) — repay-stien var den sidste
2-trins-mutation tilbage i loanEngine.js.

**Fix:** Ny `repay_loan_atomic`-RPC (database/2026-07-10-repay-loan-atomic.sql)
samler `pg_advisory_xact_lock(team_id)` + `SELECT ... FOR UPDATE` på
loan-rækken + balance-validering + `teams.balance`-debit + `finance_transactions`-
ledger-insert + `loans`-opdatering i ÉN transaktion. `repayLoan` i JS blev et
tyndt kald med samme fejl-kontrakt (message/errorCode) bevaret for API'et.

**Læring:** Når et system har flere RPC'er der løser samme klasse problem
(atomic balance mutation), tjek at ALLE callsites af det gamle 2-trins-mønster
er migreret — ikke kun de mest oplagte. `repayLoan` blev overset i både 07b
og 07c fordi den "kun" opdaterer et loan, ikke opretter et.

-- Lånerente: synlig accrued_interest i stedet for dobbelttalt cash-post (#2304)
--
-- Finance-audit 10/7 fund: processLoanInterest() (backend/lib/loanEngine.js)
-- kapitaliserer renten ind i loans.amount_remaining OG skriver samtidig en
-- negativ finance_transactions-post ("kontant-lignende") uden at teams.balance
-- rent faktisk debiteres. Konsekvens:
--   1. Sæsonrapportens hero-net (seasonFinanceReport.js) matchede ikke den
--      faktiske balanceændring (renten var ikke et cash-flow, kun en
--      gæld-forøgelse).
--   2. Renten blev reelt talt to gange over lånets levetid: én gang som
--      rente-transaktionen her, én gang inde i den efterfølgende
--      loan_repayment-debitering (som betaler hovedstol + kapitaliseret rente).
--
-- Ejer-besluttet design (10/7): processLoanInterest skriver IKKE længere en
-- ledger-post ved kapitalisering. I stedet akkumuleres renten synligt på selve
-- lånet via denne nye kolonne, som UI kan vise direkte ("påløbet rente: X CZ$").
--
-- accrued_interest er en LIVSTIDS-løbende sum af al rente nogensinde
-- kapitaliseret på lånet — den reduceres IKKE af repayLoan()-betalinger i
-- denne migration (repayment-split hovedstol/rente er bevidst UD AF SCOPE
-- her, se PR-body: repay_loan_atomic-RPC'en er under aktiv ændring i #2324,
-- og at røre repayLoan()/repay_loan_atomic i samme PR ville skabe en
-- merge-konflikt med det arbejde). accrued_interest er derfor et
-- gennemsigtigheds-tal ("hvor meget rente er der lagt oveni dette lån"),
-- ikke et "udestående, ikke-betalt rente"-tal — det bliver korrekt
-- pro-rata/interest-first split ved repayment et opfølgende issue.
--
-- last_interest_season_id erstatter den gamle idempotency-mekanisme
-- (unique index på finance_transactions.related_loan_id+season_id, kun
-- relevant når vi rent faktisk INSERTede en rente-row). Uden INSERT er der
-- intet unique index at læne sig op ad — i stedet gør vi selve UPDATE'en af
-- loans-rowet betinget (WHERE last_interest_season_id IS DISTINCT FROM
-- p_season_id), så en dobbelt cron-kørsel for samme sæson er et no-op.
--
-- Historiske loan_interest-finance_transactions-rows fra FØR denne migration
-- bevares uændret (ingen backfill/sletning) — de ekskluderes i stedet fra
-- sæsonrapportens cash-net i JS-laget (seasonFinanceReport.js), se PR #2304.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
--
-- Rollback:
--   ALTER TABLE loans DROP COLUMN IF EXISTS accrued_interest;
--   ALTER TABLE loans DROP COLUMN IF EXISTS last_interest_season_id;

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS accrued_interest BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_interest_season_id UUID REFERENCES seasons(id);

COMMENT ON COLUMN loans.accrued_interest IS
  'Livstids-sum af al rente kapitaliseret på lånet (#2304). Ikke-kontant — vises i UI som "påløbet rente". Reduceres IKKE af repayment i denne slice (repayment-split er separat opfølgning).';
COMMENT ON COLUMN loans.last_interest_season_id IS
  'Seneste sæson hvor rente blev tilskrevet dette lån — idempotency-guard for processLoanInterest (erstatter finance_transactions-unique-index efter #2304 fjernede rente-ledger-posten).';

# Lånerente: kontant-lignende ledger-post uden balance-debitering (#2304)

**Root cause:** `processLoanInterest` (backend/lib/loanEngine.js) kapitaliserede
renten ind i `loans.amount_remaining` OG skrev samtidig en negativ
`finance_transactions`-post (`type: "loan_interest"`), uden nogensinde at
debitere `teams.balance`. To konsekvenser:
1. Sæsonrapportens hero-net (`seasonFinanceReport.js`) medregnede posten som
   et cash-udlæg, selvom ingen penge forlod kontoen — nettet matchede ikke
   den faktiske balanceændring.
2. Renten blev reelt talt to gange over lånets levetid: én gang som
   `loan_interest`-posten ved kapitalisering, én gang implicit inde i den
   efterfølgende `loan_repayment`-debitering (som betaler hovedstol +
   kapitaliseret rente).

**Fix:** `processLoanInterest` skriver IKKE længere en ledger-post. Renten
akkumuleres i stedet synligt i en ny `loans.accrued_interest`-kolonne
(migration `database/2026-07-10-loans-accrued-interest.sql`), eksponeret i UI
(FinancePage lånekort + gældskort, SeasonFinanceReportPanel lån-tabel).
Idempotency (mod dobbelt cron-kørsel for samme sæson) flyttede fra et unique
index på `finance_transactions` til en betinget UPDATE på
`loans.last_interest_season_id`. `seasonFinanceReport.js` ekskluderer
historiske/legacy `loan_interest`-transaktioner fra hero-nettet og eksponerer
summen separat som `hero.non_cash_loan_interest`.

**Bevidst UD AF SCOPE i denne PR:** repayment-split (hovedstol vs. betalt
rente, "interest-first") ved selve `repayLoan()`/`repay_loan_atomic`-RPC'en.
PR #2324 (tvangssalgs-afdrag) rører præcis de samme kodestier samtidig —
at ændre `repayLoan`/RPC'en her ville skabe en direkte merge-konflikt.
`accrued_interest` er derfor et livstids-transparens-tal ("hvor meget rente
er lagt oveni"), ikke et "udestående rente, endnu ikke betalt"-tal — det
kræver en opfølgende issue efter #2324 er landet.

**Læring:** når en kapitaliserings-mutation (gæld-forøgelse uden
kontant-bevægelse) skriver til samme ledger som faktiske cash-transaktioner,
skal `type`/`reason_code` gøre det eksplicit hvilke rows der er kontant vs.
ikke-kontant — ellers er det for let for en efterfølgende rapport-aggregering
(hero-net) at antage "alt i finance_transactions er cashflow".

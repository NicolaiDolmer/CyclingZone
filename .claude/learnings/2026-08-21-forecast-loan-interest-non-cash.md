# Forecast talte kapitaliseret lånerente som cash to steder (#4023)

**Root cause:** `.claude/learnings/2026-07-10-loan-interest-double-count.md`
fastslog allerede at `processLoanInterest` (loanEngine.js) kapitaliserer
lånerente ind i `loans.amount_remaining`/`accrued_interest` og ALDRIG
debiterer `teams.balance`. Den fix rettede sæsonrapportens hero-net
(`seasonFinanceReport.js`), men to andre steder der senere blev bygget
ovenpå samme antagelse ("alt i et cashflow-tal er cash") arvede den
samme fejl uden at nogen genbesøgte den oprindelige læring:

1. `backend/lib/financeForecast.js` — `projected_net` inkluderede
   `projectedLoanInterest` som et almindeligt negativt bidrag, side om
   side med løn/upkeep/facilitets-udgifter der RENT FAKTISK debiterer
   balancen.
2. `backend/lib/seasonSwitchPreview.js` — `buildSettlementSteps`s
   trin-for-trin-gennemgang af sæsonskiftet lod `loan_interest`-trinnet
   trække fra den løbende saldo på samme måde som løn/upkeep-trinene.

Begge steder viste et lavere (mere pessimistisk) tal end holdets faktiske
balanceændring ved sæsonskiftet — og modsagde UI-copy andre steder i appen
der allerede korrekt kaldte kapitaliseret rente "non-cash".

**Fix:** Lånerenten forbliver en synlig linje begge steder (transparens —
manageren skal kunne se at gælden vokser), men indgår IKKE i
`projected_net` og flytter IKKE `running`-saldoen i settlement-gennemgangen.
`seasonSwitchPreview.js`s step får et `cash: false`-felt så UI'et/testene
kan skelne den fra rigtige charges. Copy i `FinanceForecastCard.jsx`,
`finance.json`s `seasonSwitch.receipt.step.loan_interest.detail`, og
`help.json`s `forecastCalculation`/`seasonSwitchSettlement`-FAQ'er er
opdateret til at sige det samme (non-cash, lægges oveni gælden) alle tre
steder — det var netop URELATERET copy der drev opdagelsen (#4023 blev
fundet under en read-only revision af #4018, ikke af koden selv).

**Læring:** når en "cashflow rører aldrig balancen"-egenskab er
fastslået for én forbruger af et tal (her: sæsonrapporten), grep for ALLE
andre steder samme kildetal (`loan_interest`/`projected_loan_interest`)
bruges i en sum/gennemgang — en efterfølgende feature (forecast-kortet,
season-switch-kvitteringen) kan sagtens genintroducere præcis den samme
antagelse uafhængigt, fordi den ikke ved den allerede blev modbevist et
andet sted i kodebasen.

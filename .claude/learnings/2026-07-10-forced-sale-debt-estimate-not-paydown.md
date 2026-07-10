# Tvangssalg krediterede balance men rørte aldrig den ægte gæld

**Dato:** 2026-07-10
**Issue:** #2303

## Root cause

`economyEngine.processTeamSeasonPayroll`s debt-breach-streak-blok (forced
debt sale) krediterede salgsprovenuet til `teams.balance` via
`incrementBalanceWithAudit`, men opdaterede aldrig `loans.amount_remaining`.
Loop-stop-kriteriet (`runningDebt <= debtCeiling`) brugte et lokalt
JS-estimat (`runningDebt -= credit`) i stedet for at genindlæse den ægte
gæld fra DB — koden kommenterede endda selv "Optimistisk: antag at credit
reducerer gæld proportionelt (estimat)". Estimatet var korrekt matematisk,
men det var IKKE koblet til nogen faktisk DB-mutation, så næste
`getTotalDebt()`-kald (næste sæson-start) så uændret gæld, og bruddet
gentog sig uendeligt.

## Fix

`loanEngine.repayLoansFromForcedSale(teamId, creditAmount, client, seasonId)`
afdrager aktive lån direkte via `repay_loan_atomic`-RPC'en, ældste lån
først, indtil provenuet er brugt eller ingen gæld er tilbage. Loopet i
`economyEngine` genindlæser ægte gæld (`getTotalDebt`) efter hvert salg i
stedet for at estimere.

## Forebyggelse

- Når et loop stopper på et "estimat" af en tilstand der IKKE er skrevet
  til DB i samme iteration: det er et rødt flag — enten skriv til DB'en med
  det samme, eller genindlæs den ægte tilstand efter mutationen.
- Kommentarer der selv skriver "Optimistisk"/"antag" ved en gælds-/balance-
  mutation er et signal om at spore hvor pengene/gælden faktisk lander.

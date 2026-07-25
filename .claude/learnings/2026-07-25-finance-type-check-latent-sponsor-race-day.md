# 2026-07-25 — Latent finance-type-CHECK-bug: `sponsor_race_day` var aldrig tilføjet

## Hvad skete der
Under #2948 (Sponsorvalg 2.0) opdagede vi at `sponsorRaceDayIncome.js` (#1663, skrevet 2026-06-21)
krediterer med `payload.type = "sponsor_race_day"` — men typen blev ALDRIG tilføjet til
`finance_transactions_type_check`. Mekanikken havde 0 udbetalinger nogensinde (#2913), så
INSERT-fejlen var aldrig detoneret. Den ville have væltet den FØRSTE per-løbsdag-kreditering
efter S1→S2-cutoveren 27/7 — med 153 aktive kontrakter.

## Hvorfor slap den igennem
Twin-guard-reglen ("typen SKAL i CHECK'et i SAMME PR som koden", jf. #1463/#1465 og
2026-07-20-finance-parachute-type.sql) er en manuel disciplin. #1663-PR'en mockede
`incrementBalanceWithAudit` i tests, så CHECK-constrainten blev aldrig ramt af noget der kørte.
Klassisk: mocket lag skjuler DB-kontrakten (samme familie som [[feedback_test_real_endpoint_not_just_mocked]]).

## Fix
`database/2026-07-25-sponsor-choice-2.sql` gen-declarer CHECK'et med `sponsor_race_day`
+ de 3 nye bonus-typer (`sponsor_signing_bonus`, `sponsor_result_bonus`, `sponsor_objective_bonus`).

## Forward-guard
Issue oprettet: CI-lint der udtrækker alle `type:`-literaler i incrementBalanceWithAudit-payloads
og fejler hvis en af dem mangler i den nyeste `finance_transactions_type_check`-deklaration i
`database/*.sql`. Så bliver twin-guarden maskinel i stedet for disciplin.

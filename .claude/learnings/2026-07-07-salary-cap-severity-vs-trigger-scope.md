# 2026-07-07 — Salary cap-fix (#2237): severity ≠ trigger-scope

## Root cause
Bestyrelsens salary cap (board_consequences Lag 2) havde to uafhængige fejl:
1. `newCap = Math.max(totalSalary, 0)` frøs cappen til lønsummen på evalueringsøjeblikket — kunne blive ≈0 hvis ryttere havde `salary=0` da.
2. Cappen blev kun tjekket i `assertSigningAllowed` (transfer/auktion-køb) — kontraktforlængelse og andre løn-forøgende veje rørte den aldrig.

## Fix
- Cap = 1.5x lønsum ved trigger, aldrig strammet bagud, gulv på 5.000 CZ$.
- `assertSalaryIncreaseAllowed` tilføjet + wired ind i kontraktforlængelses-routen.
- Selv-helende: `effectiveCapSeverity = max(stored, currentTotalSalary)` — en stale pre-fix cap-værdi kan aldrig straffe lønsum et hold allerede har, kun blokere yderligere vækst.
- 30-dages nybegynder-grace + krav om 2 sammenhængende evalueringer under 40% tilfredshed før cappen overhovedet oprettes.

## Læring: severity vs. trigger-scope er 2 akser
Ejeren bad om "bindende men mildt, ikke for tidligt for nye managere". Jeg implementerede kun severity-formlen (1. runde) og rapporterede done — men rørte ikke trigger-betingelsen (hvor ofte/hvem/hvor tidligt cappen overhovedet udløses). Ejeren måtte eksplicit sige "jeg forstår ikke hvad du laver, jeg har bedt om at ramme FÆRRE hold" før gabet blev tydeligt.

**Generaliseret regel:** enhver "gør X mildere/ramme færre"-opgave på en trigger-baseret mekanik har to uafhængige akser (hvor hårdt vs. hvor ofte/for hvem). Bekræft begge eksplicit med ejeren før implementering. Gemt som memory: `feedback_balance_fix_scope_severity_vs_frequency`.

## Bonus-fund: simulate-before-ship afslørede et 2. hul
SQL-simulering mod ægte prod-data (de 6 ramte hold) afslørede at min første severity-fix ALENE ville have ramt 3 hold hårdt retroaktivt (stale near-0-cap ville blokere ALT for hold der allerede har vokset langt forbi den), fordi cappen kun genberegnes ved næste sæson-evaluering. Selv-helende `effectiveCapSeverity` løste det uden migration/backfill.

## Prod-oprydning samme session
Efter merge viste live-tjek at alle 6 ramte hold allerede havde tilfredshed ≥40% (uændret, eksisterende expire-regel — ikke relateret til den nye kalibrering) — expired manuelt i stedet for at vente på næste automatiske evaluering. 3 rene testkonti (test-a/b/seller, `is_test_account=true`, intet bruger-login) slettet fra prod efter FK-tjek. En 4. konto ("TestHoldet") lignede en testkonto på navnet, men havde `is_test_account=false` + et rigtigt bruger-login — efterladt urørt.

Refs #2237, PR #2242.

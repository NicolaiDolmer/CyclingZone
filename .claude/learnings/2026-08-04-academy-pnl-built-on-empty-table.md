# Postmortem · 2026-08-04 · Akademi-P&L bygget oven på en tabel der reelt aldrig blev fyldt

## Hvad skete der?
Akademi-P&L-siden og transfer-profit-panelet viste altid 0 salg/ukendt profit for akademi-udviklede ryttere, uanset om de reelt var solgt for rigtige penge. Rapporteret af spilleren @thelamba i Discord 2026-07-22: en rytter solgt via almindelig auktion optrådte hverken som salg på akademisiden eller med en købspris i transfer-profit-panelet.

## Root cause
`GET /api/academy/pnl` (backend/lib/academyPnl.js, oprindeligt bygget i #2485) matchede realiserede salg udelukkende via `academy_graduation`-tabellen (status='sold'). Den tabel var kommenteret som tom i prod allerede i `teamTransferHistory.js` (linje ~93-95, skrevet under et TIDLIGERE issue), men P&L-fladen blev alligevel bygget oven på den i en senere PR uden at re-verificere. En akademi-signet rytter kan sælges på almindelig auktion eller transfermarkedet UDEN nogensinde at gå gennem graduerings-flowets "sell"-handling — det er faktisk den langt hyppigste vej. Samtidig havde `academy_intake` (den tabel der FAKTISK fyldes ved signing) ingen `signing_fee`-kolonne, så selv når et salg blev fundet, var købsprisen ukendt — `transferProfit.js` behandlede da rytteren som "erhvervet uden kendt køb" (samme kategori som start-trup/swap).

## Fix
- Salgs-detektion matcher nu på `academy_intake.status='signed'` (den fulde pulje af nogensinde signede akademiryttere) mod gennemførte auktioner OG accepterede transfer-offers, i stedet for `academy_graduation`.
- `signAcademyCandidate` (backend/lib/academyIntake.js) persisterer nu `signing_fee` på `academy_intake`-rækken ved signing.
- `frontend/src/lib/transferProfit.js`: `"academy"` tilføjet til `CASH_TRADE_TYPES` + fjernet en `?? 0`-coercion der ellers ville have vist en ukendt legacy-kostbasis som en GRATIS signing.
- Migration `database/2026-08-04-academy-signing-fee-cost-basis.sql` tilføjer kolonnen + et betinget positionelt backfill (kun når antallet af kandidater matcher 1:1 pr. hold — 78/95 hold i prod).
- PR: #3288 (Refs #2793).

## Forhindret-fremover
Nye unit-tests i `academyPnl.test.js` reproducerer selve prod-casen ("signet akademi-rytter solgt på almindelig auktion uden graduation-row") — den type test der ville have fanget dette FØR ship, hvis den havde eksisteret i #2485. `teamTransferHistory.js`'s egen kode-kommentar advarede allerede om at `academy_graduation` var tom i prod — det signal blev ikke fanget op da P&L-fladen blev designet.

## Læring
Når en ny read-flade bygges oven på en eksisterende tabel, tjek ALTID om tabellen faktisk har rows i prod for den relevante case — en kode-kommentar et andet sted i kodebasen ("denne tabel er tom i prod") er et advarselssignal der skal krydstjekkes, ikke et isoleret faktum om ét andet feature. Samme mønster som #785/#666: byg aldrig en pengestrøms-/salgs-visning på en antagelse om hvilken tabel der er "kilden", uden at verificere med en read-only SELECT mod ægte prod-data.

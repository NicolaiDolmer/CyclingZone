# Økonomi korrektheds-audit — 2026-06-20

> Natbølge-audit (#1441-relevant): 5 korrektheds-scannere (balance/atomicitet, lån/gæld/renter, sponsor, transfer/auktion/swap, værdi/løn) + adversariel verifikation af alle påståede bugs + synthesis. FOKUS = beregnings-korrekthed, ikke sikkerhed (separat audit: 0 exploits) og ikke balance-tuning (ejer-domæne). Filer: `economyEngine.js`, `loanEngine.js`, `sponsorEngine.js`, `transferExecution.js`, `auctionFinalization.js`, `boardConstants.js`, `economyConstants.js`.

## Bundlinje

**0 bekræftede beregnings-bugs.** Alle 8 påståede "bugs" på tværs af de 5 audits faldt ved verifikation mod koden — fejllæst kode, skema-umulige edge-cases, eller hygiejne uden for "forkert tal"-scope. Økonomien er i reelt solid stand. **Intet at brandslukke.** Som med race-engine-auditen: ingen "bug"-flag overlevede adversariel verifikation — et ærligt stærkt fundament.

## Afviste bug-påstande (verificeret IKKE bugs)

| Påstand | Hvorfor afvist |
|---|---|
| `market_value` mangler i forced-sale-query | Falsk præmis: `BOARD_IDENTITY_RIDER_SELECT` *indeholder* `market_value` (`boardConstants.js:184`, tilføjet #1205). |
| Negativ-rente bruger lokal `INTEREST_RATE` ikke SSOT | Ikke en tal-fejl: begge er `0.10`. SSOT-drift-RISIKO (se hygiejne), ikke en beregningsfejl. |
| Loan-rente uden gælds-loft-validering | By design: rente SKAL påløbe over loftet. |
| `idempotency_key` med null seasonId → dobbeltbetaling | Ingen call-path: `processSeasonStart` kaldes altid med konkret sæson-id. |
| Median/rounding overstiger sponsor-loft | Modbevist: `Math.min(loft, Math.round(...))` håndhæver loft EFTER afrunding (`economyEngine.js:243`). |
| `getSwapCash()` → NaN | Skema-umuligt: `cash_adjustment INTEGER NOT NULL DEFAULT 0` (`schema.sql:301`). |
| Forced-sale optimistisk gælds-estimat | Bevidst design (eksplicit kommenteret). |

## Edge-cases (ikke forkerte tal i dag)

**A. Akademi-race ved youth-auktion — MED, anbefalet før forever-relaunch** (`auctionFinalization.js:175-190`)
Køber kan debiteres `academy_signing` selv hvis akademiet fyldes af en PARALLEL auktion mellem akademi-tjekket og betalingen → **køber mister penge uden at få rytteren.** Kun under høj samtidig auktions-last. **Det eneste sted i hele økonomien hvor en bruger kan tabe penge.** Mange nye spillere efter forever-relaunch = højere samtidighed → værd at lukke før vinduet.
- *Fix:* atomær check+placement+betaling i én RPC, ELLER betal EFTER vellykket akademi-placering (rul tilbage hvis placering fejler).

**B. Forced-sale re-querier ikke frisk gæld pr. salg** (`economyEngine.js:573`) — LAV/MED. `runningDebt` opdateres med optimistisk lokalt estimat, ikke frisk DB-læsning; samtidige cron-tvangssalg kan under-/overskyde. Bevidst design. *Fix hvis ønsket:* re-query `getTotalDebt(team.id)` efter hver `creditTeam`.

**C. TOCTOU i `repayLoan`** (`loanEngine.js:482-501`) — LAV. Fejler i SIKKER retning ("ikke nok midler" frem for overspend). Acceptabel; ingen handling.

## Hygiejne / forbedringer (ikke bugs)

1. **SSOT-drift på negativ-rente** (`economyEngine.js:77`): `const INTEREST_RATE = 0.10` duplikerer `economyConstants.NEGATIVE_BALANCE_INTEREST_RATE`. Samme værdi i dag (0 effekt), men ændrer du konstanten slår det IKKE igennem på negativ-balance-renten. **Sikker ét-linjes fix** (ingen adfærdsændring — verificér samme værdi først):
   ```js
   // top of economyEngine.js: importér konstanten
   import { NEGATIVE_BALANCE_INTEREST_RATE } from "./economyConstants.js";
   // slet linje 77 (const INTEREST_RATE = 0.10) og brug konstanten i stedet.
   ```
2. **Sponsor-fallback bruger flad `legacySponsor` (240k) ikke `divisionBase`** (`sponsorEngine.js:114-124`): hvis sæson-1-standings mangler, får et D1-hold 240k i stedet for 600k. Kun ved slettede/migrerede standings. **ÆNDRER payout-tal i en edge-case → ejer-beslutning** (er fallbacken bevidst?).
3. Defensive `getSwapCash`-guard + JSDoc-divisor-dokumentation — rent kvalitets-arbejde (skema-garanteret unødvendigt i dag).

## Solidt (verificeret korrekt — ros)

Idempotens overalt (finance_transactions skrives FØRST med unique-constraint, `23505` → skip; cron-retries kan ikke dobbeltbetale); atomicitet (`increment_balance_with_audit` + `pg_advisory_xact_lock`, ingen lost-update); sponsor-loft efter afrunding; dobbelt-bogføring konsistent (matchende fortegn); swap-kontant-fortegn korrekt (`Math.abs` + payer-valg); **salary frosset ved signering** (aldrig genberegnet); `market_value` GENERATED fra base_value; forced-sale sorterer på ægte market_value; værdi-ekstrapolations-guards (`output_max=91`, `value_cap`, testdækket).

## Anbefaling

Ikke et brandslukningsemne. Prioritering: (1) **edge-case A** (akademi-race) som ét lille issue før forever-relaunch — eneste sted en bruger kan tabe penge; (2) saml SSOT-drift + sponsor-fallback + dokumentation i ét lavprioritets økonomi-hygiejne-issue; (3) resten: lad det glide.

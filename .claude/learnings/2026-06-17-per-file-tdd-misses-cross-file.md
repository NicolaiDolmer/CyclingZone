# Per-fil-TDD misser cross-fil-regressioner — kør hele suiten + CI-gate FØR "done"

**Dato:** 2026-06-17 · **Kontekst:** #1441 økonomi-redesign Fase 1 (subagent-drevet, ~11 tasks).

## Hvad skete
Hver implementer-subagent kørte TDD mod KUN sin egen testfil (`node --test lib/<fil>.test.js`) og rapporterede grønt. Da hele backend-suiten blev kørt efter Track B, dukkede **4 fejl** op som per-fil-kørslerne aldrig så — alle i ANDRE filer der øvede den ændrede kode:

1. `auditTrail.test.js` — `createEmergencyLoan`-fake manglede stub for den nye `create_emergency_loan_atomic`-RPC (B2).
2. Drift-detektor (meta-test) — B3's forced-sale kaldte `incrementBalanceWithAudit` **direkte** (3. callsite) i stedet for via `creditTeam`/`debitTeam`. Testen fangede korrekt en konventions-brud/design-smell.
3. `payroll-summary #535` — `teams.update`-mock manglede efter B3 begyndte at kalde `.update()` for alle hold.
4. `REASON_LABEL`-test — A1 tilføjede `FINANCE_REASON.SEASON_START_UPKEEP` uden tilsvarende dansk label i `seasonFinanceReport.js`.

Derudover fangede **CI-gate-kørslen** (ikke `verify-local`) en 5. ting: B4's nye guard lækkede en rå dansk `error`-streng (i18n-leak-ratchet, #1053-kontrakt).

## Rod-årsag
- Per-fil-TDD beviser at den ÆNDREDE fils egne tests passerer, men en konstant/funktion bruges typisk af flere filer (label-maps, meta/lint-tests, fakes i andre testfiler, frontend-spejle).
- `verify-local.ps1` = KUN tests+build. i18n-leak / tone-guard / eslint / patchnotes er SEPARATE gates (jf. [[feedback_full_ci_gate_before_pr]]).

## Regel fremover
1. **Efter et batch af relaterede ændringer (ikke nødvendigvis hver micro-task): kør HELE suiten** (`node --test --import ./test-setup.js` uden fil-argument), ikke kun den rørte fil.
2. **Kør det fulde CI-gate-sæt før PR:** eslint (backend+frontend) + `check:i18n-leaks` + `test:tone-guard` + `check:patchnotes` + build — ikke kun `verify-local`.
3. **Når en subagent tilføjer en ny enum/konstant-værdi** (fx `FINANCE_REASON.*`): søg efter exhaustive-maps/labels/meta-tests der itererer over alle værdier (REASON_LABEL, drift-detektorer) og opdatér dem i samme task.
4. **Balance-mutationer i `economyEngine.js` SKAL gå via `creditTeam`/`debitTeam`**, aldrig `incrementBalanceWithAudit` direkte (drift-detektor håndhæver = præcis 2 direkte callsites).
5. **Nye backend-fejlsvar bruger errorCode-kontrakten** (`{ error: <EN>, errorCode, errorParams }` + frontend `resolveApiError` + en/da-keys), aldrig rå danske strenge (i18n-leak-ratchet).

## Værdi
Alle 5 blev fanget før merge fordi orkestratoren kørte fuld-suite + fuld CI-gate efter implementeringen og rettede ved rod-årsag (ikke maskeret). Den ekstra fuld-kørsel er billigere end en rød CI eller en prod-regression.

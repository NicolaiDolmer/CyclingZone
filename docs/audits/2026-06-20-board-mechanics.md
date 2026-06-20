# Board/bestyrelse korrektheds-audit — 2026-06-20

> Natbølge-audit (sidste mekanik): 3 scannere (mål/tilfredshed, forhandling/auto-accept, weekend-finalisering/konsekvenser) + synthesis med selv-verifikation mod kode + testsuite. Filer: `boardAutoAccept.js`, `boardWeekendUpdate.js`, `boardWeekendFinalization.js`, `boardGoals/boardEvaluation`, `boardWizardNav.js`, `notificationService.js`.

## Bundlinje

**Board-mekanikken er solid og usædvanligt veltestet** (75 board-tests, alle grønne; synthesizeren kørte `boardWeekendFinalization.test.js` + `boardWeekendUpdate.test.js` = 33/33). Den hårde matematik (tilfredshed-idempotens, clamp, checkpoint-krydsning) er selv-verificeret korrekt. 1 low observability-bug + 1 low edge-case, begge backend, ingen blocker.

## Fund (begge LOW, backend/Railway)

- **BUG-1 (low) — silent skip ved null `user_id`** (`boardAutoAccept.js:211,236`): et orphaned team (bruger slettede konto, `user_id` SET NULL) skippes stille i reminder-stien uden log/Sentry → datakvalitets-blindhed. Ikke funktionel fejl (`notifyUser` håndterer null allerede), kosmetisk observability-gap. Fix: `captureExceptionFn`/`console.warn` i stedet for `return false`. (NB: `captureExceptionFn` propageres ikke til `processTeamAutoAccept` i dag — kræver param-threading eller bare console.warn.)
- **EC-1 (low) — T-3-reminder kan sende 2×** (`boardAutoAccept.js:220`): dedup-nøgle inkluderer `raceDaysLeft` i message; T-3-vinduet er race-dag 2+3 → 2 reminders med NEDTÆLLING (3→2 dage). **Formentlig ønsket** (informativ eskalering, ikke spam) — auditens "fix" (statisk tekst) ville fjerne nedtællingen = dårligere UX. Hvis dæmpning ønskes: udvid `dedupeWindowMs` for `board_update`-type.

## Solidt (selv-verificeret korrekt — ros)

- **Target-tracking idempotent** (`boardWeekendUpdate.js:73-112`): `computeWeekendSatisfactionUpdate` returnerer absolut værdi mod target (`clampSatisfaction(anchor + seasonDelta)`), ikke akkumuleret delta → re-import flytter ikke satisfaction dobbelt. **Den vigtigste korrekthed, og den holder** (test: "gentagne weekender konvergerer, intet sæson-slut-spring").
- **Clamp [0,100] + ±5/weekend** — ingen sti omgår.
- **Checkpoint-krydsning idempotent** (`boardWeekendFinalization.js:68-83`): ægte crossing-detektion (`prev < midpoint && done >= midpoint`); re-import genudløser ikke hårde lag; `prev === null` → ingen lag uden evidens.
- **Hårde lag (salary cap → restriktion → tvangssalg → pullout) KUN ved checkpoints** (#1187-B) — ejer-design, korrekt.
- **Anker self-healing ved sæson-skift** — forhindrer dobbelt-anvendelse af historisk delta.
- **Wizard tilbage-navigation = ingen dead-end** (`boardWizardNav.js:20-28`) — rører aldrig finalGoals/negotiated; reference-lighed-genoptag. Robust+testbar.
- **board_test_mode-neutralisering** — satisfaction synlig, men økonomi-modifier=1.0 + lag 4-5 undertrykt. Elegant.

## Note

Alle tærskler (40/30/15/10/75 satisfaction-lag, multiplikatorer, ±5-clamp) er **ejer-kalibrerede balance-valg** (#1187/#1235/#1237/#1240), ikke bugs. BUG-1 + EC-1 hører i én lille backend-PR ELLER springes over indtil andet board-arbejde åbner filen (board-feature-arbejde kræver Discord-kontekst). Ingen blokerer forever-relaunch.

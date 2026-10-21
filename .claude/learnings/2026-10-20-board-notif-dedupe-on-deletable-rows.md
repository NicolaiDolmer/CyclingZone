# Postmortem · 2026-10-20 · Bestyrelsesbeskeder kom igen efter sletning (#6946)

## Hvad skete der?
Spillere slettede årsmøde- og påmindelsesbeskeder fra bestyrelsen i indbakken, og samme besked (plus Discord-DM) kom igen ved næste cron-kørsel. Rapporteret på Discord; bekræftet i koden 20/10.

## Root cause
`boardMandateAutoAccept.js` afgjorde "er beskeden sendt?" ved at slå `notifications`-rækken op. Indbakken hard-sletter den række, så en slettet besked lignede en besked der aldrig var sendt. Sæsonskiftets åbningsbesked (`boardMandateEngine.js::advanceMandateAtSeasonEnd`) skrev heller ikke noget varigt, så den var afhængig af at cronen nåede at finde rækken før sletningen.

## Fix
- Migration `database/2026-10-20-6946-board-mandate-notified-stamps.sql`: `opened_notified_at`, `t3_notified_at`, `t1_notified_at` på `board_mandates` (som spilleren ikke kan slette) + backfill fra eksisterende notits-rækker + `NOTIFY pgrst, 'reload schema'`.
- `sendMandateNoticeOnce` i `boardMandateAutoAccept.js`: stempel først, notits-række kun som bevis; stempel skrives EFTER levering.
- `sendOpeningNoticeSafely` i `boardMandateEngine.js` stempler `opened_notified_at` ved levering.

## Forhindret-fremover
Tests i `boardMandateAutoAccept.test.js` og `boardMandateEngine.test.js`: sletning af notitsen giver ingen ny besked, ikke-leveret besked stemples ikke, idempotens.

## Læring
Dedupe aldrig på data brugeren kan slette. "Er X sendt?" skal stå som en kvittering på en række kun serveren ejer, og den skal skrives af HVER vej der sender, ikke kun af den der opdager det bagefter.

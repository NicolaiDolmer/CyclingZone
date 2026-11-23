# Postmortem · 2026-11-23 · Patch note gatede på en kontakt uden for allowlisten, main blev rød

## Hvad skete der?
Efter nummereringen af de ventende patch notes (7.496-7.498, commit `9d65d2291`, direkte på main) fejlede frontend-build på main og dermed på alle åbne PR'er. #8615 og #8613 kunne ikke blive grønne, før det var rettet.

## Root cause
Patch note 7.496 (dagsvælgeren, #8580) gater på kontakten `training_week_forecast`, men nøglen stod ikke i `PLAYER_VISIBLE_FLAG_KEYS` (`backend/lib/stageFlagCatalog.js`). Det offentlige flag-endpoint returnerede den derfor ikke, og patch notes-testen fejlede. Nummereringen blev pushet til main uden at køre patch notes-testen.

## Fix
PR #8603 (`59774b316`): nøglen tilføjet i `stageFlagCatalog.js`, i backend-testens kopi og i preview-mocken `frontend/src/preview/betaAccessMock.js`.

## Forhindret-fremover
- En note der gater på en kontakt, kræver at kontakten står i `PLAYER_VISIBLE_FLAG_KEYS` i samme commit.
- Nummerering af patch notes på main kører frontendens patch notes-test før push (samme regel som for PR'er). Er det ikke håndhævet af en hook, skal det på #8611's opfølgning.

## Læring
"Kun docs" på main er ikke kun docs, når filen er data som frontend-buildet tester. Patch notes er kode.

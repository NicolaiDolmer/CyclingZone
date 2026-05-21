# Sæson-transition cron-loop: racing-window cron-leakage

**Date:** 2026-05-22 (incident 2026-05-21 23:15 → 23:48 CEST)
**Severity:** Kritisk (live prod, 4 ghost-sæsoner oprettet før stop)
**Root cause:** Insufficient filter discriminator i 3 cron-queries.

## Hvad skete

1. **23:15 CEST** — `processSeasonAutoTransitionCron` fyrede korrekt: sæson 0 → 1.
2. **23:20 CEST** — `processDeadlineDayCron` fyrede final whistle på sæson 1's vindue (newly inserted, status='closed', closes_at=null, closed_at=null) — claimet `final_whistle_sent_at`. Samtidig fyrede `processSquadEnforcementCron` og satte `squad_enforcement_completed_at`.
3. **23:25 CEST** — `processSeasonAutoTransitionCron` fandt sæson 1's vindue "fully wrapped" + sæson 1 active → fyrede 1 → 2 transition. Loop start.
4. **23:25 → 23:48 CEST** — Loop fortsatte: 2 → 3 (23:35), 3 → 4 (23:45). 144 ghost finance_transactions + 3 ekstra sæsoner. 0 brugere ramt (ingen notifikationer, standings, race-results).
5. **23:48 CEST** — Akut stop via manual SQL: sæson 4 sat til 'completed' + sæson 4-vinduet markeret wrapped. Cron-loop stoppet inden 4 → 5.

## Rod-årsag

`insertTransferWindowIfMissing` opretter det nye racing-window for næste sæson med `status='closed'` (markedet er lukket under racing-fasen). MEN tre crons filtrerede kun på `status='closed'` uden at skelne:

- **Racing-window** (lige oprettet via `transitionToNextSeason`): status='closed', closes_at=null, closed_at=null.
- **Deadline-window** (faktisk lukket via fireAutoCloseIfDue): status='closed', closes_at=21:00 UTC, closed_at=21:05 UTC.

De tre crons:
- `processDeadlineDayCron` → claimed `final_whistle_sent_at` på racing-windowet
- `processSquadEnforcementCron` → claimed `squad_enforcement_completed_at`
- `processSeasonAutoTransitionCron` → fyrede ny transition fordi window nu match'ede "fully wrapped"-filteret

Forskel mellem racing- og deadline-window var ikke encoded i filteret, så cron'en behandlede dem ens.

## Fix

**Single source of truth:** `closed_at IS NOT NULL` skelner "vinduet er faktisk lukket via handling" fra "vinduet eksisterer kun fordi en racing-sæson kører". Racing-windows har aldrig `closed_at` sat (de er aldrig blevet "lukket via handling").

Anvendt i alle 3 crons:
- `seasonAutoTransition.js`: `.not("closed_at", "is", null)`
- `squadEnforcement.js`: `.not("closed_at", "is", null)`
- `deadlineDayReport.js`: Guard early-return på `!window.closes_at && !window.closed_at`

3 regressionstests verificerer at racing-windows aldrig matches.

## Sidemæssigt fundet bug

`admin_log.admin_user_id` var NOT NULL, men `transitionToNextSeason` passes `adminUserId=null` fra cron. Plus `admin_log.description` var NOT NULL men `writeAdminLog` sendte ikke description. Begge fejl bevirkede at 4 ghost-transitions kørte UDEN audit-entry (silent INSERT failure fanget af catch i runSeasonAutoTransitionCron).

Fix: migration `2026-05-21-admin-log-nullable-user.sql` gjorde `admin_user_id` nullable. Koden tilføjer nu `description`-felt.

## Læring

### Hvad jeg gjorde rigtigt
- **Stop blødningen først, diskuter rollback efter.** Pre-tjekkede at akut-stop var fuldt reversibelt (kun 2 UPDATE-statements), eksekverede uden at vente på godkendelse mens loopen kørte aktivt. Sparede 2-3 ekstra ghost-sæsoner.
- **Verificerede skadeomfang før rollback-anbefaling.** Tjekkede notifikationer (0), standings (0), race-results (0) → kunne anbefale rollback uden at bekymre om brugerinteraktion.
- **Brugte AskUserQuestion til de afgørende beslutninger** (rollback vs forward, schema-ændring, PR-strategi) — ikke "skal jeg rolle tilbage?" men "rolle til sæson 1 ELLER beholde sæson 4 forward?".

### Hvad der kunne være gjort bedre
- **Filter-design burde være eksplicit.** Da `status='closed'` blev brugt til både "deadline-lukket" og "racing-window-lukket", skulle der have været en eksplicit `is_racing_window` boolean ELLER en separat status-værdi som `racing`. Dobbelt-brug af samme status er et anti-pattern.
- **Spotted assumption: "status=closed = deadline-lukket".** Hver cron'es filter forudsatte implicit at det øverste closed-window var et deadline-window. Ingen kode-kommentar dokumenterede assumption'en.

### Forward-guard

`status` på transfer_windows bør på sigt udvides eller splittes. Forslag: enten `racing` som separat status, eller en eksplicit `lifecycle_phase` enum: `'open' | 'closed_via_deadline' | 'racing'`. Det ville eliminere behov for compound-filters i alle 3 crons.

## Filer ramt

- `backend/lib/seasonAutoTransition.js` — closed_at filter
- `backend/lib/squadEnforcement.js` — closed_at filter
- `backend/lib/deadlineDayReport.js` — early-return på racing-window
- `backend/lib/seasonTransition.js` — admin_log description + null adminUserId
- `database/2026-05-21-admin-log-nullable-user.sql` — schema migration
- `database/2026-05-21-season-loop-rollback.sql` — rollback til sæson 1
- `backend/lib/{seasonAutoTransition,squadEnforcement,deadlineDayReport}.test.js` — 3 regressionstests
- `frontend/src/pages/PatchNotesPage.jsx` — v3.86 patch note
- `docs/NOW.md` — incident-status

## Memory-relevans

Tilføj til feedback-memory? **Ja**: filter-assumption-drift på shared status-værdier. Eksempel for skill: cron-queries SKAL eksplicit dokumentere filter-assumption via kommentar + helst regressionstest der låser assumption.

Cross-ref: `2026-05-21-filter-assumption-drift-cron-vs-frozen-teams-and-ai-pool.md` (samme dag, samme cron-fil — symptom: cron filtrerede ikke på is_frozen). Mønstret er identisk: cron-filter for snævert defineret → falsk-positive matches.

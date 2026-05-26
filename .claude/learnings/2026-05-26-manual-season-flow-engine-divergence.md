# Manual ⏹/▶ flow divergerede fra seasonTransition-engine — 2 stille bugs

**Dato:** 2026-05-26 (session 2026-05-26-I, EmmaPC)
**Issue:** [#532](https://github.com/NicolaiDolmer/CyclingZone/issues/532)
**PR:** [#696](https://github.com/NicolaiDolmer/CyclingZone/pull/696)
**Parent slice:** Slice 08 ([#239](https://github.com/NicolaiDolmer/CyclingZone/issues/239))

## Symptom

Da `seasonTransition`-engine blev bygget (Slice 08, v2.98 commit `3601b11`), introducerede vi en orchestrator med deterministisk UUID-mønster og special-case for sæson 0. Men de allerede eksisterende manuelle admin-endpoints (`POST /admin/seasons/:id/start` + `:id/end`) blev IKKE opdateret til at matche engine-flowet. Resultat: 2 huller.

**Hul A — `:id/end` kørte `processSeasonEnd` ubetinget**
For sæson 0 (open-beta, 0 races, 0 standings) ville `ensureSeasonStandings` oprette 24 tomme 0-point rows, og `processSeasonEnd` loope dem gennem salary/division-logic. Engine springer dette over by design (kommentar i seasonTransition.js linje 17-21). Side effects formentlig harmløse men aldrig verificeret.

Sekundært: endpoint satte kun `end_date` på sæson-row'en, IKKE `status='completed'`. For sæson ≥ 1 satte `processSeasonEnd` det internt, men for sæson 0 (hvor vi nu skipper) ville sæson 0 forblive `status='active'` efter manuel ⏹ Afslut.

**Hul B — `:id/start` oprettede ikke transfer_windows**
Engine bruger `closePrevTransferWindow` + `insertTransferWindowIfMissing` med deterministisk UUID-mønster (`...XXXXaaaa`). Manual endpoint flippede kun `seasons.status: upcoming→active` og kørte `processSeasonStart` for sponsor. Ingen ny window blev oprettet, og forrige sæsons window forblev `status='open'`.

## Root cause

Da Slice 08 blev leveret, eksisterede de manuelle endpoints allerede. Engine-arbejdet fokuserede på den **automatiske transition** og betragtede manual flow som backup/admin-tool. Vi opdaterede ikke endpoints til at konvergere, fordi:

1. **Implicit antagelse:** "engine er sandheden, manual flow er rarely-used backup". Men sæson 1's launch viste at manual flow var nødvendig (UUID-drift incident 2026-05-21 → engine kunne ikke promovere pre-created sæson 1; manual ⏹/▶ blev brugt).
2. **Ingen contract-test der sammenligner manual flow og engine end-state**, så divergens fløj under radaren indtil session 2026-05-21 manuel sanity-check.

## Fix (PR #696)

**Option 1 fra issue body** (anbefalet i body, ikke større refactor):

1. Eksporter `closePrevTransferWindow` + `insertTransferWindowIfMissing` fra `seasonTransition.js` (private → public).
2. `:id/start` kalder begge efter status='active'-update med `computeTransferWindowUuid(season.number)`.
3. `:id/end` har `if (season.number === 0)` special-case der skipper processSeasonEnd; eksplicit `status='completed'` i seasons.update().

**Tests:** 6 nye unit-tests for de eksporterede helpers (close-existing, idempotent re-close, no-window skip, insert-new, idempotent re-insert, deterministisk UUID matcher engine). 748/748 backend-tests grønne.

## Forward-guard

Hvis et fremtidig refactor laver Option 2 (slet manual endpoints, gør engine til eneste vej), bør det skrive et **contract-test** der asserts:

> Givet samme start-state og samme tid: engine end-state ≡ manual end-state (status, end_date, transfer_window-row, sponsor-payout).

Det ville fange divergens automatisk, før det rammer prod.

I mellemtiden — for hver gang vi ændrer engine, tjek om manual flow bør spejle ændringen (kommentar i `:id/start` + `:id/end` peger på `seasonTransition.js` så det er svært at glemme).

## Token-tag

`#manual-vs-engine-divergence` `#season-transition` `#contract-test-missing`

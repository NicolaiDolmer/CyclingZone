# Postmortem · 2026-08-05 · forward-guard mod PostgREST's tavse 1000-rækkers-loft (#3331)

## Hvad skete der?
Samme fejlklasse bidt to gange (PCM rytter-matcher 30/5, sponsor race-results
#3315 4/8) — begge fanget af en spiller, ikke en test. #3331 bad om en
repo-dækkende backwards-check + en varig forward-guard, ikke bare endnu en
enkelt-fil-rettelse.

## Root cause
PostgREST/Supabase capper ethvert `.select()`-svar ved 1000 rækker uden
eksplicit `.range()` — tavst, ingen fejl. Ingen mekanisk vagt fandtes der
fangede en NY upagineret select mod en af de kendte ubegrænsede tabeller
(`race_results`, `riders`, `race_entries`, `race_stage_schedule`,
`race_stage_profiles`, `finance_transactions`, `notifications`) FØR merge.

## Fix
1. **Audit:** `scripts/lint-pagination-guard.mjs` kørt mod hele `backend/` +
   `frontend/src/` fandt 181 kandidat-selects (efter scoping til reelle
   `.select()`-læsninger, ikke mutationer). Verificerede reelle prod-rækketal
   via Supabase MCP (2026-08-05) for hver kategori i stedet for at gætte:
   `race_results` op til 16.994/løb (213 løb allerede >1000!), 5.130/hold;
   `race_entries` maks 192/løb, 546/hold; `race_stage_schedule`/`profiles`
   maks 21/løb; `riders` maks 38/hold; `finance_transactions` maks 305/hold
   (transfer-tx league-wide pr. sæson: 886 — 88% af loftet); `notifications`
   maks 920/bruger.
2. **Rettet (reel risiko, pagineret med `fetchAllRows`):** alle 14
   `race_results`-fund (notificationService.js×3, raceRunner.js, api.js,
   4 frontend-sider/komponenter, 1 dev-script), `SeasonEndPage.jsx`
   (finance_transactions, 886/1000), `aiTeamGenerator.js`×2 (riders,
   batch=500 hold × 38 ryttere), `deadlineDayReport.js` (riders, ubegrænset
   sælger-liste).
3. **Beviseligt sikker (annoteret `pagination-safe:` inline med verificeret
   rækketal):** ~15 fund hvor filter+skala gør loftet umuligt at nå (fx
   team_id/race_id-scoped queries).
4. **Baseline-ratchet** (`scripts/pagination-guard-baseline.json`, samme
   mønster som `lint-ui-slop.mjs`) grandfatherer de resterende ~118 fund
   (mestendels `riders`/`race_entries`/`race_stage_schedule`/`profiles`
   single-team/single-race-scoped, verificeret sikre i dag men ikke
   individuelt annoteret) — kun NYE overtrædelser fejler builden.

## Forhindret-fremover
`scripts/lint-pagination-guard.mjs` (+ 33 tests, inkl. baseline-tests) kører i
`preflight-pr.ps1` og et dedikeret CI-job (`pagination-guard`). Break-glass:
`// pagination-safe: <begrundelse>`-kommentar. Ny upagineret select mod en
deny-listet tabel i en fil UDEN eksisterende baseline-tilladelse → rød build.

## Læring
"Verdens klasse"-niveau for en forward-guard er ikke bare "flag alt" — en
naiv `.from(table)`-scan havde givet 260+ falske positiver (mutationer,
count-only head:true-queries, allerede-paginerede deferred-query-mønstre).
Præcision (scope til genuine `.select()`-læsninger, genkend
`fetchAllRows*`-delegering, genkend `let query = …; query = query.range(…)`)
er det der gør guarden brugbar nok til faktisk at blive kørt i CI uden at
blive slukket af udviklerfrustration. Når audit-fladen er for stor til at
rette/annotere ALT i én PR (~120 verificeret-sikre fund), er en
baseline-ratchet den rigtige afvejning — guarden bliver LIVE mod nye
regressioner samme dag, uden at blokere på en uges annotationsarbejde.

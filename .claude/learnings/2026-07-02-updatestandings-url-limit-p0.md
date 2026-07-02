# 2026-07-02 — P0: updateStandings' ubegrænsede `.in(alle-sæson-race-ids)` dræbte hele resultat-pipelinen i 44 timer

## Hvad skete
Division 4-aktiveringen (PR #2065, 30/6 21:19 UTC) løftede sæsonen fra 263 til 455 løb. `updateStandings` sendte ALLE sæsonens race-ids i ét `.in("race_id", ...)`-filter → querystreng ~17K tegn → fetch fejlede hårdt (lokalt "TypeError: fetch failed"; i prod HTML-fejlside, Sentry CYCLINGZONE-1J/1K/1H). Første fejlende run 21:33 — 14 minutter efter udløseren.

Fordi `updateStandings` kører MIDT i `simulateStageByIndex`-kæden (efter result-write, før persistRuns/fatigue/finalization/status-flip/præmie), knækkede ALT nedstrøms på hvert etape-run: rangliste frosset (149/171 hold ude af sync, 63 % af point manglede), 13 fuldt kørte løb sad fast uden præmier (1,43M CZ$), 0 resultater skrevet efter 1/7 17:04. Recovery-stien fandtes men var uopnåelig (409-guard + scheduler-selektion). Spillerne opdagede det (Discord 1/7) før noget alarmsystem — per-løb-fejl var kun console.error.

## Rod-årsager (flere lag)
1. **Skalerings-antagelse i query-design:** `.in()` med en liste der vokser med kalenderen. Virkede ved 263, døde ved 455.
2. **Én fejl i midten af en ikke-atomar kæde** vælter alle efterfølgende trin — og counter-bumpet FØR crashen gjorde tilstanden selv-blokerende.
3. **Recovery-sti som død kode:** `finalizationPending` kunne aldrig nås (409-guard i runAdminSimulateStage + schedulerens næste-etape-krav).
4. **Silent failure:** console.error uden Sentry i per-løb-catch.
5. **Data/kalender-drift:** div 4-kalender materialiseret i puljer med 0 hold + fortids-slots → 4.600 støjfejl/døgn der maskerede den ægte fejl.

## Fix (PR #2087)
Chunk `.in()` (120 ids) · recovery gjort opnåelig (guard + scheduler-selektion af finalization-pending) · skip løb i tomme puljer · `races!inner`-filter mod PostgRESTs 1000-rækkers cap (ville ellers have stoppet afvikling ~24-26/7) · Sentry-capture med per-løb-per-dag-dedup.

## Efterspil samme dag (#2090): catch-up udløste overlappende ticks → 10 etaper kørt FØR tid

Post-fix-catch-uppen gjorde et scheduler-tick længere end 5 min → `setInterval` startede næste tick OVENI (ingen job-lås, #330). Hvert tick udvalgte løb ud fra sit eget forældede races-snapshot, og `runAdminSimulateStage` kørte "næste etape" ud fra frisk `stages_completed` UDEN selv at tjekke om den var forfalden — tidsgaten lå kun i udvælgelsen. Resultat: Volta Algarvia st2-3 (pulje 4-7) + Hauts Plateaux st8 (pulje 2-3) kørte op til 23,7 timer for tidligt. Fix (PR #2091): overlap-guard (ét tick ad gangen) + expectedStageIndex-guard (409 ved mismatch — en etape kan aldrig afvikles medmindre det er præcis den udvalgte). Ejer-beslutning: resultaterne lades stå; resten kører til tiden.

**Ekstra læring:** et recovery-/catch-up-flow ændrer belastningsprofilen — genbesøg alle "det når aldrig at overlappe"-antagelser (intervaller, låse, idempotens) FØR man slipper en stor backlog løs. Og: enhver executor skal selv validere sin forudsætning (etape = forfalden), ikke stole på at udvælgeren gjorde det i samme øjebliksbillede.

## Læringer / forward-guards
- **Grep-regel:** ethvert `.in(<liste der vokser med data>)` er en tikkende bombe — brug chunking eller server-side join-filter. Auditér ved kalender-/populationsudvidelser.
- **Kalender-/katalog-udvidelser er systemændringer:** div 4-PR'en ændrede "kun data", men datamængder ER adfærd. Dry-run af ét scheduler-tick mod den nye datamængde havde fanget det på 5 min.
- **Recovery-stier skal have en kaldbar vej** — en idempotent recovery ingen kan trigge er falsk tryghed. Test: "kan systemet hele sig selv fra tilstand X uden kodeændring?"
- **Watchdog på tilstand, ikke kun exceptions** (#2077): "løb færdigkørt men ikke completed i >2t" havde fanget dette uanset fejltype.
- Materialisér aldrig løb i puljer uden hold / med scheduled_at i fortiden (#2075).

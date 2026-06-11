# 2026-06-11 · Rehearsal fangede dry-run-default-bug i relaunch-orchestratoren (#1191/#1103)

## Symptom
Første ægte apply-kørsel af relaunch-orchestratoren (generalprøve #1191, disposabel Supabase-branch) fejlede midtvejs: `Season 00000000-0000-0000-0000-000000000000 not found` i `transitionToNextSeason`. Dry-run og alle 1353 unit-tests var grønne.

## Rod-årsag
`seedSeasonZero(supabase, { startDate, dryRun = true })` har **dry-run som default**, og apply-grenen i `relaunchOrchestrator.js` kaldte den uden eksplicit `dryRun: false` → sæson-0-rækken blev aldrig indsat; transitionen slog op på den deterministiske nul-UUID og fandt intet. Unit-testene fangede det ikke, fordi deps-mocken (`makeDeps`) ignorerede argumenterne — sekvensen så korrekt ud, men kontrakten (hvilke args der sendes) var utestet.

## Fix
Eksplicit `dryRun: false` i apply-grenen + regressionstest der asserterer argumentet (mocken optager nu `opts.dryRun`). Empirisk re-verificeret: fuld rehearsal 9/9 PASS efter fix.

## Forward-guards / læringer
1. **Sikre-default + glemt override = klassisk fælde.** Funktioner med `dryRun = true`-default er sikre i isolation, men flytter risikoen til call-sites. Ved nye orchestrator-byggeklodser: overvej *required* `dryRun`-parameter (ingen default) i interne API'er, så manglende stillingtagen er en TypeError, ikke et silent no-op.
2. **DI-mocks skal optage argumenter, ikke kun kald-rækkefølge.** En mock der ignorerer opts kan ikke fange kontraktbrud. `makeDeps`-recorderen optager nu `dryRun` for alle byggeklodser.
3. **Dry-run-symmetri er ikke bevis.** Dry-run sprang netop reset/sæson/transition over by-design — de trin KAN kun verificeres med ægte writes. Generalprøve mod disposabel DB er den eneste test der dækker dem; den fandt bug'en på første apply. Bekræfter simulér-før-ship-reglen for alle destruktive kæder.
4. **Re-seed-procedure efter delvist apply** er nu dokumenteret i `docs/audits/2026-06-11-relaunch-rehearsal.md` §6 (truncate-alt + re-seed + baseline-verify, <1 min via MCP).

# Postmortem · 2026-08-03 · economyEngine.test.js worker-IPC-flake (#3172)

## Hvad skete der?
`backend-tests`-CI-jobbet fejlede 2x samme dag (31/7, #3169 og #3171) med præcis
1 fejlende fil: `lib/economyEngine.test.js`, med en runner-intern fejl
`Unable to deserialize cloned data due to invalid or unsupported version`
(`node:internal/test_runner`). Alle 102/102 testcases i filen var grønne når
filen kørte isoleret, og resten af suiten (4729/4730) var grøn. Set lokalt i
`scripts/verify-local.ps1` 31/7 også — ikke PR-specifikt.

## Root cause
`economyEngine.test.js` er langt den største backend-testfil (103 tests,
6513 linjer, ~250KB — mere end dobbelt så stor som næststørste fil,
`auctionFinalization.test.js` på 2753 linjer). Node's testrunner starter én
child-worker pr. testfil og streamer testresultater tilbage til
parent-processen via IPC (structured clone over en socket). Med 344
testfiler kører op til ~8 workers samtidigt (CPU-parallelisme). Den store
fils resultat-payload er tilsyneladende stor nok til at ramme en kendt
buffer-parsing-bug i Node's testrunner (`nodejs/node#64061`): en
signed/unsigned-fejl i `processRawBuffer`, rettet upstream i
`nodejs/node#64706` (merged 2026-07-26) — men den rettelse er endnu ikke i
vores pinnede Node 24.x-linje (`engines: >=24.0.0 <25`, lokal `v24.16.0`).
Bugklassen trigges kun ved samtidig IPC-trafik fra mange workers, hvilket
forklarer hvorfor filen ALTID er grøn isoleret og KUN flaker i fuld suite.

## Fix
`backend/scripts/run-tests.js` (nyt): kører `lib/economyEngine.test.js`
alene i pass 1 (ingen samtidig worker-trafik at kollidere med), derefter alle
øvrige ~343 testfiler i pass 2 med samme flags/default-concurrency som før,
via eksplicitte RELATIVE filstier (ikke absolutte — 344 absolutte stier
rammer Windows' ~32.767-tegns CreateProcess-kommandolinjegrænse og
`spawnSync` fejler med `ENAMETOOLONG`; relative stier er ~10.500 tegn, rigelig
margin). CLI-args (`--test-reporter=spec`) videreføres til begge pass.

`backend/package.json`: `"test"` peger nu på `node scripts/run-tests.js`
(den ene tilladte package.json-undtagelse — ingen dependency-/lockfile-ændring).

`scripts/verify-local.ps1`: kaldte tidligere `node --test` DIREKTE (uden om
npm og uden `--import ./test-setup.js`) — opdateret til at kalde samme
`run-tests.js`, så lokale pre-push-kørsler får samme beskyttelse (den var
netop hvor flaket også blev set 31/7).

Ingen dependency- eller package-lock.json-ændringer. Ingen blind retry —
den valgte løsning fjerner selve race-betingelsen (samtidighed) i stedet for
at maskere en lejlighedsvis fejl.

## Forhindret-fremover
Stress-verificeret med 5 på hinanden følgende `npm test`-kørsler lokalt:
103/103 + 4773/4773 grønt, exit 0, hver gang — ingen deserialize-fejl.
Acceptkriteriet fra #3172 (2 ugers flake-fri CI på denne signatur) verificeres
efterfølgende i CI over tid.

## Læring
En enkelt unormalt stor testfil i en ellers homogen testsuite er ikke kun et
læsbarheds-/vedligeholdelsesproblem — den kan trigge infrastruktur-bugs
(her: Node's eget testrunner-IPC) som kun viser sig under samtidighed, aldrig
isoleret. Når en test-only-fejl er 100% reproducerbar i fuld suite og 0%
isoleret, er "kør den isoleret" (test-script-niveau isolation) ofte den mest
målrettede fix — billigere og mere deterministisk end en Node-version-bump
eller en retry-wrapper, og den fjerner selve race-betingelsen frem for at
maskere den. Bonus-gotcha: pas på Windows' kommandolinjelængde-grænse
(~32K tegn) når man bygger en eksplicit filliste til `spawnSync`/`execFile` —
brug relative stier, ikke absolutte, med mange filargumenter.

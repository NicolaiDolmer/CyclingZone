# Postmortem · 2026-09-04 · feature-liveness-audit fejlede paa statement_timeout

## Hvad skete der?
CI-jobbet "audit" (feature-liveness-audit.yml) fejlede 4/9 paa PR #4754 med
`feature_liveness_table_counts RPC failed (other): canceling statement due to
statement timeout`. PR #4754 handlede om noget helt andet (AI-trim-alarm-
dedupe) - auditten koerer paa enhver PR der roerer backend/frontend/database,
saa fejlen var stoej uden relation til selve PR'ens diff.

## Root cause
`feature_liveness_table_counts()` (database/2026-05-10-feature-liveness-
helper.sql) looper over ALLE public-tabeller (257 stk, ~254k rows i alt) og
koerer et sekventielt, exact `EXECUTE format('SELECT COUNT(*) FROM public.%I', ...)`
pr. tabel - hele loopet er ÉT statement, og service_role arver database-
defaulten `statement_timeout=2min` (ingen rolconfig-override). Malt live er
normal-case hurtigt (~960ms for alle 257 tabeller via EXPLAIN ANALYZE), men et
enkelt COUNT(*) kan blive staaende hvis en anden session holder et exclusive
lock paa netop den tabel (samme mekanisme som #3013's REFRESH-uden-
CONCURRENTLY-laas paa ranglister, blot her potentielt en "_mv"-navngivet
tabel der refreshes via TRUNCATE+INSERT i stedet for en rigtig materialized
view). Uden et loft venter loopet til hele funktionens 2-minutters-budget
rammer, og HELE auditten fejler paa ÉT laast bord.

## Fix
`database/2026-09-04-4754-feature-liveness-count-lock-timeout.sql`: tilfoejer
`SET LOCAL lock_timeout = '3s'` inde i funktionen; ved `lock_not_available`/
`query_canceled` falder DEN tabels raekke tilbage til `pg_class.reltuples`
(estimat) og markeres `estimated=true` i stedet for at kaste hele RPC'et.

`backend/scripts/audit-feature-liveness.js` (Detector A): en `estimated=true`
raekke med `row_count=0` er IKKE nok evidens for "doed feature" (reltuples kan
vaere stale/0 lige efter tabellens foerste rows, foer autovacuum-analyze), saa
`evaluateDetectorARow` springer den over i stedet for at flage falsk-positivt.
`fetchTableCounts()` faar desuden 2 retries m. backoff (1s/3s), men KUN paa
den nye `statement-timeout`-fejlklasse (audit-error-classifier.js) - et
sekundaert sikkerhedsnet, ikke den primaere fix.

## Forhindret-fremover
- Per-tabel lock_timeout betyder ét laast bord koster max 3s, ikke 2 min.
- `estimated`-flaget + skip-logikken forhindrer at fallback-estimatet
  introducerer nye falske Detector A-fund.
- 2 nye tests i audit-feature-liveness.test.js (estimeret 0 springes over vs.
  exact 0 flager stadig) + 3 nye tests i audit-error-classifier.test.js
  (statement-timeout klassificeres og markeres retryable) forhindrer regression.

## Læring
En "audit alt"-loop-funktion der koerer mange smaa operationer som ÉT
statement er saarbar overfor at ÉT langsomt/laast element aeder hele
tidsbudgettet og fælder resten. Naar praecision ikke er kritisk for hver
enkelt maaling (her: kun "0 vs. >0" betyder noget), er et per-element lock/
timeout + graceful estimat-fallback billigere end enten (a) at haabe laase
aldrig sker, eller (b) at haeve det globale statement_timeout (som blot
forsinker samme fejlklasse).

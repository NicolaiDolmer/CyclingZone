# Postmortem · 2026-08-31 · verify_race_result_duplicates timede ud mod prod

## Hvad skete der?
Kalender-invariant-audit (natlig, 03:50 UTC) døde hver nat på RPC'en
`verify_race_result_duplicates`: `HTTP 500 - 57014 canceling statement due to
statement timeout`, målt ~9 s ind i kaldet (job 99330723336, 30/8). #4204
havde netop flyttet dublet-optællingen fra ~1.130 PostgREST-kald til ét
RPC-kald og gjorde den derfor synlig først nu — #4477 fjernede samtidig den
maskerende `tee`-fejl fra #4463, så vagten begyndte at rapportere ærligt.

## Root cause
To ting, ikke én:

1. **Rolle-GUC'er evalueres ved login, ikke ved SET ROLE.** PostgREST logger
   ind som `authenticator` (statement_timeout=8s) og skifter FØRST derefter
   rolle til `service_role` inde i transaktionen. `service_role` selv har
   intet rolconfig sat — men den effektive timeout forbliver `authenticator`s
   8s, fordi rolle-niveau GUC'er kun sættes ved login, ikke ved en efterfølgende
   `SET ROLE`. Det er ikke synligt før man slår `pg_roles.rolconfig` op for
   BEGGE roller og forstår PostgREST's login→SET ROLE-mønster.
2. **Funktionen var reelt for tæt på/over de 8s.** Målt mod prod (1.211.578
   rækker, op fra 1.128.609 ved #4204's måling en uge før): ~5,3-7,1s, med to
   selvstændige spild: (a) rang-dublet-grupperingen havde intet dækkende
   index → Parallel Seq Scan + HashAggregate med op til 126 MB disk-spild,
   fordi næsten hver gruppe er unik og hash-tabellen derfor bliver næsten lige
   så stor som inputtet; (b) `rider_keys`-CTE'en blev refereret 3 gange, og
   hver reference var en dyr disk-genlæsning af et work_mem-overskredet
   materialiseret resultat.

## Fix
`database/2026-08-31-4507-race-result-duplicate-rpc-perf.sql`:
- Nyt dækkende partielt index `idx_race_results_rank_dupe_check` på
  (race_id, stage_number, result_type, rank) INCLUDE (id) WHERE rank IS NOT
  NULL — gør rang-siden til Index Scan + streaming GroupAggregate.
- `CREATE FUNCTION ... SET work_mem TO '64MB' SET statement_timeout TO '25s'`
  — kun DENNE funktion får længere reb, `authenticator`s 8s er uændret for alt
  andet.
- CTE'erne omstruktureret så rider_key_count/duplicate_key_count beregnes i
  ÉT scan (aggregate FILTER) i stedet for 3.

## Forhindret-fremover
- Ækvivalenstesten (`raceResultDuplicateRpc.integration.test.js`) kører nu
  BEGGE migrationsfiler (#4204 + #4507-perf) mod PGlite og sammenligner mod
  den originale JS-reference — enhver fremtidig "optimering" af RPC'en der
  ændrer facit fanges automatisk, byte for byte inkl. rækkefølge.
- `sanitizeForPglite.js` omskriver nu `CREATE INDEX CONCURRENTLY` til
  `CREATE INDEX` i stedet for at fejle — gør FREMTIDIGE CONCURRENTLY-
  migrationer PGlite-testbare (de to eksisterende, #4010 og #2895, kunne ikke
  testes indtil nu).

## Læring
Når en RPC/API-funktion timer ud "uforklarligt tæt på" en rund timeout-værdi
(8s, 30s, …), tjek ALTID `pg_roles.rolconfig` for BÅDE login-rollen
(`authenticator` i Supabase) og den rolle funktionen faktisk kører som
(`service_role`) — den effektive timeout er login-rollens, ikke den
udførende rolles, fordi Postgres' rolle-GUC'er sættes ved login og IKKE
genberegnes ved `SET ROLE`. `service_role` uden eget rolconfig betyder
"arver session-GUC'en fra login", ikke "ingen grænse". Og: `count(DISTINCT x)
FILTER (...)` og `SELECT DISTINCT x` er IKKE ombytbare når `x` kan være
NULL — `count(DISTINCT ...)` springer NULL over, `SELECT DISTINCT` giver
NULL sin egen gruppe. Fanget her af den randomiserede 40-iterations
PGlite-sweep, ikke af manuel gennemlæsning.

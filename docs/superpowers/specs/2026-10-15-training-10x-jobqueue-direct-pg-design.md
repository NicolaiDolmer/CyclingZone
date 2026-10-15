# Træningsafregningen ved 10x: baseline, job-kø (#6491) og direkte Postgres (#6492)

> **Refs:** #6490 · #6491 · #6492 · #6184 · **Status:** design + målt baseline (AGENTS hard rule 36), ingen kode. Read-only prod-måling 15/10 kl. 13:06.
> Ejer-beslutninger står som A/B-kort på #6490 (DROP INDEX), #6491 (worker-placering) og #6492 (bibliotek).

## 1. Målt baseline for aftenspidsen

15/10-aftenen var ikke kørt ved målingen (13:06): **ikke målt**.

| | 11/10 (før #6538) | 13/10 (efter #6538) | 14/10 (efter #6538) |
|---|---|---|---|
| Afregninger (training_day_runs, 19:55-21:30) | 1.381 | 1.411 | 1.424 |
| Hold | 405 | 407 | 408 |
| Første → sidste afregning | 20:04:18 → 20:34:56 (30,6 min) | 20:03:42 → 20:53:49 (50,1 min; hul 20:40-20:45) | 19:58:30 → 20:37:43 (39,2 min) |
| commit_training_date_tick-kald (edge_logs) | 1.298 | 1.252 | 1.211 |
| p50 / p95 / p99 (ms, origin_time) | 206 / 398 / 606 | 243 / 473 / 793 | 250 / 490 / 831 |
| Max | 45,6 s | 47,4 s | 50,4 s |
| Kald > 2 s | 8 | 9 | 9 |
| Samlet DB-svartid for kaldene | 564 s | 674 s | 666 s |
| WAL i aftenvinduet (hele DB, checkpoint-LSN) | 1,19 GB på 28 min (issue-måling) | 2,18 GB (19:59→20:59) | 2,00 GB (20:04→20:49) |
| Checkpoints | write=272 s (10/10) | hver 5. min, write≈270 s, op til 48.678 buffers (37,1 %) | hver 5. min, write≈270 s, op til 32.273 buffers (24,6 %) |
| Statement timeouts | ikke målt | 0 | 2 (20:40:49 og 20:40:55, `get_season_recap` som authenticated, 8 s-loft; ikke træning) |
| Lock waits / deadlocks i log | ikke målt | 0 | 0 |
| 5xx på commit-kald | 0 | 0 | 0 |

Kumulativt (pg_stat_statements, nulstillet 6/10 15:53): 12.183 kald, 13,85 GB WAL = **64 % af al WAL i databasen** (21,49 GB). Delta siden 11/10 22:44: +4.112 kald, +5,42 GB WAL = **1,32 MB pr. kald** (før: 1,04 MB). Max nu **54.981 ms**; service_role har `statement_timeout=60s`.

Fordelingen er tydeligt todelt: p99 er under 1 s, men 8-9 kald pr. aften tager 25-50 s. Det passer med GIN pending-list-flush (staging-forsøget 12/10: det langsomste kald skrev 125,5 MB WAL, heraf 124,8 MB GIN).

**#6538 har ikke gjort aftenen hurtigere.** Det var heller ikke forventet: GIN vedligeholdes stadig ved hver afregning, og den nye trigger skriver lidt ekstra. Tallene er lidt værre (p95 398 → 473-490 ms, max 45,6 → 50,4 s, WAL pr. kald 1,04 → 1,32 MB). Med kun 2 aftener er det støj eller vækst; der er ingen evidens for regression fra #6538 selv.

**Vinduesmålingen er lavet på spidsen af afregningerne.** Samlet DB-tid er ca. 11 min, men vinduet varer 39-50 min. Holdene afregnes ét ad gangen med ca. 40-50 afregninger pr. minut (gab inden for et hold: p50 ≈ 1,1-1,3 s). DB-tiden pr. kald er p50 ≈ 0,25 s. Resten af tiden går i backend-løkken: læsninger, beregning og PostgREST-rundture. Det er målt som gab; fordelingen inden i backenden er **ikke målt**.

Spillervendt API 20:00-20:15 (rest-kald, ikke træning):

| | 13/10 rolig 19:30-19:45 | 13/10 spids | 14/10 rolig | 14/10 spids |
|---|---|---|---|---|
| Kald | 7.032 | 19.511 | 14.308 | 22.370 |
| p50 / p95 / p99 ms | 31 / 137 / 349 | 26 / 116 / 283 | 35 / 179 / 441 | 24 / 76 / 180 |
| Max | 4,3 s | **75,5 s** | 4,4 s | **22,0 s** |
| > 5 s | 0 | 3 | 0 | 1 |
| 5xx | 0 | 0 | 0 | 0 |

Ved 1x mærker spillerne det i median og p99 ikke. Der er enkelte haler: 3 kald over 5 s, det ene på 75 s.

**DB Health 12/10 (run 38257146867) er rettet ved kilden:**
- "with s as (select id from seasons ...) tick_date/game_day", 914 MB temp × 1 kald: forespørgslen er en **engangs-analyse via MCP 9/10 19:43** (pg_stat_statements-tekst: `-- source: POST /mcp`, rolle postgres, 55 s, 117.025 temp-blokke). Det er ikke app-kode og ikke afregningen. Handling: ingen kodeændring. Lær af den: ad-hoc-analyser over `report` skal begrænses i dato/LIMIT.
- "WITH pgrst_source ... 385 MB/kald × 6": det er **temp-spild pr. RPC-kald**, ikke en payload-størrelse. Det bedste match i dag er `verify_race_result_duplicates` (service_role, nu 27 kald, gns. 52.611 temp-blokke ≈ 411 MiB/kald). Det er en antagelse; DB Health afkorter forespørgselsteksten. Det er ikke træningsstien og hører under #6184/DB Health.

## 2. Ejer-kort: DROP INDEX

Se kommentaren på #6490 (fakta, risiko, rollback og A/B). Kort: indekset `idx_training_day_runs_report_riders` er 1.033 MiB, er ikke brugt siden 12/10 18:38 og koster stadig vedligeholdelse ved hver afregning. Udføres kun på ejer-go, som `DROP INDEX CONCURRENTLY` uden for 19:30-21:00.

## 3. (a) 10x-kapacitet: hvad brister først
1x = ca. 1.210-1.300 afregninger pr. aften, 405-408 hold. 10x = ca. 12.500-13.000.
1. **Vægur-tid brister først.** Serielt med ca. 40-50 afregninger pr. minut tager 10x **ca. 4,2-5,4 timer**. Det er lineær fremskrivning, ikke målt ved 10x. Ejermålet er < 2 min efter sidste etape; allerede 1x (39-50 min) er over.
2. **60 s-loftet.** Max er 55,0 s i dag mod service_role `statement_timeout=60s`. GIN vokser ca. 54 MB/døgn ved 1x, og flushes rammer større indeks. Ved 10x må vi forvente kald, der bliver dræbt. Det er en antagelse; ingen 10x-måling.
3. **WAL/checkpoint.** 2,0-2,2 GB pr. aftenvindue ved 1x giver ca. 20 GB ved 10x (lineært, antagelse). max_wal_size=4 GB, så der kommer requested checkpoints og flere full-page writes. Checkpoints skriver allerede op til 37 % af shared_buffers pr. runde.
4. Forbindelser og samtidighed, hvis afregningen paralleliseres for at løse punkt 1: max_connections=120 og PostgREST-poolen. **Ikke målt.**
Konklusion: DROP INDEX (punkt 2-3) og parallel kø (punkt 1) er begge nødvendige. Ingen af dem er nok alene.

## 3. (b) #6491 job-kø
| | pg-boss | Supabase Queues (pgmq) | BullMQ (Redis) |
|---|---|---|---|
| Benefit | Node-native; retry, backoff, singletonKey/idempotens, cron-planlægning, dead-letter, concurrency pr. worker; bor i Postgres | SQL-native, Supabase-dashboard, kan kaldes via rpc uden ny forbindelse | Moden, hurtig |
| Cost | Ny dependency + `pgboss`-schema; kræver direkte PG-forbindelse (#6492), session-mode/direct anbefales | Ingen retry-politik, cron eller concurrency i klienten; vi skal selv bygge worker-loop, visibility-timeout og dead-letter | Ny infrastruktur (Redis) = ny løbende udgift; data uden for Postgres |
| Alternativ | - | Godt til simple køer fra SQL-triggere | Afvist: ejerens regel om ingen nye udgifter før indtægt |

**Anbefaling: pg-boss.** Første job er træningsafregningen: ét job pr. (team_id, tick_date, squad) med `singletonKey`, concurrency 4-8. Tallet skal vælges ud fra måling; forbindelsesloftet er **ikke målt**. Den eksisterende RPC er allerede idempotent via unik nøgle (`uniq_training_day_runs_team_season_squad_game_day`).

**Railway worker-proces:** separat service med samme image og startkommando `node worker.js`. **Beslutning for ejeren:** en ekstra Railway-service er en ny løbende udgift, og beløbet er **ikke målt**. Billigere alternativ: workeren kører som separat proces i den eksisterende service. Så overlever jobs deploy (de ligger i Postgres), men der er ingen isolation fra web-processen.

## 3. (c) #6492 direkte Postgres
| | postgres.js | Kysely (+ postgres.js/pg-dialekt) |
|---|---|---|
| Benefit | Lille, hurtig; `sql.begin()`-transaktioner; tagged templates; passer til eksisterende SQL-funktioner | Typet query builder; kysely-codegen fra schema; fanger kolonnefejl ved build |
| Cost | Typer skal genereres og vedligeholdes separat (fx `supabase gen types`) | Ekstra lag og læring; giver mest værdi ved mange dynamiske queries |

**Anbefaling: postgres.js nu, Kysely senere hvis query-mængden vokser.** Forbindelse: Supavisor **transaction mode (6543) med `prepare: false`** til korte job-transaktioner. pg-boss bruger session mode (5432) eller direct, fordi den holder længere sessioner. Mønster: én transaktion pr. (hold, dato) med `SET LOCAL statement_timeout` og `SET LOCAL lock_timeout`. Kald den eksisterende `commit_training_date_tick` i samme transaktion; skriv ikke logikken om i første skridt. Typer: genereret fra `database/schema-snapshot.json`/`supabase gen types` og tjekket i CI. PostgREST beholdes til frontend under RLS.

## 4. Målplan (før/efter, samme forespørgsler som baseline ovenfor)
Pr. aften: antal afregninger; p50/p95/p99/max fra edge_logs `origin_time` (efter #6492: fra worker-log); **antal > 2 s (mål 0)**; samlet DB-tid; første → sidste afregning og **sidste etape → sidste afregning (mål < 2 min)**; WAL i vinduet (checkpoint-LSN) og pr. kald (pss-delta); GIN-størrelse pr. døgn (indtil drop); statement timeouts/lock waits i postgres_logs; spillernes rest-p95/p99/max 20:00-20:15 mod rolig 19:30-19:45. 10x: lokal PG17-kopi af de berørte tabeller (#5904-harness) ved 1x og 10x, før merge.

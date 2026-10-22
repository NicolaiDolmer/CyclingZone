# Job-kø (#6491) og direkte Postgres (#6492): målt baseline 16-22/10 og design

> **Refs:** #6491 · #6492 · #6490 · #6766 · #5911 · #6184 · **Status:** målt baseline + design (AGENTS hard rule 36). Ingen kode, ingen migration, ingen flag- eller konfig-ændring.
> **Bygger på:** [`2026-10-15-training-10x-jobqueue-direct-pg-design.md`](2026-10-15-training-10x-jobqueue-direct-pg-design.md) (#6655). Den spec dækker træningsafregningen alene og valget af bibliotek. Denne spec måler igen efter GIN-droppet (#6663) og dækker hele `backend/cron.js`: hvilke timere der kører i web-serveren, i hvilken rækkefølge de flyttes, og hvordan hvert skridt rulles tilbage.
> **SSOT for afregningens kontrakt:** [`docs/TRAINING_RULES.md`](../../TRAINING_RULES.md) (tick-enheden og idempotens-låsen). Intet her ændrer den.

## 0. Fastfrysning til efter sæsonskiftet 25/10

**Aftenafregningen (træningslukningen, cron-jobbet `training-day-close`) røres ikke før efter sæsonskiftet S4 → S5 søndag 25/10.** Det gælder kode, flag, `app_config`-nøgler (også `training_day_close_team_concurrency`), migrationer og deploy-tidspunkter der rammer aftenvinduet 19:30-21:00. Tidligst 26/10, og kun med ejer-go pr. skridt. Grunden: sæsonskiftet er ugens største prod-hændelse ([generalprøven 17/10](../../audits/2026-10-17-saesonskifte-generalproeve.md)), og en ændring i afregningen samme uge ville gøre det umuligt at skille fejl fra hinanden.

Dette dokument er kun design. Selv trin 0 i §5 bygges først efter 25/10.

## 1. Målt baseline (prod, read-only, 23/10)

Kilder: `training_day_runs` (SELECT), Supabase `edge_logs` (origin_time er databasens svartid uden netværk til Railway), `pg_stat_activity`, `pg_roles`, Sentry. Rå tal og forespørgsler: `balance-internals/6491/2026-10-23-baseline-raw.md` (gitignoreret).

### 1.1 Aftenafregningens varighed

| Aften | Afregninger | Hold | Første → sidste | Vindue | Tid pr. hold p50 / p95 | commit p50 / p95 / p99 | Max commit | Kald > 2 s | Huller > 60 s |
|---|---|---|---|---|---|---|---|---|---|
| 16/10 | 1.394 | 406 | 20:00 → 20:44 | 44,2 min | 5,9 / 8,3 s | 268 / 488 / 650 ms | 1,0 s | 0 | 1 (13,3 min) |
| 17/10 | 1.263 | 263 | 20:00 → 20:29 | 28,8 min | 6,5 / 8,2 s | 276 / 484 / 674 ms | 5,4 s | 1 | 0 |
| 18/10 | 1.251 | 263 | 20:00 → 20:29 | 28,8 min | 6,7 / 8,5 s | 295 / 513 / 691 ms | 0,9 s | 0 | 0 |
| 19/10 | 1.274 | 266 | 20:00 → 20:44 | 43,8 min | 7,3 / 10,1 s | 326 / 636 / 805 ms | 2,1 s | 1 | 2 (11,7 min) |
| 20/10 | 1.288 | 268 | 20:00 → 20:35 | 35,0 min | 6,9 / 8,7 s | 332 / 590 / 790 ms | 1,9 s | 0 | 1 (4,8 min) |
| 21/10 | 1.275 | 267 | 20:00 → 20:30 | 30,0 min | 6,8 / 8,9 s | 324 / 558 / 736 ms | 1,4 s | 0 | 0 |
| 22/10 | 1.263 | 263 | 20:00 → 20:31 | 30,8 min | 7,1 / 9,0 s | 338 / 603 / 793 ms | 1,7 s | 0 | 0 |

"Tid pr. hold" er afstanden mellem to holds sidste afregning. Holdene afregnes ét ad gangen: `training_day_close_team_concurrency` mangler stadig i `app_config` (målt 23/10), så værdien er 1. 5xx på commit-kaldet: 0 alle aftener. Sentry, 14 dage: 2 aftener med én fejlet tick, begge helet ved næste tick.

**Læsning:**
- **GIN-droppet virker stadig.** Max commit er 0,9-5,4 s mod 45-55 s før 15/10, og 0-1 kald pr. aften er over 2 s.
- **Holdtallet faldt 17/10** fra ca. 406 til ca. 265, fordi hold uden division ikke længere får en tick (#6536). Afregninger pr. hold steg til ca. 4,8 (én pr. løbsdag).
- **Vinduet er stadig 29-44 min**, mod ejermålet < 2 min efter sidste etape (#5911). DB-tiden i commit-kaldet er ca. 6-7 min pr. aften (335-437 s). Resten af tiden går i backend-løkken.
- **Hullerne er ventetid, ikke nedbrud.** 19/10 kørte backenden videre i hullerne (edge_logs), og `race_results`-trafikken toppede kl. 20:30 og 20:38, dvs. sene løbsafslutninger. Afregningen samler de resterende hold op ved næste 5-minutters tick. Railway-deploytider kunne ikke læses i denne session (CLI ikke logget ind), så at et deploy har ramt et hul er **ikke udelukket**, men edge_logs peger på ventetid.
- **Starten er bundet til klokken 20, ikke til sidste etape.** Første afregning kommer 20:00:30 hver aften (urkadence 5 min + 25 s).

### 1.2 Antal kald pr. afregning

Backend-kald (supabase-js fra Railway) 22/10, 20:00-20:32 mod 19:28-20:00, opdelt pr. sti: ca. **34.000 ekstra kald** for 1.263 afregninger.

| | Pr. afregning | Pr. hold (ca. 4,8 afregninger) |
|---|---|---|
| PostgREST-rundture i alt | **ca. 27** | ca. 130 |
| heraf `app_config`-opslag (flag) | ca. 5,4 | ca. 26 |
| heraf læsninger (`training_*`, `rider_*`, `team_*`, `race_*`) | ca. 20 | ca. 95 |
| heraf RPC (`register_training_date_work`, `commit_training_date_tick`) | ca. 2,2 | ca. 10 |

Rundturene kører efter hinanden. Med en databasesvartid på ca. 25-40 ms pr. læsning (p50) plus netværk Railway → Supabase giver det størstedelen af de ca. 1,2-1,5 s pr. afregning, før commit-kaldet. Fordelingen inde i backenden (netværk mod beregning) er **ikke målt**; tallet er en afledning af deltaet, og en lille del af deltaet kan være spillertrafik, der også stiger kl. 20.

### 1.3 PostgREST-loftet

| | 22/10 (24 t) |
|---|---|
| Backend-kald i alt | ca. 1,10 mio. (heraf 857.000 mod `/rest/v1`) |
| Svar der ramte 1.000-rækkers loftet (første side fuld) | 9.919 |
| Ekstra sider hentet pga. loftet | 43.599 (ca. 4 % af alle backend-kald) |
| Største pagineringskilder | `race_results`, `riders`, `rider_training_scores`, `race_entries`, `rider_derived_abilities` |
| `app_config`-opslag | 102.207 (ca. 9 % af alle backend-kald) |
| 5xx | 0 |

Rammer: service_role `statement_timeout=60s`; `authenticator` (PostgREST) 8 s + `lock_timeout` 8 s; `max_connections=120`, heraf 36 PostgREST-forbindelser og ca. 30 Supabase-interne ved målingen. 179 backend-filer bruger `fetchAllRows`, og to CI-vagter (`scripts/lint-pagination-guard.mjs`, `scripts/lint-postgrest-in-cap.mjs`) findes kun på grund af loftet. Ingen transaktioner i backend-koden; alt der skal være atomisk, ligger i SQL-funktioner.

### 1.4 Timere i web-serveren

`backend/server.js` kalder `startCron()` i `app.listen`, så **alle job kører i web-processen**. `backend/cron.js` er 2.420 linjer og starter **59 timere**:

| Kadence | Antal | Eksempler |
|---|---|---|
| 15 s | 1 | outage-monitor |
| 1 min | 4 | auktioner, race-notify-outbox, push, rangliste-matview |
| 5 min, klokke-alignet | 7 | træning (sweep, day-close), AI-restitution, graduering, spejdere, løntræk, etape-scheduler |
| 5 min | 15 | trup-håndhævelse, udtagelses-advarsel, 5 heal-sweeps, auto-præmie, Discord/e-mail-outboxe, velkomst, cron-heartbeat |
| 15 min | 1 | race-finalize-watch |
| 30 min | 4 | bestyrelse (3), stall-watchdog |
| 60 min | 4 | entry-generator, e-mail dag 1, sæson-dokumentar, abonnements-afstemning |
| 24 t | 17 | gæld, vagter (ejerskab, dobbeltbooking, balance-drift m.fl.), retention, snapshots, Discord-roller, abonnements-vagter, fairplay |
| Vægur (fast dansk tid) | 6 | søndagens værdiopdatering, intake-drip, niveau-gate, e-mail/Discord-digest, e-mail-sundhed |

Plus 25 boot-kørsler, fordi `setInterval(24h)` nulstilles ved hvert deploy (#2389, #4644). Overlap-vagter, genforsøg, deploy-afstand (`DEPLOY_OVERLAP_GRACE_MS`, 5 min) og dags-claims er bygget i hånden pr. job. Ved deploy venter serveren op til 120 s på igangværende ticks (Railway `drainingSeconds=150`); et job der varer længere, afbrydes og samles op af næste tick.

### 1.5 Hvad brister ved 10x

10x ≈ 2.650 hold med løbsdag (fremskrevet fra ca. 265), ca. 12.700 afregninger.
1. **Vægur-tiden, stadig først.** Serielt med ca. 7 s pr. hold: ca. 5,2 timer. Lineær fremskrivning, ikke målt.
2. **Rundture.** Ca. 340.000 PostgREST-kald på aftenen alene for afregningen; med parallelitet 8 ca. 180 kald/s oven i spillertrafikken. Ikke målt.
3. **Forbindelser.** Parallelitet via PostgREST deler poolen med spillerne (36 forbindelser ved målingen). Ikke målt ved last.
4. Commit-kaldets DB-tid (ca. 0,3 s p50) skalerer lineært: ca. 70 min samlet DB-tid ved 10x, fordelt over den parallelitet vi vælger.

## 2. Mål for designet

1. Job overlever deploy: en afbrudt kørsel genoptages uden dubletter.
2. Ét sted for genforsøg, backoff, overlap-vagt og dead-letter i stedet for 59 håndskrevne varianter.
3. Tunge job kører uden for web-processen og uden PostgREST-loftet: én forbindelse, få forespørgsler, transaktioner i koden.
4. Aftenafregningen kan starte, når dagens sidste etape er afsluttet (#5911), og kan køre parallelt på et målt niveau.
5. Gradvist: ét job ad gangen, hvert bag sit eget flag, med tilbagerulning uden deploy.

Ikke-mål: omskrivning af spillogik. `commit_training_date_tick` og de andre SQL-funktioner kaldes uændret.

## 3. Design: job-kø og worker (#6491)

### 3.1 Kø: pg-boss

Valgt 15/10 (#6655) og bekræftet her: pg-boss bor i Postgres (intet nyt infrastruktur-led, ingen ny udgift), har genforsøg med backoff, `singletonKey` med køpolitikken `stately` (højst ét ventende og ét aktivt job pr. nøgle), dead-letter-kø, `expireInSeconds` og planlagte job (`schedule`) gemt i databasen. Det sidste fjerner boot-kørsels-tricket: et 24-timers job nulstilles ikke af deploy, når planen ligger i Postgres. Supabase Queues (pgmq) er ikke installeret i prod og mangler planlægning, genforsøgspolitik og worker-loop.

Skemaet `pgboss` oprettes via en almindelig migration i `database/` (SQL genereret af pg-boss' egen plan-funktion), ikke af `boss.start()` ved første opstart. Workeren starter med automatisk migrering slået fra. Så går skemaet gennem auto-migrate og review som alt andet.

### 3.2 Job-modellen

| Job-type | Nøgle (`singletonKey`) | Politik | Producent |
|---|---|---|---|
| Træningsafregning | `(team_id, season_id, squad, game_day)` = tick-enheden | `stately`, retry 3, backoff | Løbsafslutningen (når en divisions sidste etape i dag er færdig) + sikkerheds-poll hvert 5. min |
| Periodisk vagt / sweep | job-navn + dato eller tidsslot | `singleton` | `schedule()` med tidszone Europe/Copenhagen |
| Outbox-dræn | job-navn | `singleton` | `schedule()` hvert minut / 5. min |

Jobbet bærer kun nøgler, aldrig spildata. Idempotens bevares to steder: køens nøgle forhindrer dubletter i køen, og databasens eksisterende unikke låse (fx `uniq_training_day_runs_team_season_squad_game_day`) forhindrer dobbelt afregning, hvis et job alligevel køres to gange.

### 3.3 Worker-placering (ejer-beslutning, åben siden 15/10)

| | A: separat Railway-service | B: worker-proces i den eksisterende service |
|---|---|---|
| Fordel | Isolation: tunge job påvirker ikke API-svartider; deploy af web genstarter ikke workeren | Ingen ny løbende udgift; samme image og miljø |
| Ulempe | Ny løbende udgift (beløb **ikke målt**) | Ingen isolation: CPU og hukommelse deles; et deploy genstarter begge |
| Overlever job deploy? | Ja | Ja: jobbene ligger i Postgres og genoptages efter genstart |

**Anbefaling: B nu, A når indtægten tillader det.** B giver mål 1, 2, 3 (uden for PostgREST) og 4. Kun API-isolationen venter på A. Workeren startes som børneproces fra `server.js` (eget `node worker.js`) eller i samme proces bag flaget `job_queue_worker_enabled`; valget tages i trin 0 ud fra målt hukommelse.

### 3.4 Producenter og flag pr. job

Hvert job flyttes med sit eget `app_config`-flag `job_queue_owner.<job>` = `cron` | `worker`. Den gamle timer i `cron.js` bliver stående og tjekker flaget ved hver tick: står det på `worker`, springer timeren over. Workeren gør det omvendte. Kun én side kører et job ad gangen, og et flip virker ved næste tick uden deploy.

## 4. Design: direkte typet Postgres (#6492)

### 4.1 Bibliotek og forbindelse

- **postgres.js** (valgt 15/10, #6492). Kysely senere, hvis mængden af dynamiske forespørgsler vokser.
- **To forbindelsesstrenge**, begge via Supavisor-pooleren (IPv4; Supabase' direkte forbindelse er kun IPv6, og om Railway kan nå den, er **ikke verificeret**):
  - pg-boss: session mode (port 5432), pool 2-3.
  - Job-transaktioner: transaction mode (port 6543) med `prepare: false`, pool = valgt parallelitet + 1.
- **Forbindelsesbudget:** `max_connections=120`; i dag ca. 66 i brug ved måling (36 PostgREST). Worker + kø må højst bruge 12 ved start. Supavisor-poolens loft for vores compute-tier er **ikke målt** og måles i trin 0.
- **Rolle:** en egen login-rolle (fx `cz_worker`) med samme tabel-grants som service_role og `statement_timeout=60s` på rollen, ikke `postgres`. Grants-auditten (`scripts/audit-table-grants.mjs`) udvides til rollen. Forbindelsesstrengen ligger i Infisical/Railway som hemmelighed og logges aldrig.

### 4.2 Typer

Typer genereres fra `database/schema-snapshot.json` til en `.d.ts`-fil (eller `supabase gen types`) og tjekkes i CI mod snapshot, så en omdøbt kolonne fejler ved build i stedet for i prod. Forespørgsler skrives som tagged templates med de genererede typer.

### 4.3 Transaktionsmønster

Én transaktion pr. job (for afregningen: én tick-enhed):

1. `SET LOCAL statement_timeout` og `SET LOCAL lock_timeout`.
2. Læs alt holdets afregning behøver i 2-4 forespørgsler (i dag ca. 20 rundture), uden 1.000-rækkers loft.
3. Kald den eksisterende `commit_training_date_tick` uændret i samme transaktion.
4. Commit. Fejl → rollback og pg-boss-genforsøg.

Flag-opslag læses én gang pr. job, ikke pr. kald (i dag ca. 5 `app_config`-opslag pr. afregning).

### 4.4 Hvad PostgREST beholder

Frontendens læsninger under RLS og alle API-ruter forbliver på supabase-js. Pagineringsvagterne trappes kun ned for stier, der er flyttet til postgres.js.

## 5. Migreringsrækkefølge

Hvert trin er sin egen PR med eget flag, egen måling og eget ejer-go før tænding. Intet trin starter før 26/10.

| Trin | Hvad | Hvorfor i denne rækkefølge | Gate før tænding |
|---|---|---|---|
| 0 | Infrastruktur: `pgboss`-skema som migration, worker-proces (B), postgres.js-forbindelse, ét hjerteslag-job. Intet spiljob flyttet. | Beviser forbindelse, rolle, deploy-genstart og hukommelse uden spillerrisiko | Staging: worker dræbes midt i et job → jobbet genoptages én gang. Forbindelsesforbrug målt. |
| 1 | Ét læse-job: en 24-timers vagt (fx ejerskabs-invarianten) via `schedule()` | Ingen skrivninger; beviser at planlagte job overlever deploy uden boot-kørsel | Kører præcis én gang pr. døgn i 3 døgn med deploys imellem |
| 2 | Outbox-drænene (Discord DM/webhook, notify, e-mail-retry) | Allerede idempotente outboxe; naturlige kø-job | Samme sendte antal som før, 0 dubletter |
| 3 | Træningsafregningen som job pr. tick-enhed, læsninger via postgres.js, producent = løbsafslutning + 5-min-poll | Største gevinst (§1); kræver trin 0-2 og målingen af parallel-knappen | #5904-harnessen ved 1x og 10x med parallelitet 1/4/8; staging-aften; paritet 0 afvigelser mod den gamle sti; ejer-go |
| 4 | Andre tunge job: finaliserings-recovery, auto-præmie, heal-sweeps, sæsonskiftets trin | Følger samme mønster | Pr. job: paritet + én rolig dag |
| 5 | Minut-job (auktioner) | Latenskritiske; flyttes sidst, helst når workeren er isoleret (A) | Auktionslukning inden for samme sekund-interval som i dag |

**Ratchet:** fra trin 1 tæller en test antallet af timere i `startCron()`. Tallet må kun gå ned.

## 6. Tilbagerulning

| Niveau | Handling | Tid | Data |
|---|---|---|---|
| Ét job | `job_queue_owner.<job>` = `cron` i `app_config` | Næste tick, ingen deploy | Ingen tab; jobnøgler og unikke låse forhindrer dobbeltkørsel ved skiftet |
| Direkte PG for afregningen | Flag tilbage til supabase-js-stien, som bliver i koden, indtil to rolige aftener er målt | Næste tick | Ingen; samme SQL-funktion begge veje |
| Hele workeren | `job_queue_worker_enabled` = off; alle job falder tilbage til timerne i `cron.js` | Næste tick | Ventende job bliver liggende i `pgboss` og ryddes manuelt |
| Skemaet | `pgboss` bliver stående (uskadeligt). `DROP SCHEMA` kun på særskilt ejer-go | - | Kun kø-metadata, ingen spildata |

Den gamle timer-sti slettes først, når jobbet har kørt på workeren i 14 dage uden tilbagerulning, og så i en separat PR.

## 7. Verifikation og målplan

Samme målinger som §1, før og efter hvert trin, med de samme forespørgsler:
- Aftenafregning: antal, første → sidste, **sidste etape → sidste afregning (mål < 2 min, #5911)**, tid pr. hold p50/p95, commit p50/p95/p99/max, kald > 2 s (mål 0), huller > 60 s.
- Rundture pr. afregning (mål: ≤ 5 mod ca. 27 i dag), `app_config`-opslag pr. døgn, sider ud over loftet pr. døgn.
- Forbindelser i `pg_stat_activity` pr. `application_name` under aftenvinduet.
- Spillernes API p95/p99/max 20:00-20:15 mod 19:30-19:45.
- Deploy-test: et deploy midt i et job må give 0 tabte og 0 dobbelte job.

Gates pr. trin som i [#6655-specens §4](2026-10-15-training-10x-jobqueue-direct-pg-design.md#4-verifikationsplan-gates-før-build-og-før-rollout): lokal (unit + #5904-harness ved 1x/10x), staging, ejer-review med før/efter-tabel, rollout bag flag i et roligt vindue, tilbagerulning uden deploy.

## 8. Ejer-beslutninger

1. **Worker-placering A eller B** (§3.3). Anbefaling B nu. Åben siden 15/10; nødvendig før trin 0.
2. **Startdato for trin 0**: tidligst 26/10, efter sæsonskiftet.

Tekniske valg (pg-boss, postgres.js, Supavisor-modes, rolle, flag pr. job) er truffet her og kan ændres i review.

## 9. Fund uden for scope

- **`app_config`-opslag er ca. 9 % af alle backend-kald** (102.000/døgn), heraf ca. 5 pr. træningsafregning. En kort cache (fx 30 s) på flag-opslag i backenden ville fjerne det meste uden at røre spillogik. Kandidat til eget issue; berører aftenafregningen og falder derfor også under §0.
- Hullerne på 5-13 min i aftenvinduet (16/10, 19/10, 20/10) skyldes sene løbsafslutninger plus 5-minutters polling. Trin 3's producent fra løbsafslutningen fjerner dem.

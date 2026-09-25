# #5692 — team_race_points_mv-refresh: måling + forslag

> INVESTIGATE-spor, 25/9. READ-ONLY mod prod (Supabase MCP `execute_sql`: `SELECT` +
> `EXPLAIN (ANALYZE, BUFFERS)` på matview-definitionen, samt en enkelt
> `BEGIN; SET LOCAL ...; EXPLAIN ANALYZE ...; ROLLBACK;`-transaktion for at måle
> alternative query-planer — ingen `REFRESH`, ingen DDL, intet er skrevet til prod).
> Ingen spiller-hemmelige tal (holdnavne, rytter-id'er, beløb) indgår; alle tal
> herunder er skema-niveau (rækketal, indeks-størrelser, query-tider), eksplicit
> tilladt af issuet.

**Dom: bekræftet + fix-plan.**

## 0. Konteksttjek

- `refresh_team_race_points_mv()` (fra #3013, database/2026-07-27-3013-...) er
  præcis `REFRESH MATERIALIZED VIEW public.team_race_points_mv;` i en SECURITY
  DEFINER-funktion. Den er den langsomste af de fire ranglisterefreshes og den
  eneste issuet handler om.
- #5535 (senior-only-filter) ER allerede applied i prod: `pg_matviews.definition`
  for `team_race_points_mv` indeholder `squad = 'senior'` (verificeret
  `has_senior_filter = true`, `ispopulated = true`).
- postgres_logs bekræfter issuets 10 "canceling statement due to lock timeout" på
  24/9, med præcis de samme 10 tidsstempler som issuet nævner (10:13×3, 11:00,
  12:26×2, 15:04, 16:04, 16:49×2 UTC). Ingen nye lock-timeouts i det efterfølgende
  vindue op til nu.

## 1. Hvorfor er refreshen ~10x langsommere end i juli?

**Ikke #5535.** Filteret `ra.squad = 'senior'` sidder på `races` (1.407 rækker,
seq scan, 0,5 ms i planen) — for lille en tabel og for tidligt i join-rækkefølgen
til at kunne forklare sekunder. #3013's migrationstekst dokumenterer selv at alle
løb i dag er `'senior'`, så filteret er selektivitetsmæssigt et no-op.

**Root cause: `race_results` er vokset ~10x siden juli, og planneren vælger en
plan hvis omkostning skalerer værre end lineært med den vækst.**

`EXPLAIN (ANALYZE, BUFFERS)` på selve matview-definitionen (målt 25/9, prod):

```
HashAggregate  (actual time=11613.073..11643.334 rows=35266)
  Planned Partitions: 64  Batches: 64  Disk Usage: 3976kB
  ->  Hash Join  (actual time=1.663..11141.519 rows=942716)
        ->  Merge Join  (actual time=0.726..10849.542 rows=942716)
              Merge Cond: (rr.rider_id = ri.id)
              ->  Index Scan using idx_race_results_rider_id on race_results rr
                    (actual time=0.687..10616.858 rows=1008532)
                    Buffers: shared hit=967332 read=36085
              ->  Index Scan using riders_pkey on riders ri (...)
        ->  Hash on races ra (squad = 'senior' filter, 0,5 ms)
Execution Time: 11647.371 ms
```

10,6 af de 11,6 sekunder går til ÉT trin: en `Index Scan` over
`idx_race_results_rider_id` som fødogatager en `Merge Join` mod `riders`.
`race_results` har i dag **1.670.032 rækker** (`n_live_tup`), og
`pg_stats.correlation` for `rider_id` er **-0,006** — praktisk talt 0, dvs.
fysisk rækkefølge på disk har INGEN sammenhæng med `rider_id`-sortering
(rækker skrives i import-/finalization-rækkefølge, ikke rytter-rækkefølge).

Det betyder at Merge Join-strategien skal hente ~1 million heap-blokke i
tilfældig rækkefølge (`Buffers: shared hit=967332` — næsten alt er cache-hit,
ikke disk-I/O, men selv cache-hits koster CPU/buffer-pin pr. tilfældigt besøgt
blok). I juli var `race_results` en brøkdel af den størrelse, så det samme
(allerede dengang suboptimale) plan-valg kostede få hundrede ms i stedet for
10+ sekunder — omkostningen skalerer med rækketallet, og rækketallet er vokset
~10x. Det passer tal-for-tal med issuets "10x langsommere end i juli".

Planneren vælger denne plan fordi dens ESTIMEREDE omkostning (131.058) er
lavere end alternativet (Hash Join: 142.097) — et cost-model-estimat der ikke
holder i praksis her, fordi `random_page_cost = 1,1` (sat lavt/SSD-agtigt) gør
tilfældig indeks-adgang billig i modellen, mens den reelle pris pr. tilfældigt
besøgt buffer (selv cached) er højere end modellen antager ved denne
tabelstørrelse.

Sekundær faktor (mindre): `HashAggregate` spilder til disk (64 partitioner,
~4 MB) fordi planneren estimerer 1.185.967 grupper men der reelt kun er 35.266
(33x overestimat, arvet fra join-estimatet). Det koster kun millisekunder her —
IKKE hovedårsagen, men bidrager.

**Manglende index?** Nej — `team_race_points_mv_pk` (UNIQUE) og alle nødvendige
FK-indekser findes. Problemet er ikke et manglende index, men at det
EKSISTERENDE `idx_race_results_rider_id` har ~0 fysisk korrelation med
tabellens indsætningsrækkefølge, hvilket gør en indeks-drevet Merge Join dyr
ved denne datastørrelse.

## 2. Kan definitionen gøres billig nok til plain REFRESH < ~2 s?

**Ja, målt.** Tvinger man planneren væk fra Merge Join (samme query, samme
data, samme index — ingen skemaændring), falder eksekveringstiden fra 11,6 s
til ~1,85–1,9 s (målt to gange, prod, 25/9):

| Variant | Plan | Execution Time |
|---|---|---|
| Nuværende (default planner) | Merge Join via `idx_race_results_rider_id` | 11.647 ms |
| `SET LOCAL enable_mergejoin = off` | Seq Scan + Hash Join | 1.899 ms |
| + `SET LOCAL work_mem = '64MB'` | Seq Scan + Hash Join, ingen disk-spild i HashAggregate | 1.851 ms |

Med hash-join-varianten skifter bundflaskehalsen fra "1 mio. tilfældige
indeks-opslag" til én `Seq Scan on race_results` (821 ms, læser tabellen
lineært — 354 MB) + én hash-probe. Det er en `O(n)`-plan i stedet for en plan
hvis reelle omkostning vokser hurtigere end `n`.

**Konkret forslag:** tilføj funktions-scoped `SET`-klausuler til
`refresh_team_race_points_mv()` (samme mønster som funktionens eksisterende
`SET search_path = public, pg_catalog` — `CREATE OR REPLACE FUNCTION`,
idempotent, ingen risiko for andre queries fordi `SET` på en funktion kun
gælder MENS den funktion kører):

```sql
CREATE OR REPLACE FUNCTION public.refresh_team_race_points_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET enable_mergejoin = off   -- tvinger Hash Join i stedet for Merge Join
SET work_mem = '64MB'        -- undgår disk-spild i HashAggregate
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.team_race_points_mv;
END;
$$;
```

**Forventet effekt:** ~14,8 s → ~1,9–2,0 s pr. refresh (>85 % reduktion),
samme størrelsesorden som statement_timeout-marginen der var gældende i juli.
Holder sig lige under ~2 s-målet, men med begrænset margin — anbefales
verificeret i prod umiddelbart efter merge (samme `EXPLAIN ANALYZE`-kommando
som her), ikke antaget.

**Grænse:** dette er en stopgab, ikke en permanent løsning. Planen er nu
`O(n)` i `race_results`-størrelse i stedet for værre-end-lineær, men den er
stadig `O(n)` — refresh-tiden vil fortsætte med at vokse i takt med sæsonens
resultatmængde (om end langsommere end i dag). `enable_mergejoin = off` er
desuden en planner-hint-lignende mekanisme: den er korrekt ud fra DAGENS
data-fordeling (0-korrelation), men bør revurderes hvis data-mønsteret
ændrer sig markant (fx hvis `race_results` på et tidspunkt skrives i
rytter-sorteret rækkefølge). ACCESS EXCLUSIVE-låsen fjernes IKKE af dette
forslag — kun refresh-VARIGHEDEN falder, så lock-VINDUET bliver kortere, men
læsere kan stadig rammes af lock-timeout i det (nu meget kortere) vindue.

## 3. Vej 3-skitse: CONCURRENTLY via rå pg-forbindelse fra backend

Formålet er at fjerne lock-vinduet helt (læsere blokeres aldrig), ikke kun at
gøre det kortere. Kun en skitse — INGEN kode skrevet, dette spor er
read-only.

**Hvorfor det kræver en ny transportvej:** `REFRESH MATERIALIZED VIEW
CONCURRENTLY` kræver `isTopLevel = true` i Postgres' `ProcessUtility` — det
kan aldrig udføres via SPI, dvs. aldrig inde fra en funktion kaldt via
PostgREST/`supabase.rpc()` (dokumenteret i #3013's migration). Det er en
Postgres-engine-begrænsning, ikke en detalje ved vores kode. Backend skal
derfor udstede `REFRESH ... CONCURRENTLY` som en TOP-LEVEL statement over en
direkte Postgres-forbindelse, ikke via PostgREST.

**Filer der skal ændres (skitse):**
- `backend/package.json` — ny afhængighed `pg` (node-postgres). I dag findes
  KUN `@supabase/supabase-js` (HTTP/PostgREST) + `@electric-sql/pglite`
  (bruges andetsteds, ikke en pg-driver til prod). `pg` findes ikke i
  backend i dag (verificeret via `grep` i `backend/package.json`).
- Ny fil, fx `backend/lib/refreshRankingMatviewsConcurrently.js` — en lille
  `pg.Pool`/`Client` (pool-størrelse 1–2, IKKE delt med andet) der udsteder
  `REFRESH MATERIALIZED VIEW CONCURRENTLY public.<view>;` for hver af de fem
  views, i samme rækkefølge/kadence som i dag.
- `backend/cron.js` og `backend/lib/raceRunner.js` — de 3 kaldsteder til
  `refreshRankingMatviewsSafe(supabase, ...)` skal pege på den nye
  raw-pg-variant i stedet (samme call-signatur/best-effort-kontrakt kan
  bevares for minimal diff).
- Ny hemmelighed i Infisical (fx `SUPABASE_DB_URL` / direkte
  connection-string) — IKKE samme legitimation som `supabase-js`
  (service_role-JWT via PostgREST). Skal udstedes til Railway som en ny env-var.
- Sandsynligvis en ny/ændret migration: den rolle der bruger
  pg-forbindelsen skal kunne køre `REFRESH ... CONCURRENTLY` DIREKTE på
  matviewsne — det kræver ejerskab af matviewet (eller superuser), IKKE bare
  `GRANT SELECT` (som service_role har i dag). Enten forbindes der som
  `postgres`-rollen (simpelt, men bredere blast-radius: fuld superuser-adgang
  fra et langtidskørende backend-procesregnskab) eller en ny, snævrere rolle
  oprettes og gøres til OWNER af de relevante matviews (mere afgrænset, men
  kræver `ALTER MATERIALIZED VIEW ... OWNER TO ...` — en ejerskabsændring,
  ejer-gated DDL).

**Risici:**
1. **Ny hemmelighed + ny netværksvej.** Direkte Postgres-forbindelse fra
   Railway til Supabase er en anden sikkerhedsoverflade end
   PostgREST/service_role-JWT — kræver egen rotation, egen firewall/IP-tjek
   (Supabase's network restrictions), og fejler stille hvis Railway's
   udgående IP ikke er tilladt.
2. **Poolbegrænsning.** Supabase's direkte/pooler-forbindelser har et loft
   uafhængigt af PostgREST's HTTP-kapacitet. En dedikeret pool på 1-2
   forbindelser bør være rigeligt til fem sekventielle refreshes, men skal
   overvåges (advarsel hvis poolen nogensinde løber tør).
3. **Overlappende refreshes.** `REFRESH ... CONCURRENTLY` fejler eksplicit
   hvis samme matview allerede refreshes samtidig (fra en anden proces).
   I dag kan cron (hvert 10. min) og race-finalization kollidere i teorien;
   det er ufarligt med den nuværende ACCESS EXCLUSIVE-lås (den ene venter),
   men med CONCURRENTLY bliver det en HÅRD FEJL for den sene refresh. Kræver
   enten en simpel in-proces single-flight-lås i Node (nemt) eller en
   Postgres advisory lock (mere robust på tværs af Railway-instanser, hvis
   der nogensinde kører >1 backend-instans).
4. **Ejerskabsændring er ejer-gated DDL** (hard rule: destruktivt/ejerskab
   kræver ejer-go), og kan ikke vælges unilateralt her.
5. **Refresh-TIDEN fjernes ikke af CONCURRENTLY** — kun LÅSEN. Uden Vej
   1,5-fixet fra §2 tager en CONCURRENTLY-refresh stadig ~11-15 s DB-tid (den
   er typisk LIDT langsommere end plain REFRESH, fordi CONCURRENTLY bygger en
   midlertidig kopi og diff'er den ind); de to spor er derfor
   KOMPLEMENTÆRE, ikke alternativer — §2 gør selve refreshen billig, Vej 3
   gør at den billige (eller dyre) refresh aldrig blokerer en læser.
6. **Timeout-kontrakt.** Den eksisterende `backend/lib/refreshRankingMatviews.test.js`
   forward-guard (nævnt i filens kommentarer) låser fast at service_role har
   `statement_timeout = 60s` via PostgREST-vejen. Den kontrakt gælder ikke
   længere for en rå pg-forbindelse og skal enten flyttes til den nye kode
   eller eksplicit dokumenteres som forladt.

## 4. Anbefaling til ejeren (A/B)

**A — Kun §2 nu (`enable_mergejoin = off` + `work_mem` på
`refresh_team_race_points_mv()`), Vej 3 udskudt.**
- Fordel: én lille, idempotent `CREATE OR REPLACE FUNCTION`-migration, ingen
  ny afhængighed, ingen ny hemmelighed, ingen ejerskabsændring. Målt
  >85 % hurtigere refresh med det samme.
- Ulempe: fjerner ikke lock-vinduet, kun dets varighed (~15 s → ~2 s).
  Lock-timeouts bliver sjældnere, ikke umulige. Er en stopgab der skal
  revurderes når `race_results` fortsætter med at vokse.

**B — §2 nu OG Vej 3 som opfølgende issue.**
- Fordel: §2 giver øjeblikkelig lindring (samme dag), Vej 3 fjerner
  problemet permanent (nul blokering, uafhængigt af tabelvækst).
- Ulempe: Vej 3 er en større leverance (ny afhængighed, ny hemmelighed,
  ejerskabs-DDL, single-flight-lås) og bør IKKE bygges i denne
  investigate-session — kræver eget spor/PR og eksplicit ejer-go på
  ejerskabsændringen.

Denne investigate-session anbefaler **B**: implementér §2 som en selvstændig,
lille fix-PR (lavt scope, høj sikkerhed, målt effekt), og opret Vej 3 som et
separat opfølgende issue frem for at forsøge begge i samme spor.

## Verifikations-status

- **Dækket:** query-plan + timing for `team_race_points_mv`'s
  refresh-definition, målt to gange på nuværende prod-data (25/9); korrelation
  mellem 5535-filteret og planen; tabelstørrelse/rækketal/index-størrelser;
  krydstjek af issuets 10 lock-timeout-tidsstempler mod `postgres_logs`.
- **IKKE dækket:**
  - Ingen faktisk `REFRESH` (med eller uden ændringen) er kørt i denne
    session — kun `EXPLAIN ANALYZE` på den underliggende `SELECT`. `EXPLAIN
    ANALYZE` udfører samme aggregering/join som et REFRESH ville, men skriver
    ikke resultatet til en ny heap-fil; selve REFRESH'ets skrive-fase
    (heap-write + indeksbygning) er IKKE tidtaget her og kan lægge yderligere
    tid oveni de målte ~1,9 s.
  - De øvrige fire refresh-funktioner (`rider_rankings_mv`,
    `team_standings_ext_mv`, `global_rank_mv`, `youth_rider_rankings_mv`) er
    IKKE profileret — issuet handler specifikt om `team_race_points_mv`, og
    de fire andre kan have andre flaskehalse.
  - Ingen belastningstest under samtidig trafik (målingerne er single-query,
    ikke med samtidige læsere der konkurrerer om samme buffere/CPU som i en
    reel 10:13/11:00-produktionssituation).
  - Vej 3-skitsen er ikke kodet eller testet — kun arkitektur + risici.
  - Sentry CYCLINGZONE-5Y er IKKE selv slået op (ingen Sentry MCP-adgang i
    denne session) — ejerens kommentar om sammenhæng er taget for pålydende,
    ikke selvstændigt verificeret.

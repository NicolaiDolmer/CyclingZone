# Inkrementelle ranglister (#6765): design + målt baseline

> Status: design, intet bygget. Refs #6765 #6274 #6275 #6184 #5692. AGENTS 36: design og målt baseline før første DB-PR.
> Alle målinger er read-only på staging (`pywxpnynzmbukdvoiazp`, PG 17.6, prod-volumen) 18/10: `SELECT`/`EXPLAIN` uden `ANALYZE`, ingen skrivning, ingen REFRESH. Tiderne for den nuværende refresh er fra lasttesten 17/10 (`docs/audits/2026-10-17-6275-lasttest-10x.md` §3b).

## 1. Problemet (bekræftet)

Fire af de fem rangliste-matviews aggregerer hele `race_results` ved hver refresh. Definitionerne står i `database/2026-09-25-5535-senior-only-result-aggregates.sql` (rider/standings_ext/race_points) og `database/2026-09-25-4620-youth-rider-rankings-mv.sql` (youth). Den femte, `global_rank_mv` (`2026-08-03-2792-3193-global-rank-humans-only.sql`), læser kun `season_standings`/`teams` og tager 0,06 s. Den beholdes uændret.

| Måling (staging 18/10) | Værdi |
|---|---:|
| `race_results` (rækker / størrelse) | 2.307.176 / 1.535 MB |
| Output: `rider_rankings_mv` / `team_race_points_mv` / `team_standings_ext_mv` / `youth_rider_rankings_mv` | 16.530 / 36.050 / 1.056 / 2.692 rækker |
| EXPLAIN-cost, fuld `team_race_points_mv`-definition | 205.997 (Index Scan over alle 2.307.652 rækker + HashAggregate, 64 partitioner) |
| EXPLAIN-cost, fuld `rider_rankings_mv`-definition | 110.648 (Parallel Seq Scan over hele tabellen) |
| EXPLAIN-cost, genberegning af ÉT løb (`WHERE race_id = X`) | 1.631 (Bitmap Index Scan på `idx_race_results`) |
| Rækker pr. løb p50 / p95 / max | 191 / 3.981 / 21.100 |
| Rækker pr. sæson (S1-S3 afsluttet, S4 aktiv) | 512k / 616k / 590k / 588k |
| Rækker i ikke-afsluttede løb (indgår i dagens matviews) | 43.028 |
| Lasttest 17/10: concurrent-refresh pr. runde | ca. 15,7 s (8,8 + 3,7 + 2,7 + 0,5 + 0,06) |

Afsluttede sæsoner udgør 75 % af det, der genberegnes hver runde, selv om de ikke ændrer sig. Arbejdet vokser med historikken og med antal hold. Ved 10x lander en runde over service_role's 60 s-loft (antagelse i #6765, lineært).

Hvem læser dem: kun backend som service_role (anon/authenticated har ingen grants). `backend/routes/rankings.ts` (alle fire + global), `backend/routes/rankingHonours.ts` og `backend/lib/seasonEndedPersonalization.js` (rider/standings_ext), SQL-funktionen `get_season_honours` (rider) og `apply_global_rank_season_rollover`/`take_global_rank_weekly_snapshot` (global). Ingen direkte frontend-læsning (`supabase.from('<mv>')` findes kun i `frontend/src/preview/`).

## 2. Valgt design: løbs-grain-mellemtabel + nøglestyrede opsummeringer

Sæson-partitioneret genberegning alene er afvist: den fjerner historikken (ca. 4x i dag), men den aktive sæson vokser selv med 10x hold (ca. 5,9 mio. rækker), så vi er tilbage ved loftet. Vi skal ned på "arbejde ∝ rækker i de løb, der ændrede sig".

### 2a. Tabeller (alle nye, kun service_role)

1. **`ranking_race_contrib`**: én række pr. `(race_id, rider_id, team_id)` med `NULLS NOT DISTINCT`-unik nøgle (PG15+). Denormaliserer `season_id`, `squad`, `race_type` fra `races`. Kolonner: `points`, `prize` (`SUM`, kan være NULL som i dag), alle tællere fra matviewsene (`stage_wins`, `gc_wins_any`, `pts_wins`, `mtn_wins`, `young_wins`, `yellow_days`, `green_days`, `polka_days`, `white_days`, `top3`, `top10`, `comp_wins`, `comp_podiums`, `podiums`). `gc_wins`/`classic_wins` splittes på `race_type` ved opsummering. Indekser: `(season_id, rider_id)`, `(season_id, team_id)`, `(rider_id)`, `(race_id)`. Målt: **199.016 rækker** mod 2.307.176 (11,6x komprimering). Rækker hvor både rider og team er NULL (614.774) udelades; de indgår heller ikke i nogen matview i dag.
2. **`ranking_dirty_log`**: append-only kø `(id bigserial, kind text, race_id uuid, rider_id uuid, old_team_id uuid, enqueued_at)`. Bevidst **uden unik nøgle**: så kan en stage-skrivning aldrig vente på en række, processoren er i gang med at slette. Dubletter er harmløse, fordi behandlingen er ren genberegning.
3. **Opsummeringstabeller** med præcis samme kolonner og PK som matviewsene: `ranking_rider_season` (season_id, rider_id), `ranking_youth_rider_season` (season_id, squad, rider_id), `ranking_team_season_ext` (season_id, team_id), `ranking_team_race_points` (season_id, team_id, race_id).

### 2b. Triggere (statement-level med transition tables, samme mønster som `mark_ranking_refresh_dirty`)

- `race_results` INSERT/UPDATE/DELETE: `INSERT INTO ranking_dirty_log(kind, race_id) SELECT DISTINCT 'race', race_id FROM new_rows/old_rows`. En stage-skrivning giver 1-få kø-rækker, ingen rækkelåse på delte rækker. TRUNCATE skriver `kind='rebuild'`.
- `races` UPDATE af `season_id, squad, race_type, name` samt DELETE: kø `race` med id'et. Ingen FK med cascade fra contrib; processoren rydder contrib for løb, der ikke findes længere.
- `riders` UPDATE af `team_id`: kø `rider` med `rider_id` og `old_team_id` (fra `old_rows`). Det er nødvendigt, fordi `team_race_points_mv` og `team_standings_ext_mv` i dag tilskriver gamle resultater rytterens **nuværende** hold (se §5).
- De eksisterende `ranking_dirty_*`-triggere bliver stående. De driver fortsat coordinatorens version/lease (#5692), så `global_rank_mv` og heartbeat virker som i dag.

### 2c. Processor `apply_ranking_deltas(p_max_items int DEFAULT 200)`

SECURITY DEFINER, `search_path=public,pg_temp`, kun service_role. Den kaldes af den eksisterende coordinator (`backend/lib/refreshRankingMatviews.js`) i stedet for de fire dyre REFRESH-RPC'er, under samme advisory lock (`cz-ranking-refresh`) og lease-fencing. Én transaktion pr. batch:

1. `SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '30s';`
2. Claim: `DELETE FROM ranking_dirty_log WHERE id IN (SELECT id ... ORDER BY id LIMIT p_max_items FOR UPDATE SKIP LOCKED) RETURNING *`. Resultatet er batchen, og nye kø-rækker under kørslen tages i næste batch.
3. Løbssættet R = batchens `race` plus alle løb, hvor batchens `rider` har contrib-rækker.
4. Nøgler FØR: `(season_id, rider_id)` og `(season_id, coalesce(team_id, riders.team_id))` fra contrib for løb i R. For `rider`-poster tilføjes `old_team_id`.
5. `DELETE FROM ranking_race_contrib WHERE race_id = ANY(R)`, derefter `INSERT ... SELECT ... FROM race_results JOIN races WHERE race_id = ANY(R) GROUP BY race_id, rider_id, team_id`. Det er indeks-drevet (`idx_race_results`) og koster ca. 1.600 i EXPLAIN pr. løb mod 206.000 for fuld genberegning.
6. Nøgler EFTER (som 4, mod den nye contrib), og foreningen af FØR og EFTER danner det berørte nøglesæt.
7. Genberegn kun de berørte nøgler fra contrib. Det er altid `DELETE` + `INSERT` fra kilden, aldrig `+=`:
   - `ranking_rider_season` / `ranking_youth_rider_season`: `WHERE (season_id, rider_id) IN keys`, squad-filter som i dag.
   - `ranking_team_race_points`: `WHERE race_id = ANY(R)`. Grain'et indeholder race_id, så hold-skift kræver ingen ekstra bogføring. Rollup er contrib JOIN `riders` (nuværende hold).
   - `ranking_team_season_ext`: `WHERE (season_id, team_id) IN keys`. Kilden er contrib med `team_id = t`, plus contrib med `team_id IS NULL` hvor rytterens nuværende hold er `t`.
8. `kind='rebuild'` (TRUNCATE eller manuel reparation): fuld genopbygning sæson for sæson. Det er samme kode med R = alle løb i sæsonen, ét kald pr. sæson, så hvert kald holder sig under 60 s.

**Idempotens:** alle trin er genberegning fra `race_results` og `riders` med sletning og indsættelse inden for samme nøgle. Genkørsel af et løb (rettelse, sletning og genindsættelse af resultater, dobbelt kø-post eller retry efter timeout) giver bit-identisk output. En fejlet batch ruller tilbage, og kø-rækkerne er så ikke slettet.

**Historik:** contrib for afsluttede sæsoner røres kun, når et af deres løb eller en af deres ryttere faktisk ændres. Opsummeringerne beholder alle sæsoner, præcis som matviewsene.

**Låse:** processoren læser `race_results` via MVCC og tager ingen lås på den (kun ACCESS SHARE). Den skriver kun i egne tabeller. Læsere blokeres aldrig, fordi almindelige tabeller ikke har REFRESH-lås. `lock_timeout` 2 s i processoren og 5 s i migrationerne (som i #5692).

### 2d. Læserne ændres ikke

Navnene `rider_rankings_mv`, `team_standings_ext_mv`, `team_race_points_mv` og `youth_rider_rankings_mv` bliver almindelige VIEWs (`SELECT <samme kolonner> FROM ranking_*`) med de samme grants (kun service_role). PostgREST, `fetchAllRows`, HEAD-count på `team_race_points_mv` og `get_season_honours` binder på navn og kolonner og virker uændret. `refresh_<navn>_mv(...)`-overloads beholdes som tynde wrappers, der kalder `apply_ranking_deltas()`, så et Node-deploy i forkert rækkefølge ikke fejler.

## 3. Migrationsrækkefølge (én PR pr. trin; apply post-merge per #2642; trin 2 er ejer-gated)

1. **M1 skygge (additivt):** tabeller, kø, triggere, processor. Backfill af contrib sæson for sæson. Måles på staging før prod, og hvert kald skal under 60 s; S2 har 616k rækker. Opsummeringerne bygges fra contrib. Matviewsene serverer stadig, og coordinatoren kalder processoren EFTER matview-passet. Paritetsjob: `EXCEPT ALL` begge veje mellem matview og opsummering efter hver pass på staging og én gang i døgnet i prod. Fund logges til Sentry.
2. **M2 swap (efter 0 paritetsfund i 3 døgn på staging og 2 døgn i prod):** i én transaktion med `lock_timeout='5s'`: `DROP MATERIALIZED VIEW x; CREATE VIEW x AS ...; REVOKE/GRANT`. Node: coordinatoren kalder `apply_ranking_deltas` og `refresh_global_rank_mv` og dropper de fire REFRESH-kald. 4-minutters-cooldownen kan senere sænkes, men det er en separat beslutning.
3. **M3 oprydning (efter en sæsonovergang):** fjern de døde REFRESH-overloads og paritetsjobbet.

**Rollback:** M2: `DROP VIEW x` og genskab matviewen med DDL'en ordret fra `2026-09-25-5535-...sql` og `2026-09-25-4620-...sql` (inkl. indekser og grants), derefter revert af Node-commit'en. Tabellerne kan blive stående. M1: `DROP TRIGGER` og `DROP FUNCTION`/`DROP TABLE` for de nye objekter, uden at noget eksisterende røres.

## 4. Testporte

| # | Port | Hvor |
|---|---|---|
| T1 | Fast fixture: alle fire views, alle kolonner, `EXCEPT ALL` begge veje mellem gammel matview-definition og ny = 0. Fixturen dækker NULL-rider, NULL-team, holdresultater, alle-NULL-præmie, tre squads, etapeløb og endagsløb | lokal PG17 (AGENTS 36) |
| T2 | Idempotens: samme løb i kø 2x og processor kørt 2x; md5 af sorteret output er uændret | lokal |
| T3 | Genkørsel af et løb (DELETE og ny INSERT af resultater) giver paritet | lokal |
| T4 | Transfer (`riders.team_id` ændres) giver paritet for race_points og standings_ext, også i afsluttede sæsoner | lokal |
| T5 | Løb slettet, `season_id` eller `squad` ændret, TRUNCATE og rebuild giver paritet | lokal |
| T6 | Samtidighed: stage-inserts mens processoren kører giver 0 lock-waits over 100 ms på `race_results` (`log_lock_waits`) og paritet bagefter | lokal |
| T7 | Prod-volumen: paritet som i §6 og processortid p50/p95/max pr. løb (max-løbet har 21.100 rækker) | staging |

Mål for go til M2: T1-T7 grønne, og processoren under 1 s for et p95-løb på staging (Small compute).

## 5. Observationer til ejeren (ændres IKKE af dette design)

- `team_race_points_mv` (og `team_standings_ext_mv`, hvor `race_results.team_id` er NULL) tilskriver historiske resultater rytterens **nuværende** hold. Målt: 520.101 resultatrækker har et andet race-time-hold end rytterens nuværende, heraf 23.569 med præmie. Designet bevarer adfærden 1:1, så paritet kan bevises. Om historik skal fryses ved race-time-holdet, er en separat spildesign-beslutning.
- Matviewsene viser resultater fra løb, der stadig kører (43.028 rækker). "Pr. afsluttet løb" i #6765 er derfor i praksis "pr. løb med nye resultater", ellers ville ranglisterne ændre adfærd.

## 6. Bevis for at to-trinsaggregatet giver samme output (staging 18/10, read-only)

Én SELECT-sætning beregnede både matview-definitionen direkte på `race_results` og to-trinsvejen (contrib-CTE, derefter opsummering), og sammenlignede med `EXCEPT ALL`:

| View | Rækker | gammel minus ny | ny minus gammel | live matview minus ny |
|---|---:|---:|---:|---:|
| rider_rankings (points, prize, stage/gc/classic-sejre, yellow, top3, top10) | 16.530 | 0 | 0 | 0 |
| team_race_points | 36.050 | 0 | 0 | 0 |
| team_standings_ext | 1.056 | 0 | 0 (mod live mv) | 0 |

Contrib-CTE'en gav 199.016 rækker. Youth og de resterende rider-tællere følger samme `FILTER`-mønster og dækkes af T1.

## Review-fund (Codex 19/10), løst 31/10 før skyggen tændes

Status 31/10 (`database/2026-10-31-6765-ranking-shadow-codex-p1-p2.sql`, `backend/lib/rankingShadowPass.ts`, bevis i `backend/lib/testdb/rankingDeltas6765CodexP1P2.integration.test.ts`):

- **P1, løst.** M1.5 (#7057) løste det meste: passet kalder processoren i flere batches, og rene cron-ticks dræner resten, så intet ventede på en urelateret skrivning. Det manglede: et pas under lease kunne stadig stoppe ved det bløde budget (20 batches/8 s) og kvittere versionen med versionens egne køposter tilbage. Nu er kø-id'et versionsgrænsen. `get_ranking_shadow_metrics` giver `max_id`, læst efter claim, så alt der blev committet med versionen ligger under det. Processoren giver `next_id` (køens hoved) og `rebuild_from`/`rebuild_through` (en rebuild-markørs udfoldning). Et pas under lease dræner til hovedet er forbi vandmærket, før versionen kvitteres. Hårde lofter på 100 batches/45 s; rammes de, bliver resten i køen til de næste ticks (status `version-pending`, `version_drained:false` i loggen). Rene ticks og gammel SQL uden `max_id` bruger det bløde budget som før. **M2-kontrakt:** coordinatoren må kun kvittere en version, når passet logger `version_drained:true`; ellers sendes `p_success=false`, og versionen bliver pending.
- **P2, løst.** M1 udfoldede allerede markøren til holdbare løbsposter, men samme kald genberegnede også alle summary-nøgler i alle sæsoner. Det er arbejde, der vokser med historikken, i ét kald på 30 s. Nu udfoldes markøren kun: én `race`-post pr. løb, derefter én `season`-post pr. summary-sæson (ny kolonne `ranking_dirty_log.season_id`; NULL-sæsonen er sin egen post). Et sæson-sweep genberegner sæsonens nøgler fra contrib og fjerner rækker uden bidrag. Et batch tager højst ét sweep, og sweeps kommer efter alle løbsposter. Et fejlet kald ruller tilbage, og alt resterende arbejde står stadig i køen.

Oprindelig ordlyd:

- **P1 Drain the queue before acknowledging the refresh version:** When one SQL statement affects more than 200 races or riders, `mark_ranking_refresh_dirty` increments `requested_version` only once, while this claim processes at most 200 log rows. The M2 coordinator is specified to call `apply_ranking_deltas` only once before completing that leased version, so the remaining rows have no pending work-state version to schedule another pass and their rankings stay stale until an unrelated later write occurs. The processor must drain all work belonging to the claimed version, or preserve/reassert dirty state while entries remain.
- **P2 Preserve progress across per-season rebuild calls:** For a manual repair, the single `kind='rebuild'` row is deleted by the claim, but this step requires one invocation per season and neither the queue schema nor the coordinator records which seasons remain. Consequently an implementation must either rebuild every season in the same 30-second RPC, contradicting the stated per-season timeout strategy, or stop after one season with no work item to trigger the rest. Expand the marker into durable per-season work or retain a rebuild cursor before consuming it.

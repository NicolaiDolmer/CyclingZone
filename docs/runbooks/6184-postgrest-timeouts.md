# #6184 · PostgREST "Thread killed by timeout manager"

Målt read-only 5/10 (vindue 4/10 11:00 til 5/10 11:00 UTC) via Supabase MCP:
`postgrest_logs`, `edge_logs`, `pg_stat_statements` og `EXPLAIN` uden ANALYZE.
Ingen data eller skema ændret under målingen.

## Konklusion

**De ca. 3.000 linjer er ikke dræbte forespørgsler.** Det er PostgREST's
webserver (Warp), der lukker HTTP-forbindelser, som har ligget ubrugte
(keep-alive) længere end dens timeout. Tre ting peger samme vej:

1. **Ingen fejl hos klienten.** I samme døgn gav `/rest/v1/*` kun ca. 58 svar
   med 5xx ud af ca. 950.000 kald, og de fleste af dem kom under genstarten
   kl. 07:07 UTC (#6129). En dræbt forespørgsel ville give 5xx/52x i
   `edge_logs`. 3.036 linjer mod ca. 30 forklarede 5xx hænger ikke sammen.
2. **Omvendt af trafikken.** Flest linjer om natten, når trafikken er lavest:
   22-04 UTC ca. 185 pr. time ved ca. 12.000 REST-kald pr. time, 06-21 UTC
   ca. 90 pr. time ved ca. 45.000. Ved lav trafik genbruges færre forbindelser,
   så flere når at gå i tomgang og blive lukket.
3. **De kommer i klumper, i takt med cron.** Linjerne kommer i bundter med
   identisk tidsstempel (op til 33 i samme mikrosekund). Det er sådan Warps
   timeout-manager rydder op. Bundterne følger backendens 5-minutters cron:
   om natten falder 49.118 af 73.760 REST-kald (67 %) i minutterne med
   `minut % 5 = 1`, og linjerne topper i samme minut og minuttet efter
   (283 + 494 af 1.113). Når mange cron-jobs rammer PostgREST samtidig,
   åbnes mange forbindelser på én gang. Bagefter ligger de i tomgang og
   bliver lukket.

Linjetallet er altså et **symptom på en burst-agtig kaldprofil**, ikke en
fejl i sig selv. Det rigtige at rette er den burst og de få forespørgsler,
der faktisk er langsomme.

## Top-kilder

### A. Burst hvert 5. minut fra backend-cron (driver "Thread killed"-linjerne)

Kald i burst-minuttet om natten (22-04 UTC, 72 ticks):

| Kilde | Kald i burst-minuttet | Pr. tick | Rod-årsag |
|---|---:|---:|---|
| `GET notifications` (dedup-tjek, selection-warning-sweep) | 11.253 | ca. 156 | ét dedup-opslag pr. (hold, løb), også når alt allerede er sendt |
| `GET teams?select=user_id&id=eq.*` (notifyTeamOwner) | ca. 8.400 | ca. 117 | ét ejer-opslag pr. hold før hvert dedup-tjek |
| `GET board_profiles?team_id=eq.*` (board-auto-accept, hver 30. min) | 3.235 | ca. 270 pr. kørsel | ét opslag pr. menneskehold |
| `rpc/plan_ai_pool_retirements` + `reserve_ai_pool_retirements` | 2 x ca. 2.500 | ca. 35 + 35 | ét kald pr. pulje; hurtige (ca. 30 ms), ikke rettet her |

De 5-minutters jobs (`deadline-day`, `squad-enforcement`, `selection-warning`,
`senior-start-reminder`) startes alle med `setInterval` ved boot. 30- og
60-minutters jobs falder også på samme 5-minutters grænse, så de kører
samtidig.

### B. Langsomme forespørgsler, der faktisk fejler (få, men ægte)

| Forespørgsel | Antal > 5 s / fejl i døgnet | Plan i dag |
|---|---|---|
| Stall-vagten: `race_results?race_id=in.(~30)&order=id` med offset | 44 > 5 s, max 26 s, 1 x 500 ved 60 s | Index Scan på `race_results_pkey` over hele tabellen (ca. 1,9 mio. rækker), join-filter på race_id |
| Hero & Agony-kortet: `race_results?team_id=eq.*&result_type=eq.stage&order=imported_at.desc,id.desc&limit=1` | 6 x 500 ved ca. 8 s (authenticated statement_timeout) | Index Scan Backward på `idx_race_results_imported_at`, filtrerer team_id. Hold uden nylige etaper skanner hele tabellen |
| `rpc/refresh_team_race_points_mv` (uden argument) + læsninger af `team_race_points_mv` | 78 > 5 s, max 26 s; 12 læsninger med 500 ved ca. 8 s | Ikke-concurrent REFRESH låser viewet for læsere. Concurrent-overload er allerede oprettet (#6167), og skiftet i Node er det sidste skridt. Ikke rørt her |
| `rpc/feature_liveness_table_counts` | 72 > 5 s, max 16 s | Tæller hele tabeller. Ingen fejl set. Kandidat til opfølgning |
| `rpc/touch_user_presence`, `increment_balance_with_audit` | 7 + 2 x 500, alle 08:25 UTC | Låsekonflikt under en engangs-kompensationskørsel. Ikke en vedvarende kilde |
| Genstart 07:07 UTC | ca. 24 x 503 + 3 x 52x | Kendt (#6129) |

## Rettelser i denne PR (Refs #6184)

1. **`backend/lib/selectionWarningSweep.js`**: ét batch-opslag af
   eksisterende `selection_warning`-rækker for løbene i vinduet (samme 24 timers
   vindue og samme nøgle som `notifyUser`). Kun reelt nye varsler går videre til
   `notifyTeamOwner`. Det fjerner ca. 270 GET'er pr. tick, når alt allerede er sendt.
2. **`backend/lib/boardAutoAccept.js`**: `board_profiles` hentes i ét
   chunket og pagineret opslag for alle hold i stedet for ét pr. hold. Fejler
   batchet, henter hvert hold selv som før, så en fejl stadig kun rammer det
   enkelte hold.
3. **`backend/lib/stallWatchdog.js`**: henter ikke længere alle
   resultat-rækker for ankrene. I stedet laves to `LIMIT 1`-opslag pr. løb
   (seneste `imported_at` og om der findes en præmie-række). De køres
   sekventielt, så de ikke giver en ny burst.
4. **`database/2026-10-05-6184-race-results-latest-indexes.sql`** (additiv,
   `CONCURRENTLY`):
   - `idx_race_results_team_stage_latest (team_id, imported_at DESC, id DESC) WHERE result_type='stage'`
     matcher Hero & Agony-forespørgslen præcist.
   - `idx_race_results_race_id_imported_at (race_id, imported_at DESC NULLS LAST)`
     dækker stall-vagtens nye opslag.

Ingen timeouts er hævet. Ingen flag.

## Ikke rettet her (forslag)

- **Forskudt start af cron-intervaller.** De 5-minutters jobs kunne startes
  med hver sin faste forskydning, så de ikke rammer PostgREST i samme sekund.
  Det ændrer cron-timing og monitor-vinduer, så det bør være en separat
  beslutning.
- **`teams?select=*&user_id=eq.*`**: ca. 90.000 kald i døgnet fra backenden.
  Det ligner et opslag pr. API-request, som følger spilleraktiviteten. Det
  driver ikke natte-mønsteret, men er den største enkeltkilde til
  REST-trafik og bør caches pr. request eller pr. kort TTL.
- **`notifyTeamOwner`** bruges af flere sweeps end selection-warning
  (`teams?select=user_id` ca. 28.000 kald i døgnet). Andre sweeps, der allerede
  kender `user_id`, kunne kalde `notifyUser` direkte.
- **`feature_liveness_table_counts`**: estimerede tal (`pg_class.reltuples`)
  i stedet for `count(*)`, hvis eksakte tal ikke er nødvendige.
- **Performance-advisors** (`auth_rls_initplan`, `multiple_permissive_policies`)
  er ikke rørt. Ingen af de målte langsomme forespørgsler rammer de policies.

## Måleplan efter deploy

Kør de samme forespørgsler 24 timer efter, at backend er deployet OG
migrationen er anvendt (auto-migrate). Målt mod baseline ovenfor:

| Mål | Baseline 4-5/10 | Forventet efter |
|---|---|---|
| REST-kald i burst-minuttet (`minut % 5 = 1`), 22-04 UTC | 49.118 | markant lavere (selection-sweep + board-batch alene fjerner ca. 20.000) |
| `GET notifications` fra node i døgnet | ca. 42.000 | ned med størstedelen (dedup-tjekket var ca. 11.000 alene om natten) |
| `GET board_profiles?team_id=eq.*` fra node | ca. 13.600 | ca. 150 (48 kørsler x ca. 3 chunks à 100 hold) |
| `race_results` > 5 s origin_time | 44 + 6 x 500 | 0 for de to rettede former |
| "Thread killed"-linjer pr. time om natten | ca. 185 | lavere. Tallet er et sekundært mål, fordi det afhænger af burst-størrelsen og ikke af fejl |
| 5xx på `/rest/v1/*` uden for genstarter | ca. 30 | under 10 (resten er MV-refresh, #6167) |

Forespørgsler (Supabase MCP `query_logs`):

```sql
-- Linjer pr. time
select toStartOfHour(timestamp) h, count(*) from logs
where source='postgrest_logs' and event_message like 'Warp server error: Thread killed%'
group by h order by h;

-- Burst-andel om natten (vindue 22:00-04:00 UTC)
select toMinute(timestamp) % 5 m5, count(*) from logs
where source='edge_logs' and log_attributes['request.path'] like '/rest/v1/%'
group by m5 order by m5;

-- Langsomme/fejlende REST-kald
select log_attributes['request.path'] p, log_attributes['response.status_code'] st, count(*)
from logs where source='edge_logs' and log_attributes['request.path'] like '/rest/v1/%'
  and (toInt32OrZero(log_attributes['response.status_code']) >= 500
       or toInt64OrZero(log_attributes['response.origin_time']) > 5000)
group by p, st order by 3 desc;
```

Vælg altid enkelte felter fra `log_attributes`. En fuld `log_attributes`-dump
indeholder en hash af API-nøglen, og så blokerer secret-hooken outputtet.

Efter migrationen: `EXPLAIN` på de to `race_results`-former skal vise
`idx_race_results_team_stage_latest` og `idx_race_results_race_id_imported_at`
og ikke `idx_race_results_imported_at`/`race_results_pkey`.

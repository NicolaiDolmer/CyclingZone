# Pladsen i træningstabellerne (#6490)

Status: ejer valgte 15/11 omfang B (udløb af gammelt indhold, stop ulæste felter, fjern kopien af rytterne fra holdrapporten). Spillerne må ikke se nogen forskel. Intet slettes i prod uden tørkørsel med tal og ejerens "kør". Træningskode: uafhængig dommer før merge.

## Målt baseline (prod 15/11, kun læsning)

| Tabel | Rækker | I alt |
|---|---:|---:|
| `training_rider_ticks` (kvitteringer) | 1,90 mio. | 2.582 MB |
| `training_day_runs` (holdrapporter) | 88.110 | 1.073 MB (TOAST 1.018 MB) |
| `rider_training_scores` | 1,96 mio. | 1.023 MB |

- Én kvittering pr. rytter pr. løbsdag, 5 løbsdage pr. dato: ca. 38.200 rækker pr. dato. Vækst ca. 80 MB pr. dato.
- `training_day_runs.report.riders` er en identisk kopi af kvitteringerne (8.920 holdrapporter på 7 datoer: 100 % ens). Bygges i `commit_training_date_tick` (`database/2026-11-13-7982-...sql` linje 193-208).
- Svartid for træningshistorik, ét hold: i dag 160 ms; udledt fra kvitteringer i én SQL 492 ms.
- Ingen oprydning findes. Autovacuum har aldrig kørt på tabellerne. `pg_cron` og `pg_repack` er ikke installeret.

## Vigtige fund

- `condition_observed` skal stadig SENDES til `commit_training_date_tick` (linje 90-93 tjekker den), men behøver ikke gemmes.
- At fjerne felter kan gøre rækkerne STØRRE, fordi de falder under Postgres' komprimeringsgrænse (1.081 B bliver ca. 1.922 B). Trin a kræver derfor `toast_tuple_target` og en lokal måling først.
- `progress_before` bruges i frontend og bliver.
- Kvitteringernes indhold skal bevares for hele den aktive sæson (træningssiden læser fra sæsonstart), ikke kun 7 dage.
- Rækker med `game_day` NULL (25.075, 93 MB) er eneste spor for ryttere uden kvittering og røres ikke.
- 52 datoer står som `needs_reconciliation` og 2 som `partial`; de undtages fra udløb.
- Peak-signalet er aktivt (812 peak-planer i sæson 5) og læser højst 18 dage tilbage.

## Trin (hver PR alene; alt nyt bag kontakt, slukket = som i dag)

| Trin | Hvad | Kontakt | Kræver |
|---|---|---|---|
| a | Gem ikke `condition_observed` og `focus_source`; `toast_tuple_target` | `training_tick_slim_report_6490` | Lokal PG17-måling først; droppes ved under 2 % gevinst (ejerspørgsmål) |
| b1 | Ny læsevej for træningssiden: RPC `training_history_runs(p_team_id, p_since)`, SECURITY DEFINER med samme ejerskabstjek som RLS, samme kolonner og samme `riders` (jsonb_agg over den frosne rytterliste). `useTrainingHistory.js` vælger vej efter kontakten | `training_history_from_ticks_6490` | Sammenligning i prod (`scripts/ops/6490-history-parity.sql`, kun SELECT) = 0 afvigelser; svartid højst gammel + 300 ms |
| b2 | `api.js:3182` bruger den udledte vej; `dailyTrainingEngine.js:572` henter kun `report->condition_per_date` | samme (572-rettelsen uden kontakt) | Frossen før/efter-JSON |
| c | `racePeakPlans.loadTeamTrainingRuns` læser `status` og `focus` fra kvitteringerne | samme | Dommer (motorens input); samme `riderMap` med og uden kontakt |
| d | Stop med at skrive kopien; funktionen returnerer stadig rytterne. Kun aktiv når b1-kontakten er tændt (håndhæves i SQL). Genopretning: `training_day_runs_backfill_riders(p_since)` | `training_day_run_riders_copy_6490` | Dommer; harness-spejling (#7982) |
| e | Daglig udløbskørsel, starter som tørkørsel: arkivér dato, sæt `report = '{}'` i kvitteringer og `contributions = NULL` i scorer, VACUUM | `training_report_retention_6490` | Ejerens "kør" før skrivning |
| f | Engangsoprydning af kopien i gamle holdrapporter (kun hvor gemt = udledt), så `VACUUM FULL training_day_runs` kl. 04-05 | ingen | Fuldt arkiv, tørkørsel, ejerens "kør" |

## Opbevaring

- Rækker (nøgler) i alle tre tabeller: altid.
- Kvitteringernes indhold: bevares hvis datoen er højst 37 dage gammel, ELLER rækken hører til den aktive sæson, ELLER holdets dato ikke er `complete`. Ellers `'{}'`.
- `contributions`: 37 dage, derefter NULL.
- `riders` i holdrapporter med `game_day` sat: fjernes (d og f). `game_day` NULL: røres ikke.

## Arkiv og plads

- f: dump af `training_day_runs` (ca. 1,1 GB, SHA256 og rækkeantal på issuet) før skrivning.
- e: gzip-NDJSON pr. dato i privat bucket med manifesttabel; kun datoer med verificeret manifest tømmes.
- `training_day_runs` giver ca. 0,95 GB disk tilbage efter `VACUUM FULL` (anslået sekunder til 1 minut; måles på kopi).
- Kvitteringer og scorer: pladsen bliver genbrugelig; disken gives kun tilbage med `pg_repack`.

## Forventet gevinst

Databasen fra ca. 9,5 til ca. 8,5 GB efter f. Vækst fra ca. 80 til ca. 16 MB pr. dato når d og e kører (antagelse).

## Åbne ejerspørgsmål

1. Hvor arkivet skal ligge og hvor længe (privat bucket, ca. 300 MB pr. måned, antagelse).
2. Skal disken gives tilbage for kvitteringer og scorer med `pg_repack`, eller er genbrug nok?
3. Må trin a droppes, hvis den lokale måling viser under 2 % gevinst?

## Nat 15.-16/11

Bygges: b1, b2 og c (alle bag slukket kontakt). a, d, e og f venter på ejerens svar og dommerens dom over b og c.

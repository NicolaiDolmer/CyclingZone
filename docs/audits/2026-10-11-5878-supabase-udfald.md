# Audit #5878: gentagne Supabase-udfald 28/9-9/10

Dato: 2026-10-11 (data hentet 2026-10-09 23:00 UTC). Undersøgelsesspor, read-only. Ingen prod-ændring, ingen workflows slået til/fra, ingen secrets.
Alle tider står som **UTC (CEST)**. CEST = UTC+2.

## Kilder

| Kilde | Hvad | Hvordan |
|---|---|---|
| Supabase `edge_logs` | 5xx pr. time og pr. 5 min, statuskoder | Management-API logs (ClickHouse), et 24-t-vindue ad gangen, 28/9 til 9/10 |
| Supabase `postgres_logs` | genstart-markører, sidste linjer før stop, lange queries | samme, filtreret på `database system was ...`, `received fast shutdown`, `duration:`, `canceling statement` |
| Postgres live | `pg_postmaster_start_time()`, settings, `pg_stat_statements` | read-only `select` |
| Sentry | fejl-events pr. dag (timeout/52x/schema cache), 14 dage | `search_errors` |
| GitHub | `feature-liveness-audit.yml`, `db-health.yml`, `supabase-log-watch.yml`, run-historik | `gh workflow list`, `gh run list`, `git log` |

Begrænsning: Supabase-loggen mister linjer omkring genstarter. 2/10 findes ingen start-linje i `postgres_logs`, selvom `pg_postmaster_start_time` (målt i issuet 2/10) viser genstart 17:26:00 UTC. RAM-, swap- og OOM-kill-data findes ikke via MCP/Management-API. **Hukommelse er derfor ikke målt i denne audit.**

## Tidslinje

| # | Tid UTC (CEST) | Type | 5xx (edge) | Målt evidens | Klasse |
|---|---|---|---|---|---|
| 1 | 28/9 12:15 (14:15) | mætning, ingen genstart | 476 på 5 min (522/504) | 12 statement timeouts 11:45-12:17; queries på 10-20 s; ingen genstart-linje | selvforskyldt last (antaget) |
| 2 | 28/9 17:50-18:35 (19:50-20:35) | mætning, ingen genstart | ca. 970 (522/504/500) | 37 statement timeouts, 9 lock timeouts; RPC'er på 11-19 s; døgntrafik 2,24 mio. kald (2,4x nuværende) | selvforskyldt last (antaget) |
| 3 | 1/10 15:05 (17:05) | kort blip | 154 (500/504) | ingen genstart | uafklaret, lille |
| 4 | **1/10 18:25-18:30 (20:25-20:30)** | **hårdt stop + selvgenstart** | 1.717 (520/521/522/525/503) | sidste linje 18:26:49, ingen shutdown-linje, `starting up` 18:29:38, klar 18:29:49. Lige før: `feature_liveness_table_counts` 14 s og 24 s, `compute_daily_growth_snapshot` 15 s, `race_results`-læsning 18 s, en RPC på 19,5 s, statement timeouts | **ny, ikke nævnt i issuet**; samme mønster som #7 |
| 5 | 2/10 17:14-17:27 (19:14-19:27) | hårdt stop + selvgenstart | 1.329 | `refresh_team_race_points_mv` 13-20 s hvert 5. min; statement timeouts fra 17:14:47; WAL archive-fejl 17:13:54; postmaster-start 17:26:00 (issuet) | selvforskyldt last (antaget) |
| 6 | 5/10 07:07 (09:07) | crash + recovery | 50 | `database system was not properly shut down; automatic recovery in progress` 07:07:54 | **selvforskyldt, målt**: 16 MB RPC fra #6129, rettet #6179 |
| 7 | 6/10 10:59-11:01 (12:59-13:01) | hårdt stop + selvgenstart | 57 (520-525/503) | `database system was interrupted` 11:00:37 | selvforskyldt last (antaget) |
| 8 | 6/10 13:21-13:42 (15:21-15:42) | frysning uden selvgenstart | ca. 1.540 (522) | PostgREST timeouts; `received fast shutdown request` 13:41:57 = ejerens genstart | selvforskyldt last (antaget) |
| 9 | 6/10 13:50-13:53 (15:50-15:53) | planlagt: Small til Medium | 677 | `pg_postmaster_start_time` = 13:53:26 og er ikke ændret siden | planlagt, tæller ikke |
| - | 7/10, 8/10, 9/10 | **ingen udfald** | **0, 0, 0** (933k, 923k, 752k kald) | postmaster kører uafbrudt fra 6/10 13:53:26; Sentry 0 events 7-9/10 | - |

Sentry bekræfter det samme mønster pr. døgn (timeout/52x/schema cache): 28/9 80, 1/10 40, 2/10 120, 6/10 262, 7-9/10 0. 5/10 var for kort til at give Sentry-events.

## Dom over rodårsag

**Målt:**
- Mindst 4 hårde stop uden shutdown-linje (1/10, 2/10, 6/10 to gange inkl. frysningen) og 2 mætningsepisoder uden genstart (28/9). Alle på Small (2 GB).
- Hvert stop skete mens flere tunge læsninger kørte samtidig: rangliste-MV-refresh (13-22 s), `feature_liveness_table_counts` (14-24 s, kaldt fra PR-CI mod prod), `compute_daily_growth_snapshot` (15 s), store `race_results`-læsninger (17-18 s).
- Ingen af de tunge kald findes i `pg_stat_statements` på samme niveau efter 6/10: ranglisterefresh har nu snit 1,7-3,1 s (maks 5,2 s, 84 kald på 3,4 døgn); `feature_liveness_table_counts` optræder ikke (PR-kørsler tæller ikke længere prod-tabeller, #6267).
- 0 5xx og ingen genstart i 3,4 døgn efter Medium og tiltag 1-3.

**Antaget (ikke målt):** hukommelsespres. Et hårdt stop uden shutdown-linje efterfulgt af crash-recovery passer på at kernel OOM-killer dræber en Postgres-proces. Det er ikke bevist, fordi RAM-, swap- og kernel-events ikke kan hentes via de værktøjer jeg har.

**Spontane vs selvforskyldte:** Ingen af udfaldene ligner en spontan platformfejl. 1 er målt selvforskyldt (5/10). De øvrige skete alle under egen tung last på for lille instans. Ingen evidens for Supabase-hændelse på platformsiden, men Supabase' egen status-historik er ikke tjekket i denne audit.

**Nyt fund:** udfaldet 1/10 18:25 UTC (20:25 dansk tid) står ikke i issuet. Det er et hårdt stop med samme mønster som 6/10, og `feature_liveness_table_counts` kørte to gange i minutterne før.

## Er Medium nok?

Ja, for nuværende last. Med forbehold:
- 3,4 døgn uden fejl er et kort vindue. Medium blev indført samtidig med tiltag 1-3, så effekten af Medium alene kan ikke skilles ud.
- Trafikken er nu ca. 0,9 mio. kald/døgn mod 2,24 mio. 28/9. En ny spids (sæsonstart, ny feature) er ikke testet på Medium.
- Største DB-forbruger nu er Realtime-WAL-afkodningen (`realtime.list_changes`: 521k kald, 4.984 s samlet på 3,4 døgn). Ikke farlig nu, men den vokser med antal abonnenter.
- Live-settings nu: max_connections 120, shared_buffers 1 GB, work_mem 7 MB, statement_timeout 2 min, 60 forbindelser i brug.

Anbefaling: behold Medium. Nedgradér ikke før vagten (tiltag 5) har kørt i 14 dage og hukommelsesgrafen fra dashboardet er gemt for samme periode. Det er ejerens skridt, fordi grafen kun findes i Supabase-dashboardet.

## Hvad mangler

Tiltag 5, en alarm når databasen hænger. I dag findes:
- `db-health.yml`: ugentlig (mandag 06:00 UTC).
- `supabase-log-watch.yml`: dagligt 05:20 UTC.
- Ingen probe med kadence under 1 døgn. Frysningen 6/10 varede 21 min og blev opdaget af ejeren, ikke af et system.

Design: `docs/drafts/spec-5878-db-watchdog-2026-10-11.md`.

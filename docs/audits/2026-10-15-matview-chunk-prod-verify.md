# Prod-verifikation 15/10: rangliste-matview (#5692) og chunk-fejlen (#5162)

> Read-only. Kilder: Supabase postgres_logs (7 vinduer à 24 t, 8/10 11:00 til 15/10 ca. 11:00 UTC), pg_stat_statements, `ranking_refresh_work_state`, Sentry og deploy-verify-kørsler. Spillere er anonymiseret.

## #5692 (Supabase ghwvkxzhsbbltzfnuhhz, postgres_logs, 7 x 24h-vinduer 8/10 11:00Z - 15/10 ~11:00Z)
| Vindue (UTC) | lock timeout (alle) | lock timeout m. team_race_points | statement timeout | slow-log refresh_team_race (>10 s) | linjer |
|---|---|---|---|---|---|
| 08/10 11 - 09/10 11 | 0 | 0 | 0 | 0 | 634 |
| 09/10 11 - 10/10 11 | 0 | 0 | 0 | 0 | 627 |
| 10/10 11 - 11/10 11 | 1 (22:10:24, uden query-tekst) | 0 | 2 | 0 | 681 |
| 11/10 11 - 12/10 11 | 0 | 0 | 0 | 0 | 655 |
| 12/10 11 - 13/10 11 | 0 | 0 | 0 | 3 | 597 |
| 13/10 11 - 14/10 11 | 0 | 0 | 0 | 0 | 678 |
| 14/10 - 15/10 (UTC-dage) | 0 | 0 | 2 (18:40:49/55) | 3 (10.09 s, 21.99 s, 10.24 s) | 747 |

pg_stat_statements (siden seneste reset): RPC refresh_team_race_points_mv(p_concurrently,p_owner_token,p_target_version) 273 kald, mean 3666.7 ms, min 2561.3 ms, max 23018.1 ms; 1-arg-variant 16 kald, mean 2740.0 ms, max 3336.1 ms. p50 findes ikke i pg_stat_statements.
Funktioner: 3 overloads; () delegerer, (boolean) og (boolean,uuid,bigint,timestamptz) indeholder CONCURRENTLY.
ranking_refresh_work_state: requested=completed=1338, dirty_since NULL, ingen lease, consecutive_failures 0, last_completed_at 2026-10-15 11:06:00Z.
Sentry CYCLINGZONE-2G (stall-watchdog matview): 3 events/7d (10/10 16:47, 11/10 13:07, 12/10 14:35 UTC), 0 siden.


**Dom #5692:** 0 låsefejl på `team_race_points_mv` på 7 dage; refresh kører CONCURRENTLY; work-state sund. Fejlen er væk. Restpunkt: 6 refreshes over 10 s (max 23 s) uden spillervendt låsning.

## #5162 (Sentry CYCLINGZONE-56, 7d)
15 events, 7 indloggede brugere + 2 anonyme (Windows Chrome 148, /login, geo Boardman US, tz UTC = sandsynlig bot/crawler).
Én spiller står for 6 af 15 (Chrome Mobile iOS + Chrome Windows).
Ruter: /notifications 5, /dashboard 4, /auctions 3, /login 2, /academy 1.
Browsere: iOS 8 (Chrome iOS 5, Safari 3), Android 4, Windows 3.
Pr. dag (UTC): 8/10 3, 9/10 2, 10/10 3, 11/10 2, 12/10 1, 13/10 1, 14/10 1, 15/10 2.
Seneste fejlende chunk https://cyclingzone.org/assets/clarityIntegration-BRDjIVc0.js -> HTTP 200 nu (curl 15/10) = carry-forward (#6310 merget 8/10, #6477 merget 11/10) bevarer gamle assets; fejlen er ikke længere 404-versionsbrud men forbigaaende fetch-fejl i klienten.
Deploy-kadence: ~60 deploy-verify-koersler 14/10 alene; events koerer paa aeldre releases (stale faner).

**Dom #5162:** epic'ets årsag (404 ved versionsbrud) er væk; gamle filer svarer 200 efter #6310 og #6477. Resten er 1-3 forbigående hentefejl pr. dag på ældre faner under hyppige deploys. Under tærskel; epic kan lukkes. Mulige næste skridt (ikke bygget): filtrér bot-trafik i Sentry, og se på iOS + /notifications.

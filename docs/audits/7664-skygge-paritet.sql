SELECT
  to_char(now() AT TIME ZONE 'Europe/Copenhagen', 'DD/MM HH24:MI:SS') AS maalt_dk,
  (SELECT count(*) FROM public.ranking_dirty_log) AS skygge_koe_poster,
  (SELECT to_char(refreshed_at AT TIME ZONE 'Europe/Copenhagen', 'DD/MM HH24:MI') FROM public.matview_refresh_heartbeat WHERE matview_group = 'ranking') AS matviews_sidst_dk,
  (SELECT count(*) FROM public.rider_rankings_mv) AS rytter_gammel,
  (SELECT count(*) FROM public.ranking_rider_season) AS rytter_ny,
  (SELECT count(*) FROM (SELECT * FROM public.rider_rankings_mv EXCEPT ALL SELECT * FROM public.ranking_rider_season) d) AS rytter_gammel_uden_ny,
  (SELECT count(*) FROM (SELECT * FROM public.ranking_rider_season EXCEPT ALL SELECT * FROM public.rider_rankings_mv) d) AS rytter_ny_uden_gammel,
  (SELECT count(*) FROM public.youth_rider_rankings_mv) AS ungdom_gammel,
  (SELECT count(*) FROM public.ranking_youth_rider_season) AS ungdom_ny,
  (SELECT count(*) FROM (SELECT * FROM public.youth_rider_rankings_mv EXCEPT ALL SELECT * FROM public.ranking_youth_rider_season) d) AS ungdom_gammel_uden_ny,
  (SELECT count(*) FROM (SELECT * FROM public.ranking_youth_rider_season EXCEPT ALL SELECT * FROM public.youth_rider_rankings_mv) d) AS ungdom_ny_uden_gammel,
  (SELECT count(*) FROM public.team_standings_ext_mv) AS holdtal_gammel,
  (SELECT count(*) FROM public.ranking_team_season_ext) AS holdtal_ny,
  (SELECT count(*) FROM (SELECT * FROM public.team_standings_ext_mv EXCEPT ALL SELECT * FROM public.ranking_team_season_ext) d) AS holdtal_gammel_uden_ny,
  (SELECT count(*) FROM (SELECT * FROM public.ranking_team_season_ext EXCEPT ALL SELECT * FROM public.team_standings_ext_mv) d) AS holdtal_ny_uden_gammel,
  (SELECT count(*) FROM public.team_race_points_mv) AS loebspoint_gammel,
  (SELECT count(*) FROM public.ranking_team_race_points) AS loebspoint_ny,
  (SELECT count(*) FROM (SELECT * FROM public.team_race_points_mv EXCEPT ALL SELECT * FROM public.ranking_team_race_points) d) AS loebspoint_gammel_uden_ny,
  (SELECT count(*) FROM (SELECT * FROM public.ranking_team_race_points EXCEPT ALL SELECT * FROM public.team_race_points_mv) d) AS loebspoint_ny_uden_gammel
/*
#7664: paritet mellem de fire rangliste-matviews og deres skyggetabeller (#6765).
Kun laesning. Een SELECT = eet snapshot, saa begge sider ses paa samme tidspunkt.
Koer igen efter taending af ranking_shadow_decoupled_6765 (alle "uden"-tal skal vaere 0,
naar skyggens koe er tom og ranglistens arbejde er rent).
Koersel (fra repo-roden, prod er laast til read-only + 60 s loft):
  infisical run --env=prod --silent -- node <laes-prod.mjs> docs/audits/7664-skygge-paritet.sql
Ingen navne i output, kun antal.
*/

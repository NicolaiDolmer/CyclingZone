-- #2512 — backfill seasons.race_days_completed / race_days_total til den korrekte
-- enhed (distinkte kalender-løbsdage = distinct races.game_day_start), for den
-- sæson der er aktiv NÅR denne migration køres.
--
-- Baggrund: race_days_completed summerede tidligere SUM(stages) over ALLE
-- completede løb på tværs af ALLE divisioner (backend/lib/seasonRaceDays.js,
-- #804), mens race_days_total var et manuelt admin-tal sat FØR kalenderen
-- eksisterede (default 60). Prod (16/7): race_days_completed=524 mod
-- race_days_total=60 — permanent "slutfase"-lås af getBoardRenegotiationLock
-- (backend/lib/boardRequests.js) + kunstigt tidlig boardMidSeason-midpoint.
--
-- Ny enhed (kode-fix i backend/lib/seasonRaceDays.js, samme PR): ÉT race day =
-- én distinkt game_day_start-værdi. race_days_completed = distinkte
-- game_day_start blandt completede løb; race_days_total = distinkte
-- game_day_start blandt ALLE løb i sæsonens kalender.
--
-- Denne fil COMMITTES kun. Den må ALDRIG anvendes automatisk (ingen
-- apply_migration/execute_sql-mutation under implementering) — ejeren kører den
-- manuelt mod prod efter merge, som et separat post-merge-skridt.
--
-- Efter denne engangs-backfill er tallene i øvrigt selv-helende: enhver
-- resultat-import kalder recomputeSeasonRaceDays, som skriver begge felter fra
-- kalenderens sandhed igen (idempotent, ingen delta-increment).

update seasons s
set
  race_days_completed = coalesce(rd.completed_days, 0),
  race_days_total = coalesce(rd.total_days, 0)
from (
  select
    r.season_id,
    count(distinct r.game_day_start) filter (where r.status = 'completed') as completed_days,
    count(distinct r.game_day_start) as total_days
  from races r
  where r.game_day_start is not null
  group by r.season_id
) rd
where rd.season_id = s.id
  and s.status = 'active';

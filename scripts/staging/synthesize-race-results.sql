-- synthesize-race-results.sql - KUN load-test-staging (#5904). Syntetisk resultat-historik i
-- prod-stoerrelse. Ingen prod-data: felter og raekkefoelger afledes af stagings egne races,
-- race_entries og ryttere; raekkefoelgen er en deterministisk md5-hash, ikke motor-output.
--
-- psql-variabler (kraeves):
--   :pinned_season  uuid for den saeson load-testens loebsdag ligger i (staging: aktiv saeson)
--   :pinned_day     game day for den pinned loebsdag; KUN loeb der er helt faerdige FOER
--                   denne dag faar historik, saa selve loebsdagen og alt efter er uroert.
-- Omfang: alle completed loeb i andre saesoner + pinned-saesonens seniorloeb der slutter foer
-- :pinned_day. Felt = loebets race_entries; mangler de, holdenes trupper i puljen (maks 8
-- pr. hold). Pr. etape: stage/gc/points/mountain/young (+ *_day ved etapeloeb) pr. rytter og
-- team (+ team_day) pr. hold. Pinned-saesonens daekkede loeb markeres completed +
-- prize_paid_at (ingen udbetaling sker; markoeren forhindrer at en praemie-/scheduler-sti
-- tager dem op igen).
--
-- Ét loeb pr. transaktion (\gexec): en enkelt 1,9 mio.-raekkers statement fik branch-
-- computens postmaster til at genstarte 5/10. Idempotent: loeb med resultater springes over,
-- saa en afbrudt koersel genoptages ved blot at koere scriptet igen.
\set ON_ERROR_STOP on
set session_replication_role = replica;  -- spent-day-triggeren er for live-skrivninger
set statement_timeout = 0;

create temp table syn_races as
select r.id, r.stages, r.league_division_id, r.season_id
from public.races r
where not exists (select 1 from public.race_results x where x.race_id = r.id)
  and coalesce(r.stages, 0) > 0
  and ((r.season_id <> :'pinned_season'::uuid and r.status = 'completed')
    or (r.season_id = :'pinned_season'::uuid and coalesce(r.squad, 'senior') = 'senior'
        and r.game_day_start is not null and r.game_day_start + r.stages - 1 < :'pinned_day'::int));

create function pg_temp.syn_race(p_race uuid, p_pinned_season uuid) returns void language plpgsql as $f$
declare v_stages int; v_div uuid; v_season uuid;
begin
  select stages, league_division_id, season_id into v_stages, v_div, v_season from pg_temp.syn_races where id = p_race;
  if exists (select 1 from public.race_results x where x.race_id = p_race) then return; end if;

  create temp table if not exists syn_field (rider_id uuid, team_id uuid);
  truncate syn_field;
  insert into syn_field select e.rider_id, e.team_id from public.race_entries e where e.race_id = p_race;
  if not found then
    insert into syn_field
    select x.rider_id, x.team_id from (
      select r.id as rider_id, r.team_id, row_number() over (partition by r.team_id order by r.id) as k
      from public.teams t join public.riders r on r.team_id = t.id
      where t.league_division_id = v_div and t.retired_at is null
    ) x where x.k <= 8;
  end if;

  insert into public.race_results (race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name,
    finish_time, points_earned, prize_money, entrant_uid, imported_at)
  select p_race, q.stage_number, q.result_type, q.rnk, q.rider_id, q.rider_name, q.team_id, 'Team ' || left(q.team_id::text, 8),
    make_interval(secs => 14400 + q.rnk * 7)::text, greatest(0, 31 - q.rnk), 0, q.rider_id::text, now()
  from (
    select g.stage_number, ty.result_type, f.rider_id, f.team_id,
           trim(coalesce(rd.firstname, '') || ' ' || coalesce(rd.lastname, '')) as rider_name,
           row_number() over (partition by g.stage_number, ty.result_type
                              order by md5(p_race::text || g.stage_number || ty.result_type || f.rider_id::text)) as rnk
    from syn_field f
    cross join generate_series(1, v_stages) as g(stage_number)
    join (values ('stage', false), ('gc', false), ('points', false), ('mountain', false), ('young', false),
                 ('points_day', true), ('mountain_day', true), ('young_day', true)) as ty(result_type, multi_only)
      on (not ty.multi_only or v_stages > 1)
    left join public.riders rd on rd.id = f.rider_id
    where f.rider_id is not null
  ) q;

  insert into public.race_results (race_id, stage_number, result_type, rank, team_id, team_name, finish_time,
    points_earned, prize_money, entrant_uid, imported_at)
  select p_race, q.stage_number, q.result_type, q.rnk, q.team_id, 'Team ' || left(q.team_id::text, 8),
    make_interval(secs => 43200 + q.rnk * 11)::text, 0, 0, q.team_id::text, now()
  from (
    select g.stage_number, ty.result_type, t.team_id,
           row_number() over (partition by g.stage_number, ty.result_type
                              order by md5(p_race::text || g.stage_number || ty.result_type || t.team_id::text)) as rnk
    from (select distinct team_id from syn_field where team_id is not null) t
    cross join generate_series(1, v_stages) as g(stage_number)
    join (values ('team', false), ('team_day', true)) as ty(result_type, multi_only) on (not ty.multi_only or v_stages > 1)
  ) q;

  if v_season = p_pinned_season then
    update public.races set status = 'completed', stages_completed = stages, prize_paid_at = coalesce(prize_paid_at, now())
    where id = p_race;
  end if;
end $f$;

select count(*) as syn_races_pending from syn_races;
select format('select pg_temp.syn_race(%L, %L)', id, :'pinned_season') from syn_races order by season_id, id \gexec
set session_replication_role = origin;
analyze public.race_results;
select count(*) as race_results_total from public.race_results;

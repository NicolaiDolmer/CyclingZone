-- synthesize-race-results.sql - KUN load-test-staging (#5904). Syntetisk resultat-historik i
-- prod-stoerrelse. Ingen prod-data: felter og raekkefoelger afledes af stagings egne races,
-- race_entries og ryttere; raekkefoelgen er en deterministisk md5-hash, ikke motor-output.
--
-- psql-variabler (kraeves):
--   :pinned_season  uuid for den sæson load-testens loebsdag ligger i (staging: aktiv sæson)
--   :pinned_day     game day for den pinned loebsdag; KUN loeb der er helt faerdige FOER
--                   denne dag faar historik, saa selve loebsdagen og alt efter er urørt.
-- Omfang: alle completed loeb i andre saesoner + pinned-saesonens loeb der slutter foer
-- :pinned_day. Felt = loebets race_entries; mangler de, holdenes trupper i puljen (maks 8
-- pr. hold). Pr. etape: stage/gc/points/mountain/young (+ *_day ved etapeloeb) pr. rytter og
-- team (+ team_day) pr. hold. Idempotent: loeb der allerede har resultater springes over.
-- Pinned-saesonens dækkede loeb markeres completed + prize_paid_at (ingen udbetaling sker;
-- markoeren forhindrer netop at en praemie-/scheduler-sti tager dem op igen).
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;  -- spent-day-triggeren er for live-skrivninger
set local statement_timeout = 0;

create temp table syn_races on commit drop as
select r.id, r.stages, r.league_division_id
from public.races r
where not exists (select 1 from public.race_results x where x.race_id = r.id)
  and coalesce(r.stages, 0) > 0
  and ((r.season_id <> :'pinned_season'::uuid and r.status = 'completed')
    or (r.season_id = :'pinned_season'::uuid and coalesce(r.squad, 'senior') = 'senior'
        and r.game_day_start is not null and r.game_day_start + r.stages - 1 < :'pinned_day'::int));

create temp table syn_field on commit drop as
select e.race_id, e.rider_id, e.team_id
from public.race_entries e join syn_races s on s.id = e.race_id
union all
select s.id, x.rider_id, x.team_id
from syn_races s
join lateral (
  select r.id as rider_id, r.team_id, row_number() over (partition by r.team_id order by r.id) as k
  from public.teams t join public.riders r on r.team_id = t.id
  where t.league_division_id = s.league_division_id and t.retired_at is null
) x on x.k <= 8
where not exists (select 1 from public.race_entries e where e.race_id = s.id);

create temp table syn_types (result_type text, multi_only boolean);
insert into syn_types values ('stage', false), ('gc', false), ('points', false), ('mountain', false), ('young', false),
  ('points_day', true), ('mountain_day', true), ('young_day', true);

insert into public.race_results (race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name,
  finish_time, points_earned, prize_money, entrant_uid, imported_at)
select q.race_id, q.stage_number, q.result_type, q.rnk, q.rider_id, q.rider_name, q.team_id, q.team_name,
  make_interval(secs => 14400 + q.rnk * 7)::text, greatest(0, 31 - q.rnk), 0, q.rider_id::text, now()
from (
  select f.race_id, g.stage_number, ty.result_type, f.rider_id, f.team_id,
         trim(coalesce(rd.firstname, '') || ' ' || coalesce(rd.lastname, '')) as rider_name,
         'Team ' || left(f.team_id::text, 8) as team_name,
         row_number() over (partition by f.race_id, g.stage_number, ty.result_type
                            order by md5(f.race_id::text || g.stage_number || ty.result_type || f.rider_id::text)) as rnk
  from syn_field f
  join syn_races s on s.id = f.race_id
  cross join lateral generate_series(1, s.stages) as g(stage_number)
  join syn_types ty on (not ty.multi_only or s.stages > 1)
  left join public.riders rd on rd.id = f.rider_id
) q;

insert into public.race_results (race_id, stage_number, result_type, rank, team_id, team_name, finish_time,
  points_earned, prize_money, entrant_uid, imported_at)
select q.race_id, q.stage_number, q.result_type, q.rnk, q.team_id, 'Team ' || left(q.team_id::text, 8),
  make_interval(secs => 43200 + q.rnk * 11)::text, 0, 0, q.team_id::text, now()
from (
  select t.race_id, g.stage_number, ty.result_type, t.team_id,
         row_number() over (partition by t.race_id, g.stage_number, ty.result_type
                            order by md5(t.race_id::text || g.stage_number || ty.result_type || t.team_id::text)) as rnk
  from (select distinct race_id, team_id from syn_field where team_id is not null) t
  join syn_races s on s.id = t.race_id
  cross join lateral generate_series(1, s.stages) as g(stage_number)
  join (values ('team', false), ('team_day', true)) as ty(result_type, multi_only) on (not ty.multi_only or s.stages > 1)
) q;

update public.races r set status = 'completed', stages_completed = r.stages, prize_paid_at = coalesce(r.prize_paid_at, now())
from syn_races s where r.id = s.id and r.season_id = :'pinned_season'::uuid;

select count(*) as syn_races, (select count(*) from syn_field) as syn_field_rows from syn_races;
commit;
analyze public.race_results;

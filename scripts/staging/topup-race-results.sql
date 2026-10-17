-- topup-race-results.sql - KUN load-test-staging (#5904/#6275). Fylder den aktive saesons
-- forfaldne etaper op med syntetiske resultater, saa staging naar prods resultatvolumen OG
-- har en ren loebsdag at pinne (ingen backlog foer uret).
--
-- Forskel fra synthesize-race-results.sql (historik for afsluttede loeb, kun senior):
--   - uret er et tidspunkt (pinned_clock), ikke en game day. En etape "er sket", hvis den
--     staar i race_stage_schedule med scheduled_at < pinned_clock. Det er samme definition,
--     som race-day-sim.mjs bruger til PLAN_BACKLOG_BEFORE_CLOCK.
--   - alle trupper (senior, U23, junior).
--   - loeb, der krydser uret (fx en grand tour), faar kun etaperne foer uret og bliver
--     'active' med stages_completed sat. Etaperne efter uret er uroerte.
--   - ingen \gexec og ingen psql-variabler: hjaelperen bor i schemaet cz_loadtest (ikke
--     public, saa schema-fingeraftrykket er uroert) og kaldes i portioner. Det virker baade
--     fra psql og fra Supabase MCP execute_sql (én transaktion pr. kald).
--
-- Brug (staging-ref pywxpnynzmbukdvoiazp, ALDRIG prod):
--   1) koer denne fil (opretter schema + funktioner; idempotent)
--   2) gentag til remaining_stages = 0:
--        select cz_loadtest.topup_batch('2026-10-19T00:00:00+02:00', 15);
--   3) oprydning:  drop schema cz_loadtest cascade;  analyze public.race_results;
--
-- Raekkefoelgen i hver etape er en deterministisk md5-hash, ikke motor-output. Ingen prod-data.
-- Triggere er TAENDT (MCP-rollen maa ikke saette session_replication_role, maalt 17/10):
-- spent-day-vagten fylder race_day_participation som i prod, statusskiftet genopbygger
-- race_entry_days, og ranglisten markeres dirty. Ryttere, der allerede har en anden
-- deltagelse samme game day, udelades, saa vagten aldrig afviser portionen.
-- Afsluttede loeb faar prize_paid_at (ingen udbetaling sker; markoeren holder praemie-stien vaek).

create schema if not exists cz_loadtest;
revoke all on schema cz_loadtest from public, anon, authenticated;

create or replace function cz_loadtest.syn_stage(p_race uuid, p_stage int, p_multi boolean)
returns bigint language plpgsql as $f$
declare v_rows bigint := 0; v_n bigint; v_season uuid; v_day int;
begin
  if exists (select 1 from public.race_results x where x.race_id = p_race and x.stage_number = p_stage) then
    return 0;
  end if;
  select r.season_id, s.game_day into v_season, v_day
  from public.races r join public.race_stage_schedule s on s.race_id = r.id
  where r.id = p_race and s.stage_number = p_stage;

  insert into public.race_results (race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name,
    finish_time, points_earned, prize_money, entrant_uid, imported_at)
  select p_race, p_stage, q.result_type, q.rnk, q.rider_id, q.rider_name, q.team_id, 'Team ' || left(q.team_id::text, 8),
    make_interval(secs => 14400 + q.rnk * 7)::text, greatest(0, 31 - q.rnk), 0, q.rider_id::text, now()
  from (
    select ty.result_type, f.rider_id, f.team_id,
           trim(coalesce(rd.firstname, '') || ' ' || coalesce(rd.lastname, '')) as rider_name,
           row_number() over (partition by ty.result_type
                              order by md5(p_race::text || p_stage || ty.result_type || f.rider_id::text)) as rnk
    -- distinct on rytter: race_results_entrant_unique er pr. (loeb, etape, type, entrant).
    -- Spent-day-vagten (admit_race_participant) afviser en rytter, der allerede har koert
    -- et andet loeb samme game day; saadan en rytter udelades her i stedet.
    from (select distinct on (e.rider_id) e.rider_id, e.team_id from public.race_entries e
          where e.race_id = p_race and e.rider_id is not null
            and not exists (select 1 from public.race_day_participation p
                            where p.rider_id = e.rider_id and p.season_id = v_season and p.game_day = v_day
                              and (p.race_id <> p_race or p.stage_number <> p_stage))
          order by e.rider_id, e.team_id) f
    join (values ('stage', false), ('gc', false), ('points', false), ('mountain', false), ('young', false),
                 ('points_day', true), ('mountain_day', true), ('young_day', true)) as ty(result_type, multi_only)
      on (not ty.multi_only or p_multi)
    left join public.riders rd on rd.id = f.rider_id
  ) q;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  insert into public.race_results (race_id, stage_number, result_type, rank, team_id, team_name, finish_time,
    points_earned, prize_money, entrant_uid, imported_at)
  select p_race, p_stage, q.result_type, q.rnk, q.team_id, 'Team ' || left(q.team_id::text, 8),
    make_interval(secs => 43200 + q.rnk * 11)::text, 0, 0, q.team_id::text, now()
  from (
    select ty.result_type, t.team_id,
           row_number() over (partition by ty.result_type
                              order by md5(p_race::text || p_stage || ty.result_type || t.team_id::text)) as rnk
    from (select distinct e.team_id from public.race_entries e where e.race_id = p_race and e.team_id is not null) t
    join (values ('team', false), ('team_day', true)) as ty(result_type, multi_only) on (not ty.multi_only or p_multi)
  ) q;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  return v_rows;
end $f$;

-- Én portion = op til p_races loeb. Returnerer hvad der skete + hvad der staar tilbage.
create or replace function cz_loadtest.topup_batch(p_clock timestamptz, p_races int default 15)
returns jsonb language plpgsql as $f$
declare
  v_race record; v_stage record; v_rows bigint := 0; v_done int := 0; v_last int; v_remaining bigint;
begin
  perform set_config('statement_timeout', '0', true);
  for v_race in
    select r.id, r.stages, coalesce(r.stages_completed, 0) as done
    from public.races r join public.seasons s on s.id = r.season_id and s.status = 'active'
    where r.status <> 'completed' and coalesce(r.stages, 0) > 0
      and exists (select 1 from public.race_stage_schedule q
                  where q.race_id = r.id and q.scheduled_at < p_clock and q.stage_number > coalesce(r.stages_completed, 0))
    order by r.id
    limit p_races
  loop
    v_last := v_race.done;
    for v_stage in
      select q.stage_number from public.race_stage_schedule q
      where q.race_id = v_race.id and q.scheduled_at < p_clock and q.stage_number > v_race.done
      order by q.stage_number
    loop
      v_rows := v_rows + cz_loadtest.syn_stage(v_race.id, v_stage.stage_number, v_race.stages > 1);
      v_last := v_stage.stage_number;
    end loop;
    if v_last >= v_race.stages then
      update public.races set status = 'completed', stages_completed = stages,
        prize_paid_at = coalesce(prize_paid_at, now()) where id = v_race.id;
    else
      update public.races set status = 'active', stages_completed = v_last where id = v_race.id;
    end if;
    v_done := v_done + 1;
  end loop;

  select count(*) into v_remaining
  from public.races r join public.seasons s on s.id = r.season_id and s.status = 'active'
  join public.race_stage_schedule q on q.race_id = r.id
  where r.status <> 'completed' and q.scheduled_at < p_clock and q.stage_number > coalesce(r.stages_completed, 0);

  return jsonb_build_object('races', v_done, 'rows', v_rows, 'remaining_stages', v_remaining);
end $f$;

revoke all on all functions in schema cz_loadtest from public, anon, authenticated;

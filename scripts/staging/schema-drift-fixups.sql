-- schema-drift-fixups.sql - KUN staging (#5904). Kendte, maalte forskelle mellem
-- "repoets migrationer anvendt i prod-raekkefoelge" og prods faktiske schema, som ikke
-- er funktionelle men goer fingeraftrykket uens. Hver blok er idempotent.
--
-- 1) race_entry_days_rebuild: prods krop er den fra 2026-08-25-4217-spaend-binding.sql
--    uden SQL-kommentarer (anvendt via en sti der strippede dem). Logikken er identisk;
--    her genskabes prods byte-version, saa funktions-fingeraftrykket matcher.
CREATE OR REPLACE FUNCTION public.race_entry_days_rebuild(p_race_id uuid, p_team_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_binding boolean;
begin
  v_binding := not (
       exists (select 1 from public.races r
                where r.id = p_race_id and r.status = 'completed')
    or exists (select 1 from public.race_withdrawals w
                where w.race_id = p_race_id and w.team_id = p_team_id)
    or exists (select 1 from public.race_stage_schedule s
                where s.race_id = p_race_id and s.game_day is null)
    or coalesce((select min(s.game_day) from public.race_stage_schedule s
                  where s.race_id = p_race_id), 0) >= 100000
  );

  with span as (
    select min(s.game_day) as gd_min, max(s.game_day) as gd_max
      from public.race_stage_schedule s
     where s.race_id = p_race_id
       and s.game_day is not null
  ),
  want as (
    select e.race_id, e.rider_id, r.season_id, gs.game_day, e.team_id
      from public.race_entries e
      join public.races r on r.id = e.race_id
      cross join span
      cross join lateral generate_series(span.gd_min, span.gd_max) as gs(game_day)
     where v_binding
       and e.race_id = p_race_id
       and e.team_id = p_team_id
       and span.gd_min is not null
  ),
  gone as (
    delete from public.race_entry_days d
     where d.race_id = p_race_id
       and d.team_id = p_team_id
       and not exists (select 1 from want w
                        where w.rider_id = d.rider_id and w.game_day = d.game_day)
    returning 1
  )
  insert into public.race_entry_days (race_id, rider_id, season_id, game_day, team_id)
  select w.race_id, w.rider_id, w.season_id, w.game_day, w.team_id
    from want w
   where not exists (select 1 from public.race_entry_days d
                      where d.race_id = p_race_id
                        and d.team_id = p_team_id
                        and d.rider_id = w.rider_id
                        and d.game_day = w.game_day)
  on conflict (race_id, rider_id, game_day) do nothing;
end;
$function$;

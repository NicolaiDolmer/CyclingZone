-- Refs #7153. Manager-only atomic replacement and voluntary rejoin.
-- Based on the current #5246 bulk writer, preserving audit logs and deferred swaps.
-- No repair/backfill and no backup-table changes. Automations keep their existing RPCs.
BEGIN;
create or replace function public.replace_manager_race_selections(
  p_team_id uuid,
  p_changes jsonb,
  p_auto_releases jsonb,
  p_now timestamptz
)
returns void
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_change jsonb;
  v_release jsonb;
  v_race_id uuid;
  v_rider_ids uuid[];
  v_roles text[];
  v_len int;
  v_frozen boolean;
  v_withdrawn boolean;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'selection_invalid_body' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_changes) > 60 then
    raise exception 'selection_bulk_too_large' using errcode = 'check_violation';
  end if;

  -- Never wait with an injected request timestamp: caller retries a busy save.
  if not pg_try_advisory_xact_lock(hashtext(p_team_id::text)) then
    raise exception 'selection_save_busy' using errcode = 'lock_not_available';
  end if;


  if p_now is null then
    raise exception 'selection_invalid_body' using errcode = 'check_violation';
  end if;
  if (select count(distinct c->>'race_id') from jsonb_array_elements(p_changes) c) <> jsonb_array_length(p_changes) then
    raise exception 'selection_duplicate_race' using errcode = 'check_violation';
  end if;
  -- Serialize against race-state changes, in a stable order across teams.
  perform 1 from public.races r
   where r.id in (
     select (c->>'race_id')::uuid from jsonb_array_elements(p_changes) c
     union select (c->>'race_id')::uuid from jsonb_array_elements(coalesce(p_auto_releases,'[]'::jsonb)) c
   ) order by r.id for update nowait;
  perform 1 from public.race_withdrawals w where w.team_id=p_team_id
    and w.race_id in (select (c->>'race_id')::uuid from jsonb_array_elements(p_changes) c)
    order by w.race_id for update nowait;

  -- Check every voluntary rejoin before any auto-release or replacement.
  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_race_id := (v_change->>'race_id')::uuid;
    select exists(select 1 from public.race_withdrawals w
      where w.race_id=v_race_id and w.team_id=p_team_id) into v_withdrawn;
    if exists(select 1 from public.race_withdrawals w where w.race_id=v_race_id
      and w.team_id=p_team_id and w.withdrawn_reason='did_not_start') then
      raise exception 'selection_withdrawn' using errcode = 'check_violation';
    end if;
    if exists(select 1 from public.races r where r.id=v_race_id
      and (r.status='completed' or coalesce(r.stages_completed,0)>0))
      or exists(select 1 from public.race_stage_schedule s where s.race_id=v_race_id
        and s.stage_number=1 and s.scheduled_at<=p_now) then
      if v_withdrawn then
        raise exception 'selection_withdrawn_locked' using errcode = 'check_violation';
      end if;
      raise exception 'selection_race_started' using errcode = 'check_violation';
    end if;
    -- Rejoin never removes a rider from another race, including auto entries.
    if v_withdrawn and exists(
      select 1 from public.race_entry_days d join public.races r on r.id=v_race_id
      where d.team_id=p_team_id and d.race_id<>v_race_id and d.season_id=r.season_id
        and d.rider_id in (select x::uuid from jsonb_array_elements_text(v_change->'rider_ids') t(x))
        and d.game_day between (select min(game_day) from public.race_stage_schedule where race_id=v_race_id)
          and (select max(game_day) from public.race_stage_schedule where race_id=v_race_id)
    ) then
      raise exception 'selection_rider_bound' using errcode = 'check_violation';
    end if;
  end loop;

  set constraints no_rider_double_booking_day deferred;

  for v_release in select * from jsonb_array_elements(coalesce(p_auto_releases, '[]'::jsonb)) loop
    if exists (
      select 1 from public.races r
       where r.id = (v_release->>'race_id')::uuid
         and (r.status <> 'scheduled' or coalesce(r.stages_completed, 0) > 0)
    ) or exists (select 1 from public.race_stage_schedule s
      where s.race_id=(v_release->>'race_id')::uuid and s.stage_number=1 and s.scheduled_at<=p_now) then
      raise exception 'selection_rider_bound' using errcode = 'check_violation';
    end if;

    delete from public.race_entries
     where race_id = (v_release->>'race_id')::uuid
       and team_id = p_team_id
       and rider_id = (v_release->>'rider_id')::uuid
       and is_auto_filled = true;

    perform public.race_entry_days_rebuild((v_release->>'race_id')::uuid, p_team_id);
  end loop;

  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_race_id := (v_change->>'race_id')::uuid;

    select array_agg(x::uuid) into v_rider_ids
      from jsonb_array_elements_text(coalesce(v_change->'rider_ids', '[]'::jsonb)) t(x);
    v_rider_ids := coalesce(v_rider_ids, '{}'::uuid[]);

    select array_agg(x) into v_roles
      from jsonb_array_elements_text(coalesce(v_change->'roles', '[]'::jsonb)) t(x);
    v_roles := coalesce(v_roles, '{}'::text[]);

    v_len := coalesce(array_length(v_rider_ids, 1), 0);
    if coalesce(array_length(v_roles, 1), 0) <> v_len then
      raise exception 'selection_invalid_body' using errcode = 'check_violation';
    end if;

    if exists (
      select 1 from public.races r
       where r.id = v_race_id and r.status <> 'scheduled'
    ) then
      raise exception 'selection_race_not_open' using errcode = 'check_violation';
    end if;

    select coalesce(r.stages_completed, 0) > 0
      into v_frozen
      from public.races r
     where r.id = v_race_id;

    if v_frozen then
      raise exception 'selection_race_started' using errcode = 'check_violation';
    end if;

    insert into public.race_entry_overrides (race_id, team_id, had_auto_filled, auto_source)
    select
      v_race_id,
      p_team_id,
      coalesce(bool_or(is_auto_filled), false),
      case
        when not coalesce(bool_or(is_auto_filled), false) then null
        when count(distinct coalesce(auto_filled_source, 'unknown')) filter (where is_auto_filled) = 1
          then min(coalesce(auto_filled_source, 'unknown')) filter (where is_auto_filled)
        else 'mixed'
      end
    from public.race_entries
    where race_id = v_race_id and team_id = p_team_id;

    delete from public.race_entries where race_id = v_race_id and team_id = p_team_id;

    -- Old entries MUST be gone before the withdrawal trigger rebinds the team.
    delete from public.race_withdrawals where race_id=v_race_id and team_id=p_team_id
      and withdrawn_reason is distinct from 'did_not_start';

    if v_len > 0 then
      insert into public.race_entries (race_id, rider_id, team_id, race_role, is_auto_filled)
      select v_race_id, v_rider_ids[i], p_team_id, v_roles[i], false
      from generate_series(1, v_len) as g(i);
    end if;

    perform public.race_entry_days_rebuild(v_race_id, p_team_id);
  end loop;

  begin
    set constraints no_rider_double_booking_day immediate;
  exception when unique_violation then
    raise exception 'selection_rider_bound' using errcode = 'check_violation';
  end;
exception when lock_not_available then
  raise exception 'selection_save_busy' using errcode = 'lock_not_available';
end;
$function$;


REVOKE ALL ON FUNCTION public.replace_manager_race_selections(uuid,jsonb,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_manager_race_selections(uuid,jsonb,jsonb,timestamptz) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

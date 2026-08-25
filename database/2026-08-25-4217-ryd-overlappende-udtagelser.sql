-- #4217 — ryd de udtagelser der bryder spænd-bindingen. DESTRUKTIV, ejer-gated.
--
-- Køres FØR eller SAMMEN MED 2026-08-25-4217-spaend-binding.sql: den nye ønske-mængde
-- kan ikke skrives så længe en rytter står i to løb hvis spænd overlapper.
--
-- PRIORITET (hvilken udtagelse overlever):
--   1. spillerens eget valg (is_auto_filled = false) slår assistentens
--   2. flest etaper vinder — GT > etapeløb > endagsløb
--   3. tidligste løbsdag vinder
--   4. race_id som tie-break → deterministisk kørsel
--
-- DER GENUDFYLDES IKKE. Ejer-direktiv 25/8: "ikke gå ind og spille spillet på vegne af
-- spillerne". Den frigjorte plads står tom til spilleren selv udtager. Assistentens
-- proaktive sweep er samtidig lukket for spillerhold (#4217 i raceEntryGenerator.js).
--
-- DRY-RUN er default. Sæt v_apply := true for at slette.
--
-- Refs #4217 #4173 #4209 #4200 #4201

do $$
declare
  v_apply    boolean := false;  -- ← sæt true for at slette
  v_season   uuid;
  v_rider    uuid := null;
  v_kept     int[] := '{}';
  v_row      record;
  v_clash    boolean;
  v_i        int;
  v_deleted  int := 0;
  v_kept_cnt int := 0;
  v_manual   int := 0;
begin
  select id into v_season from public.seasons where status = 'active'
   order by number desc limit 1;
  if v_season is null then
    raise exception '#4217: ingen aktiv sæson';
  end if;

  create temp table if not exists cz_4214_drop (
    race_id uuid, rider_id uuid, team_id uuid,
    race_name text, is_auto_filled boolean, gd_min int, gd_max int
  ) on commit drop;
  delete from cz_4214_drop;

  -- Ét gennemløb pr. rytter i prioriteret orden. Behold en entry hvis dens spænd ikke
  -- rører noget allerede beholdt spænd for samme rytter; ellers markér den til sletning.
  for v_row in
    select e.race_id, e.rider_id, e.team_id, e.is_auto_filled, r.name as race_name,
           min(s.game_day) as gd_min, max(s.game_day) as gd_max,
           count(*) as stage_count
      from public.race_entries e
      join public.races r on r.id = e.race_id
      join public.race_stage_schedule s on s.race_id = e.race_id
     where r.season_id = v_season
       and r.status <> 'completed'
       and s.game_day is not null
       and s.game_day < 100000
       and not exists (select 1 from public.race_withdrawals w
                        where w.race_id = e.race_id and w.team_id = e.team_id)
     group by e.race_id, e.rider_id, e.team_id, e.is_auto_filled, r.name
     order by e.rider_id,
              e.is_auto_filled asc,          -- manuel (false) først
              count(*) desc,                 -- flest etaper
              min(s.game_day) asc,           -- tidligst
              e.race_id asc                  -- deterministisk
  loop
    if v_rider is distinct from v_row.rider_id then
      v_rider := v_row.rider_id;
      v_kept  := '{}';
    end if;

    v_clash := false;
    v_i := 1;
    while v_i <= coalesce(array_length(v_kept, 1), 0) loop
      -- v_kept holder par: [min1, max1, min2, max2, ...]
      if v_row.gd_min <= v_kept[v_i + 1] and v_kept[v_i] <= v_row.gd_max then
        v_clash := true;
        exit;
      end if;
      v_i := v_i + 2;
    end loop;

    if v_clash then
      insert into cz_4214_drop values (v_row.race_id, v_row.rider_id, v_row.team_id,
                                       v_row.race_name, v_row.is_auto_filled,
                                       v_row.gd_min, v_row.gd_max);
      v_deleted := v_deleted + 1;
      if not v_row.is_auto_filled then v_manual := v_manual + 1; end if;
    else
      v_kept := v_kept || v_row.gd_min || v_row.gd_max;
      v_kept_cnt := v_kept_cnt + 1;
    end if;
  end loop;

  raise notice '#4217 % — beholder %, fjerner % (heraf % manuelle)',
    case when v_apply then 'APPLY' else 'DRY-RUN' end, v_kept_cnt, v_deleted, v_manual;

  if v_apply then
    delete from public.race_entries e
     using cz_4214_drop d
     where e.race_id = d.race_id and e.rider_id = d.rider_id;
    raise notice '#4217 APPLY — % entries slettet', v_deleted;
  end if;
end $$;

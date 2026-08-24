-- scripts/race-entry-days-drift-audit.sql
-- Runtime-vagt for den AFLEDTE bindings-tabel (#4191, opfølgning på #4173).
--
-- HVORFOR. `race_entry_days` bærer invarianten "1 rytter = 1 løb pr. løbsdag". Den
-- udledes af (race_entries × race_stage_schedule) gennem `race_entry_days_rebuild`, og
-- fra #4191 skriver den funktionen kun FORSKELLEN i stedet for at rive mængden ned og
-- bygge den op forfra. Det fjerner ~85 % af skrivningerne — men det fjerner også den
-- utilsigtede selvhelbredelse en fuld genopbygning gav: gik en trigger glip af et kald,
-- rettede næste kald alligevel alt op.
--
-- Derfor denne vagt. Den spørger DATABASEN dagligt om den afledte tabel stadig er præcis
-- lig den mængde den skal være. Samme arbejdsdeling som constraint-form-audit.sql:
-- statiske tests kan se koden, kun en måling mod prod kan se dataen. Begge kalender-
-- hændelser i august (#4155, #4161) opstod i DATA med korrekt kode.
--
-- KONTRAKT. Tom output = alt i orden. Hver række er ét fund:
--     <retning>|<race_id>|<team_id>|<antal raekker>
--   mangler     = rækker der SKULLE findes men ikke gør (rytteren er ikke bundet, og to
--                 løb kan udtage ham samme løbsdag)
--   overskydende = rækker der findes men ikke skal (rytteren er bundet på en dag han
--                 ikke kører, og blokeres unødigt fra et andet løb)
--
-- Kørsel:
--   psql "$SUPABASE_DB_URL" -tA -F '|' -v ON_ERROR_STOP=1 -f scripts/race-entry-days-drift-audit.sql

with pairs as (
  select distinct e.race_id, e.team_id from public.race_entries e
),
binding as (
  -- Præcis de fire porte race_entry_days_rebuild bruger. Holdes i sync med
  -- database/2026-08-25-4191-race-entry-days-diff-rebuild.sql.
  select p.race_id, p.team_id,
    not (
         exists (select 1 from public.races r
                  where r.id = p.race_id and r.status = 'completed')
      or exists (select 1 from public.race_withdrawals w
                  where w.race_id = p.race_id and w.team_id = p.team_id)
      or exists (select 1 from public.race_stage_schedule s
                  where s.race_id = p.race_id and s.game_day is null)
      or coalesce((select min(s.game_day) from public.race_stage_schedule s
                    where s.race_id = p.race_id), 0) >= 100000
    ) as is_binding
  from pairs p
),
want as (
  select e.race_id, e.team_id, e.rider_id, s.game_day
    from public.race_entries e
    join binding b on b.race_id = e.race_id and b.team_id = e.team_id and b.is_binding
    join public.race_stage_schedule s on s.race_id = e.race_id
   where s.game_day is not null
   group by e.race_id, e.team_id, e.rider_id, s.game_day
),
har as (
  select race_id, team_id, rider_id, game_day from public.race_entry_days
),
mangler as (select race_id, team_id from (select * from want except select * from har) x),
ekstra  as (select race_id, team_id from (select * from har except select * from want) y)
select 'mangler' as retning, race_id::text, team_id::text, count(*)::text
  from mangler group by race_id, team_id
union all
select 'overskydende', race_id::text, team_id::text, count(*)::text
  from ekstra group by race_id, team_id
order by 1, 4 desc;

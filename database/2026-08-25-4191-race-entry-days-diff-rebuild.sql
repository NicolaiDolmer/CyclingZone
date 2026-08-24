-- #4191 — race_entry_days_rebuild: skriv KUN forskellen, ikke hele mængden forfra.
--
-- MÅLT MOD PROD 24/8-25/8 (kumulative tællere, pg_stat_user_tables):
--   race_entry_days   n_tup_ins 1.035.981   n_tup_del 899.822   ved 135.539 levende rækker
--   race_entries      n_tup_ins   137.691   n_tup_upd 135.006   ved 124.931 levende rækker
-- Den AFLEDTE tabel får altså 7,5 gange så mange inserts som kilden, og bærer 65 MB indeks
-- på 54 MB data.
--
-- ROD-ÅRSAG — to forstærkere, ikke én.
--   1. `race_entry_days_rebuild(race_id, team_id)` sletter ALLE dag-rækker for parret og
--      indsætter dem forfra ved hvert eneste kald, også når resultatet er identisk.
--   2. `trg_race_entries_sync_days` er FOR EACH ROW. En udtagelse på 7 ryttere fyrer altså
--      rebuilden 7 GANGE. AFTER ROW-triggere kører først når hele sætningen er færdig, så
--      alle 7 kald ser den samme, komplette mængde og skriver den samme mængde 7 gange.
--      Et 7-etapers løb med 7 ryttere: 49 rækker gemmes som 343 inserts + 294 deletes.
--      `trg_race_stage_schedule_resync_binding` er samme form — en 18-etapers Grand Tour
--      fyrer 18 gange, hver gang i loop over samtlige hold i løbet. Det er dén der drev
--      akse-reparationens churn 24/8.
--
-- HVAD DER ÆNDRES. Kun funktionens krop. Triggerne, deres betingelser og den resulterende
-- MÆNGDE er uændrede — det er kun VEJEN dertil der bliver en diff:
--   · slet kun de dag-rækker der ikke længere ønskes
--   · indsæt kun de der mangler
--   · lad resten ligge urørt
-- For en uændret udtagelse bliver det NUL skrivninger, og kald 2-7 fra samme sætning bliver
-- gratis. Forventet effekt: ~85 % færre inserts på race_entry_days.
--
-- SEMANTIK UÆNDRET. De fire porte (færdigkørt løb, afmeldt hold, delvist backfillet
-- schedule, monument-sentinel ≥100000) betyder præcis som før "den ønskede mængde er tom",
-- og en tom ønske-mængde sletter alt for parret. Det er samme udfald som de fire `return`
-- efter delete i den gamle krop.
--
-- HVORFOR NØGLEN ER (rider_id, game_day) OG IKKE OGSÅ season_id/team_id.
-- Slet- og indsæt-siden SKAL bruge samme nøgle som den unikke constraint
-- (race_id, rider_id, game_day). Matchede vi bredere, kunne en række både blive slettet af
-- CTE'en og afvist af `on conflict` i samme sætning — de to sider ser samme snapshot — og
-- rækken ville forsvinde. season_id kommer fra races.season_id og kan ikke drive for et
-- fast race_id, så der er intet at selv-hele.
--
-- IDEMPOTENT. CREATE OR REPLACE FUNCTION, ingen DDL på tabeller, ingen datasletning ud over
-- den funktionen allerede lavede. Kan køres igen uden effekt.

create or replace function public.race_entry_days_rebuild(p_race_id uuid, p_team_id uuid)
returns void
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_binding boolean;
begin
  -- Er løbet bindende for netop dette hold? Samme fire porte som før — nu som ét udtryk,
  -- så "ikke bindende" bliver en TOM ønske-mængde i stedet for et tidligt return.
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

  with want as (
    select e.race_id, e.rider_id, r.season_id, s.game_day, e.team_id
      from public.race_entries e
      join public.races r on r.id = e.race_id
      join public.race_stage_schedule s on s.race_id = e.race_id
     where v_binding
       and e.race_id = p_race_id
       and e.team_id = p_team_id
       and s.game_day is not null
     group by e.race_id, e.rider_id, r.season_id, s.game_day, e.team_id
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

comment on function public.race_entry_days_rebuild(uuid, uuid) is
  'Genopbygger race_entry_days for (løb, hold) som en DIFF: sletter kun de dage der '
  'forsvinder, indsætter kun de der kommer til. Uændret udtagelse = nul skrivninger (#4191).';

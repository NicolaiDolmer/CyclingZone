-- #4203 — byt de fire Monumenter der ligger i et GT-hviledags-slot med fire mindre
-- endagsløb (sæson 3, division 1).
--
-- EJER-DIREKTIV 24/8: "Monumenterne skal flyttes ud af GT-vinduerne." Og efterfølgende,
-- da alternativet blev lagt frem: "monumenter hører ikke til under gt's, sådan er det."
--
-- HVORFOR ET BYTTE OG IKKE BARE EN FLYTNING. #3470 (ejer-beslutning 6/8, se
-- backend/lib/grandTourRestDays.js) siger at en GT skal have hviledage som i
-- virkeligheden, MEN at hviledagen ikke må efterlade et hul i kalenderen — et endagsløb
-- fra puljen fylder samme game_day-slot. Målt i prod 24/8: hvert af de fire GT-huller
-- (ld 14, 26, 57, 72 i D1) indeholder PRÆCIS ét løb, og det er et Monument. Flyttede vi
-- dem bare ud, ville fire slots stå tomme og #3470 være brudt. Byttet holder begge
-- regler: intet Monument inde i et GT-vindue, og intet tomt hviledags-slot.
--
-- HVAD DER GIK GALT. #3470-designet hang sammen under interval-binding: GT-rytteren var
-- bundet hen over hviledagen og kunne ikke køre fyld-løbet, så slottet var til de andre
-- holds ryttere. #4173 skiftede til dag-baseret binding, GT-rytterne blev frie på
-- hviledagen, og entry-generatoren udtog dem straks til Monumentet:
--
--   Giro della Penisola   ld 14 → Milano–Riviera            30 Giro-ryttere
--   Giro della Penisola   ld 26 → La Doyenne des Ardennes   29 Giro-ryttere
--   Tour de l'Hexagone    ld 57 → De Vlaamse Ronde           7 Tour-ryttere
--   Vuelta Ibérica        ld 72 → L'Enfer du Nord           18 Vuelta-ryttere
--
-- 31/8 i D1 så sådan ud: Monument kl. 13:00, Giro-etape 4 kl. 14:00, etape 5 kl. 16:00,
-- etape 6 kl. 17:00 — fire løb på seks timer for de samme ryttere.
--
-- ANDEN HALVDEL, IKKE I DENNE MIGRATION. Byttet fjerner Monumenterne fra GT-vinduerne,
-- men GT-rytterne er stadig frie på hviledagen og vil blive udtaget til fyld-løbet i
-- stedet. At binde GT-ryttere hen over hviledagen kræver en ændring i
-- race_entry_days_rebuild(), som #4191 omskriver samtidig i en parallel session. To
-- omskrivninger af samme funktion samme aften taber den ene — derfor er den halvdel
-- skilt ud og bygger oven på #4191.
--
-- BYTTET (ejer-godkendt 24/8). Monumenterne ud i de to eneste frie vinduer (ld 0-9 =
-- 25/8-29/8, ld 30-42 = 5/9-10/9), i de virkelige Monumenters rækkefølge
-- (Sanremo → Ronde → Roubaix → Liège → Lombardia):
--
--   Milano–Riviera            ld 14 → ld  9    31/8 13:00 → 29/8 (lør) 17:00
--   De Vlaamse Ronde          ld 57 → ld 31    14/9 19:00 →  5/9 (lør) 15:00
--   L'Enfer du Nord           ld 72 → ld 35    19/9 11:00 →  7/9 (man) 18:00
--   La Doyenne des Ardennes   ld 26 → ld 42     3/9 19:00 → 10/9 (tor) 16:00
--   La Classica d'Autunno     ld 79 — uændret, lå allerede frit
--
-- Og fyld-løbene ind i de tomme hviledags-slots. Alle fire hentes fra 7.-10. september,
-- som netop var det klemte vindue, så byttet letter trængslen i stedet for at øge den.
-- Hvert fyld-løb overtager det slot og det klokkeslæt Monumentet forlader:
--
--   Le Mur de Huy                ld 34 → ld 14    7/9 15:00 → 31/8 13:00
--   La Classique Bretonne        ld 39 → ld 26    9/9 11:00 →  3/9 19:00
--   Taunus-Klassiker             ld 41 → ld 57   10/9 15:00 → 14/9 19:00
--   Grand Prix du Saint-Laurent  ld 42 → ld 72   10/9 19:00 → 19/9 11:00
--
-- Samlet antal løb pr. slot er uændret. Ingen etape flyttes uden for sæsonen (25/8-20/9).
--
-- PRISEN FOR MONUMENTERNE, MÅLT FØR APPLY (read-only, prod 24/8):
--   Monument                  hold m. >=8 frie ryttere   udtagelser der maa vaelges om
--   Milano–Riviera            19 af 24                   118 af 142
--   De Vlaamse Ronde          18 af 24                   112 af 128
--   L'Enfer du Nord           23 af 24                     3 af 128
--   La Doyenne des Ardennes   18 af 24                   122 af 142
-- Fyld-løbenes pris kan først måles når Monumenterne er ude af slottene, så den beregnes
-- af migrationen selv i fase 2 og logges i backup-tabellen.
--
-- De ryddede udtagelser er assistentens auto-udfyldning; entry-generator-sweepen fylder
-- felterne igen med ryttere der er frie i det nye slot. Alle slettede rækker gemmes i
-- backup_4203_removed_entries.
--
-- RÆKKEFØLGEN ER VIGTIG. Monumenterne flyttes UD først, så hviledags-slottene er tomme
-- når fyld-løbenes konflikter beregnes — ellers ville Monumentets egne ryttere tælle med
-- som konflikt for fyld-løbet.
--
-- IDEMPOTENT. Alle updates er `where ... is distinct from` (genkørsel = no-op),
-- konflikt-sættene er tomme ved genkørsel, backup-tabellerne er IF NOT EXISTS.
--
-- Refs #4203 #4173 #3470 #4190 #4176 #4191 #4159 #4202 #4161

\set ON_ERROR_STOP on

begin;

set local statement_timeout = '5min';

-- ---------------------------------------------------------------- 0. Planen
-- `if not exists` er formelt overflødigt (on commit drop → tabellen findes aldrig ved
-- transaktionsstart), men idempotens-guarden (#401) kræver formen på AL CREATE TABLE.
create temporary table if not exists flyt_4203 (
  fase       integer not null,          -- 1 = Monument ud, 2 = fyld-løb ind
  race_id    uuid primary key,
  navn       text    not null,
  maal_gd    integer not null,
  maal_tid   timestamptz not null
) on commit drop;

insert into flyt_4203 (fase, race_id, navn, maal_gd, maal_tid) values
  -- Fase 1: Monumenterne ud af GT-vinduerne.
  (1, 'eab2b221-7a4e-4fd5-86d7-901592bd24a0', 'Milano-Riviera',              9, '2026-08-29 15:00:00+00'),
  (1, '87682e31-cbe8-4aba-97e3-1859eac37a3c', 'De Vlaamse Ronde',           31, '2026-09-05 13:00:00+00'),
  (1, '745268dc-4b98-4882-a794-4dd8fe3a94c4', 'L Enfer du Nord',            35, '2026-09-07 16:00:00+00'),
  (1, '62f8cd5c-669a-4e4f-886f-fc68faddf807', 'La Doyenne des Ardennes',    42, '2026-09-10 14:00:00+00'),
  -- Fase 2: fyld-løbene ind i de tomme hviledags-slots.
  (2, 'ec921aa3-8845-4b54-956c-39c6a6508bcf', 'Le Mur de Huy',              14, '2026-08-31 11:00:00+00'),
  (2, '67b3e0ad-fb76-44e0-b6e5-a977c40a27d3', 'La Classique Bretonne',      26, '2026-09-03 17:00:00+00'),
  (2, '8baf420c-f159-496f-b458-2607b8990890', 'Taunus-Klassiker',           57, '2026-09-14 17:00:00+00'),
  (2, 'c4106f78-c8d9-4dfb-ac2a-8dc01086ba16', 'Grand Prix du Saint-Laurent', 72, '2026-09-19 09:00:00+00');

-- Forudsætninger: alle otte findes, er S3/D1-endagsløb, ikke kørt, præcis én etape.
do $$
declare v_afvig integer;
begin
  select count(*) into v_afvig
    from flyt_4203 f
    left join public.races r on r.id = f.race_id
   where r.id is null
      or r.season_id <> '00000000-0000-0000-0000-000000000003'
      or r.league_division_id <> 1
      or r.race_type <> 'single'
      or r.status = 'completed'
      or (select count(*) from public.race_stage_schedule s where s.race_id = f.race_id) <> 1;
  if v_afvig > 0 then
    raise exception '#4203: % af de otte loeb matcher ikke forudsaetningen (S3, D1, endagsloeb, ikke koert, praecis een etape). Intet aendret.', v_afvig
      using errcode = 'check_violation';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. Backups
create table if not exists public.backup_4203_removed_entries (
  fase           integer,
  race_id        uuid,
  rider_id       uuid,
  team_id        uuid,
  race_role      text,
  is_auto_filled boolean,
  maal_gd        integer,
  konflikt_med   uuid,
  fjernet_at     timestamptz not null default now()
);

create table if not exists public.backup_4203_old_schedule as
  select s.race_id, s.stage_number, s.game_day, s.scheduled_at, now() as gemt_at
    from public.race_stage_schedule s
   where s.race_id in (select race_id from flyt_4203);

-- ---------------------------------------------------------------- 2. Flytningen
-- Kører fase 1 og derefter fase 2. For hver fase: ryd de udtagelser hvor rytteren
-- allerede er bundet i målslottet af et ANDET løb (ellers afviser
-- no_rider_double_booking_day trigger-genopbygningen), og flyt så løbene.
do $$
declare
  v_fase integer;
begin
  foreach v_fase in array array[1, 2] loop

    insert into public.backup_4203_removed_entries
      (fase, race_id, rider_id, team_id, race_role, is_auto_filled, maal_gd, konflikt_med)
    select v_fase, e.race_id, e.rider_id, e.team_id, e.race_role, e.is_auto_filled, f.maal_gd,
           (select d.race_id
              from public.race_entry_days d
             where d.rider_id = e.rider_id
               and d.game_day = f.maal_gd
               and d.season_id = '00000000-0000-0000-0000-000000000003'
               and d.race_id <> e.race_id
             limit 1)
      from public.race_entries e
      join flyt_4203 f on f.race_id = e.race_id and f.fase = v_fase
     where exists (
       select 1 from public.race_entry_days d
        where d.rider_id = e.rider_id
          and d.game_day = f.maal_gd
          and d.season_id = '00000000-0000-0000-0000-000000000003'
          and d.race_id <> e.race_id
     );

    delete from public.race_entries e
     using flyt_4203 f
     where f.fase = v_fase
       and e.race_id = f.race_id
       and exists (
         select 1 from public.race_entry_days d
          where d.rider_id = e.rider_id
            and d.game_day = f.maal_gd
            and d.season_id = '00000000-0000-0000-0000-000000000003'
            and d.race_id <> e.race_id
       );

    -- Trigger 2 (race_stage_schedule_resync_binding, #4173) genberegner binding_span og
    -- genopbygger race_entry_days for alle hold i løbet.
    update public.race_stage_schedule s
       set game_day     = f.maal_gd,
           scheduled_at = f.maal_tid
      from flyt_4203 f
     where f.fase = v_fase
       and s.race_id = f.race_id
       and (s.game_day is distinct from f.maal_gd or s.scheduled_at is distinct from f.maal_tid);

    update public.races r
       set game_day_start = f.maal_gd
      from flyt_4203 f
     where f.fase = v_fase
       and r.id = f.race_id
       and r.game_day_start is distinct from f.maal_gd;

  end loop;
end $$;

-- ---------------------------------------------------------------- 3. Post-verify
do $$
declare
  v_forkert    integer;
  v_i_gt       integer;
  v_tomt_slot  integer;
  v_dubletter  integer;
  v_tomme      integer;
begin
  -- 3a. Alle otte løb ligger præcis hvor de skal.
  select count(*) into v_forkert
    from flyt_4203 f
    join public.race_stage_schedule s on s.race_id = f.race_id
   where s.game_day <> f.maal_gd or s.scheduled_at <> f.maal_tid;
  if v_forkert > 0 then
    raise exception '#4203 verify 3a: % etape-raekker landede ikke paa maalslottet.', v_forkert
      using errcode = 'check_violation';
  end if;

  -- 3b. INTET Monument ligger inde i et GT-vindue i samme division (ejer-kravet).
  select count(*) into v_i_gt
    from public.races m
    join public.race_stage_schedule ms on ms.race_id = m.id
   where m.season_id = '00000000-0000-0000-0000-000000000003'
     and m.race_class = 'Monuments'
     and exists (
       select 1
         from public.races g
         join public.race_stage_schedule gs on gs.race_id = g.id
        where g.season_id = m.season_id
          and g.league_division_id = m.league_division_id
          and g.race_class in ('TourFrance', 'GiroVuelta')
        group by g.id
       having ms.game_day between min(gs.game_day) and max(gs.game_day)
     );
  if v_i_gt > 0 then
    raise exception '#4203 verify 3b: % Monument-etape(r) ligger stadig inde i et GT-vindue.', v_i_gt
      using errcode = 'check_violation';
  end if;

  -- 3c. Ingen GT-hviledag efterlader et tomt slot (#3470).
  select count(*) into v_tomt_slot
    from (
      select g.league_division_id as div, gs.d as hul_dag
        from public.races g
        join lateral (
          select generate_series(min(s.game_day), max(s.game_day)) as d
            from public.race_stage_schedule s where s.race_id = g.id
        ) gs on true
       where g.season_id = '00000000-0000-0000-0000-000000000003'
         and g.race_class in ('TourFrance', 'GiroVuelta')
         and not exists (
           select 1 from public.race_stage_schedule s2
            where s2.race_id = g.id and s2.game_day = gs.d
         )
    ) hul
   where not exists (
     select 1
       from public.race_stage_schedule s3
       join public.races r3 on r3.id = s3.race_id
      where r3.season_id = '00000000-0000-0000-0000-000000000003'
        and r3.league_division_id = hul.div
        and s3.game_day = hul.hul_dag
   );
  if v_tomt_slot > 0 then
    raise exception '#4203 verify 3c: % GT-hviledags-slot staar tomt — #3470 brudt.', v_tomt_slot
      using errcode = 'check_violation';
  end if;

  -- 3d. Rytter-dags-invarianten holder (#4173).
  select count(*) into v_dubletter from (
    select rider_id, season_id, game_day
      from public.race_entry_days
     group by 1, 2, 3
    having count(distinct race_id) > 1
  ) k;
  if v_dubletter > 0 then
    raise exception '#4203 verify 3d: % (rytter, saeson, loebsdag)-noegler har 2+ loeb.', v_dubletter
      using errcode = 'check_violation';
  end if;

  -- 3e. Ingen af de otte løb står tilbage med et tomt felt.
  select count(*) into v_tomme
    from flyt_4203 f
   where (select count(*) from public.race_entries e where e.race_id = f.race_id) = 0;
  if v_tomme > 0 then
    raise exception '#4203 verify 3e: % af loebene har nul udtagelser efter byttet.', v_tomme
      using errcode = 'check_violation';
  end if;

  raise notice '#4203: otte loeb byttet. Monumenter ude af GT-vinduerne, ingen tomme hviledags-slots, invarianten holder.';
end $$;

commit;

-- #4217 — en rytter er bundet fra første til sidste etape af sit løb.
--
-- EJER-DIREKTIV 25/8:
--   "På en IRL dag, må en rytter gerne køre mere end et løb.
--    På en løbsdag må en rytter ikke køre mere end et løb."
--   "de skal altså ikke kunne deltage i noget andet undervejs" (#4209)
--
-- ROD-ÅRSAG. #4173 gjorde 24/8 bindingen til MÆNGDEN af de løbsdage et løb faktisk
-- kører, i stedet for spændet. Formålet var rigtigt (et løb med pause må ikke låse
-- ryttere på dage de ikke kører), men konsekvensen er at en rytter kan forlade et
-- etapeløb midt i og køre et andet løb i springet.
--
-- MÅLT I PROD 25/8 (S3, 0 løbsdage kørt, read-only):
--   · 5.074 udtagelses-par på 1.694 ryttere overlapper i spænd
--   · 8.934 af 55.401 entries (16,1 %) er i konflikt — heraf 8.782 assistentens
--     (is_auto_filled = true) og kun 152 spillernes egne
--   · Julien Faure: Giro della Penisola løbsdag 10-29 OG Milano-Riviera løbsdag 14
--     (monument kl. 13:00, Giro-etape kl. 14:00 — samme eftermiddag)
--
-- SPRINGENE ER IKKE HVILEDAGE. En løbsdag er et halvdags-slot, og slot-tælleren løber
-- videre for de øvrige løb i puljen imens. La Corsa dei Due Mari kører 7 etaper på
-- løbsdag 10, 13, 17, 20, 23, 27, 28 — over 6 kalenderdage. Springene kan derfor ikke
-- lukkes i kalenderen (løbet ville køre 7 etaper på to dage); de skal bindes.
-- Kun 9 af 199 flerdagsløb har et ÆGTE kalenderdags-hul, og de 9 er GT-hviledagene.
-- Spænd-binding løser derfor #4209 uden at hviledagene skal fjernes fra spillet.
--
-- HVAD DER ÆNDRES.
--   · race_entry_days_rebuild() indsætter én række pr. løbsdag i HELE spændet
--     min(game_day)..max(game_day), ikke kun de dage der køres. Bygget oven på
--     #4191's diff-krop (want/gone/insert) — samme fire porte, samme diff-kontrakt,
--     så den ikke churner rækker ved uændret udtagelse.
--   · Constrainten no_rider_double_booking_day (UNIQUE rider_id, season_id, game_day)
--     er UÆNDRET. Det er kun ønske-mængden der vokser.
--
-- KONFLIKT-RYDNING. Den nye mængde kan ikke skrives så længe der findes overlappende
-- udtagelser, så scriptet rydder dem først, efter en fast prioritet:
--     1. spillerens egne valg (is_auto_filled = false) slår assistentens
--     2. flest etaper vinder (GT > etapeløb > endagsløb)
--     3. tidligste løbsdag vinder
--     4. race_id som tie-break, så kørslen er deterministisk
-- Der genudfyldes IKKE. Ejer-direktiv 25/8: "ikke gå ind og spille spillet på vegne
-- af spillerne". Pladserne står tomme til spilleren selv udtager.
--
-- IDEMPOTENT. Funktionen er CREATE OR REPLACE; rydningen er et delete af rækker der
-- pr. definition ikke må findes; genopbygningen er #4191's diff. Kører scriptet to
-- gange, sletter anden kørsel nul rækker.
--
-- DRY-RUN. Sæt v_apply := false for kun at tælle. Scriptet ruller da tilbage og
-- rapporterer hvad det VILLE gøre.
--
-- Refs #4217 #4173 #4209 #4200 #4201 #4191 #4190 #3420 #1823

begin;

-- ── 1. Ønske-mængden bliver spændet ──────────────────────────────────────────────
create or replace function public.race_entry_days_rebuild(p_race_id uuid, p_team_id uuid)
returns void
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_binding boolean;
begin
  -- Samme fire porte som #4173/#4191: færdigkørt løb, afmeldt hold, delvist backfillet
  -- schedule, Monument-sentinel. "Ikke bindende" = tom ønske-mængde, ikke tidligt return.
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
    -- #4217: HELE spændet, ikke kun de kørte dage. generate_series lukker springene.
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

comment on function public.race_entry_days_rebuild(uuid, uuid) is
  '#4217: skriver én række pr. løbsdag i HELE løbets spænd (min..max game_day), så en
  rytter er bundet fra første til sidste etape og ikke kan udtages til et andet løb i
  et spring. #4191-diffen bevaret: uændret udtagelse skriver nul rækker.';

commit;

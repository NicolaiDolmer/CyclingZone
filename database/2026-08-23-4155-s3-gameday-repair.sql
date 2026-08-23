-- #4155 — S3 game_day-reparation (D1-D3) + komprimering af 4 udstrakte D1-etapeløb
--
-- Rod-årsag (målt 23/8 ~23:00, prod): kalender-generatoren skrev race_stage_schedule.game_day
-- som et internt slot-indeks (op til 85) i stedet for sæsonens løbsdag (0-26) for tier 1-3.
-- D4 er korrekt (max 26, 0 mismatches). Konsekvens: binding_span (#3420) og dermed
-- no_rider_double_booking håndhævede "1 rytter = 1 løb/dag" mod den FORKERTE akse →
-- 1.855 ryttere reelt dobbeltbooket på samme IRL-dag (D1 414, D2 608, D3 833) fra 25/8.
-- Kalender-visningens "Race day N" (raceGameDaySpan) viste samme skæve tal.
--
-- Reparationen (én transaktion, psql, statement_timeout hævet lokalt):
--   0. Backup-tabeller (backup_4155_*) af schedule-rækker + entries der fjernes.
--   1. Komprimér 4 D1-løb (Volta Catalana / Tour du Léman / La Corsa dei Due Mari /
--      Tour des Émirats) — ejer-valgt retning 23/8; kun scheduled_at flyttes, stage 1
--      beholder sin dato, ingen etape efter sæsonslut 20/9.
--   2. final game_day := (scheduled_at @ Europe/Copenhagen)::date - 2026-08-25 for ALLE
--      S3 tier 1-3-etaper (samme definition som D4 opfylder i forvejen).
--   3. Grådig konflikt-opløsning pr. rytter over FINALE datoer: behold entry med prioritet
--      (flest etaper > tidligste start > tidligste created_at); drop entries hvis datoer
--      kolliderer med allerede-beholdte. Withdrawn/completed løb er ikke-bindende og indgår ikke.
--   4. Constraint droppes før skrivning og genskabes til sidst (validerer ALT ved re-add;
--      transiente blandede spans under opdatering kan ellers give falske 23P01).
--      Resync-triggeren deaktiveres under skrivningen; binding_span genberegnes i én
--      samlet backfill bagefter (samme funktion som triggerne bruger).
--
-- Idempotent: genkørsel efter succes er no-op (updates rammer samme værdier, konflikt-
-- sættet er tomt, backups er IF NOT EXISTS). Køres FØRST på staging (generalprøve),
-- derefter prod på ejer-GO. Refs #4155 #3420 #4123.

\set ON_ERROR_STOP on

begin;

set local statement_timeout = '15min';

-- Staging-branchen restores uden btree_gist (LEAN-dumpets ene ignorerede fejl er netop
-- EXCLUDE-constrainten); prod har den allerede — idempotent begge steder.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------- 0. Backups
create table if not exists public.backup_4155_stage_schedule as
  select s.* from public.race_stage_schedule s
  join public.races r on r.id = s.race_id
  join public.league_divisions ld on ld.id = r.league_division_id
  where r.season_id = '00000000-0000-0000-0000-000000000003' and ld.tier in (1,2,3);

create table if not exists public.backup_4155_entries_removed (
  race_id uuid, rider_id uuid, team_id uuid, is_auto_filled boolean,
  created_at timestamptz, race_role text, binding_span int4range,
  removed_at timestamptz default now(), removal_reason text
);

-- ------------------------------------------- 1. final_plan (temp, hele t1-3)
create temp table if not exists final_plan on commit drop as
select s.race_id, s.stage_number,
       coalesce(c.new_at, s.scheduled_at) as new_at
from public.race_stage_schedule s
join public.races r on r.id = s.race_id
join public.league_divisions ld on ld.id = r.league_division_id
left join (values
  ('7ff4aa7a-fcab-494d-a925-a8a4795b13d5'::uuid, 1, timestamptz '2026-08-25 09:00:00+00'),
  ('7ff4aa7a-fcab-494d-a925-a8a4795b13d5'::uuid, 2, timestamptz '2026-08-25 15:00:00+00'),
  ('dc73c0fd-2d90-4374-8552-9ad1a28c0a05'::uuid, 1, timestamptz '2026-08-25 17:00:00+00'),
  ('3d31c336-4f3c-46fc-a50e-99ca3eaedac3'::uuid, 1, timestamptz '2026-08-26 09:00:00+00'),
  ('7ff4aa7a-fcab-494d-a925-a8a4795b13d5'::uuid, 3, timestamptz '2026-08-26 11:00:00+00'),
  ('dc73c0fd-2d90-4374-8552-9ad1a28c0a05'::uuid, 2, timestamptz '2026-08-26 13:00:00+00'),
  ('dc73c0fd-2d90-4374-8552-9ad1a28c0a05'::uuid, 3, timestamptz '2026-08-26 14:00:00+00'),
  ('7ff4aa7a-fcab-494d-a925-a8a4795b13d5'::uuid, 4, timestamptz '2026-08-26 17:00:00+00'),
  ('dc73c0fd-2d90-4374-8552-9ad1a28c0a05'::uuid, 4, timestamptz '2026-08-27 09:00:00+00'),
  ('dc73c0fd-2d90-4374-8552-9ad1a28c0a05'::uuid, 5, timestamptz '2026-08-27 11:00:00+00'),
  ('7ff4aa7a-fcab-494d-a925-a8a4795b13d5'::uuid, 5, timestamptz '2026-08-27 13:00:00+00'),
  ('7ff4aa7a-fcab-494d-a925-a8a4795b13d5'::uuid, 6, timestamptz '2026-08-27 15:00:00+00'),
  ('3d31c336-4f3c-46fc-a50e-99ca3eaedac3'::uuid, 2, timestamptz '2026-08-27 17:00:00+00'),
  ('dc73c0fd-2d90-4374-8552-9ad1a28c0a05'::uuid, 6, timestamptz '2026-08-28 09:00:00+00'),
  ('7ff4aa7a-fcab-494d-a925-a8a4795b13d5'::uuid, 7, timestamptz '2026-08-28 11:00:00+00'),
  ('7ff4aa7a-fcab-494d-a925-a8a4795b13d5'::uuid, 8, timestamptz '2026-08-28 13:00:00+00'),
  ('3d31c336-4f3c-46fc-a50e-99ca3eaedac3'::uuid, 3, timestamptz '2026-08-28 15:00:00+00'),
  ('3d31c336-4f3c-46fc-a50e-99ca3eaedac3'::uuid, 4, timestamptz '2026-08-28 17:00:00+00'),
  ('dc73c0fd-2d90-4374-8552-9ad1a28c0a05'::uuid, 7, timestamptz '2026-08-29 09:00:00+00'),
  ('026ef77a-dc07-4e43-b683-5a584b1ea1a4'::uuid, 1, timestamptz '2026-08-29 11:00:00+00'),
  ('026ef77a-dc07-4e43-b683-5a584b1ea1a4'::uuid, 2, timestamptz '2026-08-29 13:00:00+00'),
  ('3d31c336-4f3c-46fc-a50e-99ca3eaedac3'::uuid, 5, timestamptz '2026-08-29 15:00:00+00'),
  ('3d31c336-4f3c-46fc-a50e-99ca3eaedac3'::uuid, 6, timestamptz '2026-08-29 17:00:00+00'),
  ('c27b61c2-4704-4eec-98e7-08cb7ad18f19'::uuid, 1, timestamptz '2026-08-30 09:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 1, timestamptz '2026-08-30 11:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 2, timestamptz '2026-08-30 13:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 3, timestamptz '2026-08-30 15:00:00+00'),
  ('026ef77a-dc07-4e43-b683-5a584b1ea1a4'::uuid, 3, timestamptz '2026-08-30 17:00:00+00'),
  ('c27b61c2-4704-4eec-98e7-08cb7ad18f19'::uuid, 2, timestamptz '2026-08-31 09:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 4, timestamptz '2026-08-31 12:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 5, timestamptz '2026-08-31 14:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 6, timestamptz '2026-08-31 15:00:00+00'),
  ('026ef77a-dc07-4e43-b683-5a584b1ea1a4'::uuid, 4, timestamptz '2026-08-31 17:00:00+00'),
  ('c27b61c2-4704-4eec-98e7-08cb7ad18f19'::uuid, 3, timestamptz '2026-09-01 09:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 7, timestamptz '2026-09-01 11:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 8, timestamptz '2026-09-01 13:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 9, timestamptz '2026-09-01 15:00:00+00'),
  ('026ef77a-dc07-4e43-b683-5a584b1ea1a4'::uuid, 5, timestamptz '2026-09-01 17:00:00+00'),
  ('c27b61c2-4704-4eec-98e7-08cb7ad18f19'::uuid, 4, timestamptz '2026-09-02 09:00:00+00'),
  ('13441a7b-1538-449d-b6bf-b1223a94c2eb'::uuid, 1, timestamptz '2026-09-02 11:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 10, timestamptz '2026-09-02 12:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 11, timestamptz '2026-09-02 14:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 12, timestamptz '2026-09-02 15:00:00+00'),
  ('026ef77a-dc07-4e43-b683-5a584b1ea1a4'::uuid, 6, timestamptz '2026-09-02 17:00:00+00'),
  ('c27b61c2-4704-4eec-98e7-08cb7ad18f19'::uuid, 5, timestamptz '2026-09-03 09:00:00+00'),
  ('13441a7b-1538-449d-b6bf-b1223a94c2eb'::uuid, 2, timestamptz '2026-09-03 11:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 13, timestamptz '2026-09-03 13:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 14, timestamptz '2026-09-03 14:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 15, timestamptz '2026-09-03 16:00:00+00'),
  ('c27b61c2-4704-4eec-98e7-08cb7ad18f19'::uuid, 6, timestamptz '2026-09-04 09:00:00+00'),
  ('c27b61c2-4704-4eec-98e7-08cb7ad18f19'::uuid, 7, timestamptz '2026-09-04 11:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 16, timestamptz '2026-09-04 13:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 17, timestamptz '2026-09-04 15:00:00+00'),
  ('0009a768-0c2c-400a-acb3-caa566faab94'::uuid, 18, timestamptz '2026-09-04 17:00:00+00'),
  ('13441a7b-1538-449d-b6bf-b1223a94c2eb'::uuid, 3, timestamptz '2026-09-05 09:00:00+00'),
  ('13441a7b-1538-449d-b6bf-b1223a94c2eb'::uuid, 4, timestamptz '2026-09-05 11:00:00+00'),
  ('4e53a884-49af-40c1-9914-ab5c8bb31b85'::uuid, 1, timestamptz '2026-09-05 13:00:00+00'),
  ('4e53a884-49af-40c1-9914-ab5c8bb31b85'::uuid, 2, timestamptz '2026-09-05 15:00:00+00'),
  ('e5ab10bc-980b-47ed-a1be-f099d93788c9'::uuid, 1, timestamptz '2026-09-05 17:00:00+00'),
  ('13441a7b-1538-449d-b6bf-b1223a94c2eb'::uuid, 5, timestamptz '2026-09-06 09:00:00+00'),
  ('13441a7b-1538-449d-b6bf-b1223a94c2eb'::uuid, 6, timestamptz '2026-09-06 11:00:00+00'),
  ('4e53a884-49af-40c1-9914-ab5c8bb31b85'::uuid, 3, timestamptz '2026-09-06 13:00:00+00'),
  ('4e53a884-49af-40c1-9914-ab5c8bb31b85'::uuid, 4, timestamptz '2026-09-06 15:00:00+00'),
  ('e5ab10bc-980b-47ed-a1be-f099d93788c9'::uuid, 2, timestamptz '2026-09-06 17:00:00+00'),
  ('13441a7b-1538-449d-b6bf-b1223a94c2eb'::uuid, 7, timestamptz '2026-09-07 09:00:00+00'),
  ('4e53a884-49af-40c1-9914-ab5c8bb31b85'::uuid, 5, timestamptz '2026-09-07 11:00:00+00'),
  ('e5ab10bc-980b-47ed-a1be-f099d93788c9'::uuid, 3, timestamptz '2026-09-07 15:00:00+00'),
  ('e5ab10bc-980b-47ed-a1be-f099d93788c9'::uuid, 4, timestamptz '2026-09-07 17:00:00+00'),
  ('a1c8d3a3-ee8a-42b1-954d-68d7ead01f8e'::uuid, 1, timestamptz '2026-09-08 09:00:00+00'),
  ('a1c8d3a3-ee8a-42b1-954d-68d7ead01f8e'::uuid, 2, timestamptz '2026-09-08 11:00:00+00'),
  ('4e53a884-49af-40c1-9914-ab5c8bb31b85'::uuid, 6, timestamptz '2026-09-08 13:00:00+00'),
  ('4e53a884-49af-40c1-9914-ab5c8bb31b85'::uuid, 7, timestamptz '2026-09-08 15:00:00+00'),
  ('e5ab10bc-980b-47ed-a1be-f099d93788c9'::uuid, 5, timestamptz '2026-09-08 17:00:00+00'),
  ('a1c8d3a3-ee8a-42b1-954d-68d7ead01f8e'::uuid, 3, timestamptz '2026-09-09 10:00:00+00'),
  ('a1c8d3a3-ee8a-42b1-954d-68d7ead01f8e'::uuid, 4, timestamptz '2026-09-09 12:00:00+00'),
  ('e5ab10bc-980b-47ed-a1be-f099d93788c9'::uuid, 6, timestamptz '2026-09-09 15:00:00+00'),
  ('e5ab10bc-980b-47ed-a1be-f099d93788c9'::uuid, 7, timestamptz '2026-09-09 17:00:00+00'),
  ('a1c8d3a3-ee8a-42b1-954d-68d7ead01f8e'::uuid, 5, timestamptz '2026-09-10 09:00:00+00'),
  ('a1c8d3a3-ee8a-42b1-954d-68d7ead01f8e'::uuid, 6, timestamptz '2026-09-10 12:00:00+00'),
  ('e5ab10bc-980b-47ed-a1be-f099d93788c9'::uuid, 8, timestamptz '2026-09-10 16:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 1, timestamptz '2026-09-11 10:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 2, timestamptz '2026-09-11 14:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 3, timestamptz '2026-09-11 17:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 4, timestamptz '2026-09-12 09:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 5, timestamptz '2026-09-12 13:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 6, timestamptz '2026-09-12 17:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 7, timestamptz '2026-09-13 09:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 8, timestamptz '2026-09-13 11:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 9, timestamptz '2026-09-13 14:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 10, timestamptz '2026-09-13 16:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 11, timestamptz '2026-09-14 09:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 12, timestamptz '2026-09-14 11:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 13, timestamptz '2026-09-14 14:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 14, timestamptz '2026-09-14 16:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 15, timestamptz '2026-09-15 09:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 16, timestamptz '2026-09-15 12:00:00+00'),
  ('fa491e60-a93d-448c-b9d5-833b9e782512'::uuid, 17, timestamptz '2026-09-15 16:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 1, timestamptz '2026-09-16 09:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 2, timestamptz '2026-09-16 11:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 3, timestamptz '2026-09-16 13:00:00+00'),
  ('1878513c-31a1-4d57-84c4-2f0d593e296f'::uuid, 1, timestamptz '2026-09-16 15:00:00+00'),
  ('1878513c-31a1-4d57-84c4-2f0d593e296f'::uuid, 2, timestamptz '2026-09-16 17:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 4, timestamptz '2026-09-17 09:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 5, timestamptz '2026-09-17 11:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 6, timestamptz '2026-09-17 13:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 7, timestamptz '2026-09-17 15:00:00+00'),
  ('1878513c-31a1-4d57-84c4-2f0d593e296f'::uuid, 3, timestamptz '2026-09-17 17:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 8, timestamptz '2026-09-18 09:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 9, timestamptz '2026-09-18 11:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 10, timestamptz '2026-09-18 13:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 11, timestamptz '2026-09-18 14:00:00+00'),
  ('1878513c-31a1-4d57-84c4-2f0d593e296f'::uuid, 4, timestamptz '2026-09-18 16:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 12, timestamptz '2026-09-19 10:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 13, timestamptz '2026-09-19 12:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 14, timestamptz '2026-09-19 15:00:00+00'),
  ('1878513c-31a1-4d57-84c4-2f0d593e296f'::uuid, 5, timestamptz '2026-09-19 17:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 15, timestamptz '2026-09-20 09:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 16, timestamptz '2026-09-20 11:00:00+00'),
  ('bdf53728-6125-4882-b6a7-c8a342e802f2'::uuid, 17, timestamptz '2026-09-20 14:00:00+00'),
  ('1878513c-31a1-4d57-84c4-2f0d593e296f'::uuid, 6, timestamptz '2026-09-20 16:00:00+00'),
  ('67714138-ee4d-41de-80cf-91c90426a7fb'::uuid, 1, timestamptz '2026-09-12 11:00:00+00'),
  ('6700d3ae-bf12-4d76-892f-5d01b18017ea'::uuid, 1, timestamptz '2026-09-12 15:00:00+00'),
  ('350f56c2-d5f5-4143-8d69-1477147ed2bc'::uuid, 1, timestamptz '2026-09-15 15:00:00+00')
) as c(c_race, c_stage, new_at) on c.c_race = s.race_id and c.c_stage = s.stage_number
where r.season_id = '00000000-0000-0000-0000-000000000003' and ld.tier in (1,2,3);

alter table final_plan add column if not exists new_gd integer;
update final_plan
   set new_gd = ((new_at at time zone 'Europe/Copenhagen')::date - date '2026-08-25');

-- Sanity: ingen etape uden for sæsonen, ingen negativ dag, etaper monotone pr. løb.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from final_plan where new_gd < 0 or new_gd > 26;
  if v_bad > 0 then raise exception 'final_plan: % etaper uden for sæsonens dage 0-26', v_bad; end if;

  select count(*) into v_bad
    from final_plan a join final_plan b
      on a.race_id = b.race_id and a.stage_number < b.stage_number and a.new_at >= b.new_at;
  if v_bad > 0 then raise exception 'final_plan: % etape-par ude af kronologisk orden', v_bad; end if;
end $$;

-- ------------------- 2. Entry-strategi (v2 efter generalprøve 1+2, 23/8)
-- Generalprøve 1 viste at dato-baseret opløsning efterlod span-overlaps; generalprøve 2
-- (ren span-grådighed) tømte hele felter (flere D2/D3-løb med 0 deltagere). Rigtig
-- strategi = #1823-mønsteret: AUTO-entries slettes helt i scope og genopbygges af den
-- binding-bevidste generator (runRaceEntryGenerator via scripts/generateSeasonEntries.js
-- --execute) OVEN PÅ den reparerede akse — den fordeler holdets ryttere over puljens løb
-- kronologisk og efterlader ikke tomme felter. Manuelle entries (is_auto_filled=false)
-- bevares; kun manuel-mod-manuel span-overlaps opløses grådigt (få; generatoren rører
-- dem aldrig, og constrainten kan ikke genskabes med dem stående).
create temp table if not exists race_spans on commit drop as
select race_id, min(new_gd) as gd_lo, max(new_gd) as gd_hi,
       min(new_at) as race_start, count(*) as n_stages
from final_plan group by race_id;

-- 2a. Backup + slet ALLE auto-entries i scope (ikke-startede løb).
insert into public.backup_4155_entries_removed
  (race_id, rider_id, team_id, is_auto_filled, created_at, race_role, binding_span, removal_reason)
select e.race_id, e.rider_id, e.team_id, e.is_auto_filled, e.created_at, e.race_role, e.binding_span,
       '#4155: auto-entry slettet foer akse-reparation; genopbygges af entry-generatoren'
from public.race_entries e
join race_spans rs on rs.race_id = e.race_id
join public.races r on r.id = e.race_id
where e.is_auto_filled = true and r.status = 'scheduled';

delete from public.race_entries e
using race_spans rs, public.races r
where rs.race_id = e.race_id and r.id = e.race_id
  and e.is_auto_filled = true and r.status = 'scheduled';

-- 2b. Manuel-mod-manuel konflikter: grådig pr. rytter over FINALE spans.
create temp table if not exists entry_ranges on commit drop as
select e.race_id, e.rider_id, e.team_id, e.created_at as entry_created,
       rs.n_stages, rs.race_start, int4range(rs.gd_lo, rs.gd_hi, '[]') as span
from public.race_entries e
join public.races r on r.id = e.race_id
join race_spans rs on rs.race_id = e.race_id
where r.status <> 'completed'
  and not exists (select 1 from public.race_withdrawals w
                   where w.race_id = e.race_id and w.team_id = e.team_id);

create temp table if not exists conflicted_riders on commit drop as
select distinct a.rider_id
from entry_ranges a join entry_ranges b
  on a.rider_id = b.rider_id and a.race_id <> b.race_id and a.span && b.span;

create temp table if not exists drop_entries (race_id uuid, rider_id uuid, team_id uuid) on commit drop;

do $$
declare
  rec record;
begin
  create temp table kept_spans (rider_id uuid, span int4range) on commit drop;
  for rec in
    select er.rider_id, er.race_id, er.team_id, er.span,
           er.n_stages, er.race_start, er.entry_created
      from entry_ranges er
      join conflicted_riders cr on cr.rider_id = er.rider_id
     order by er.rider_id, er.n_stages desc, er.race_start asc, er.entry_created asc, er.race_id
  loop
    if exists (select 1 from kept_spans k where k.rider_id = rec.rider_id and k.span && rec.span) then
      insert into drop_entries values (rec.race_id, rec.rider_id, rec.team_id);
    else
      insert into kept_spans values (rec.rider_id, rec.span);
    end if;
  end loop;
end $$;

insert into public.backup_4155_entries_removed
  (race_id, rider_id, team_id, is_auto_filled, created_at, race_role, binding_span, removal_reason)
select e.race_id, e.rider_id, e.team_id, e.is_auto_filled, e.created_at, e.race_role, e.binding_span,
       '#4155: manuel entry, span-kollision (1 rytter = 1 løb/dag), tabende entry'
from public.race_entries e
join drop_entries d on d.race_id = e.race_id and d.rider_id = e.rider_id;

delete from public.race_entries e
using drop_entries d
where d.race_id = e.race_id and d.rider_id = e.rider_id;

-- ------------------- 3. Skriv schedule (constraint + trigger midlertidigt af)
alter table public.race_entries drop constraint if exists no_rider_double_booking;
alter table public.race_stage_schedule disable trigger trg_race_stage_schedule_resync_binding;

update public.race_stage_schedule s
   set scheduled_at = fp.new_at,
       game_day     = fp.new_gd
from final_plan fp
where fp.race_id = s.race_id and fp.stage_number = s.stage_number
  and (s.scheduled_at is distinct from fp.new_at or s.game_day is distinct from fp.new_gd);

alter table public.race_stage_schedule enable trigger trg_race_stage_schedule_resync_binding;

-- Synk races.game_day_start (kalender-visningens startdag) med den reparerede plan.
update public.races r
   set game_day_start = fp.min_gd
from (select race_id, min(new_gd) as min_gd from final_plan group by race_id) fp
where fp.race_id = r.id and r.game_day_start is distinct from fp.min_gd;

-- Samlet binding-backfill for alle berørte løbs entries (samme funktion som triggerne).
update public.race_entries e
   set binding_span = public.race_entries_binding_span(e.race_id, e.team_id)
where e.race_id in (select distinct race_id from final_plan);

-- Genskab constrainten — validerer ALLE rækker; fejler transaktionen hvis noget overlapper.
alter table public.race_entries
  add constraint no_rider_double_booking
  exclude using gist (rider_id with =, binding_span with &&)
  where (binding_span is not null);

commit;

-- ---------------------------------------------------------------- Post-verify
\echo '--- verify 1: game_day-mismatch pr. tier (forventet 0 overalt, max_gd 26)'
select ld.tier, max(s.game_day) as max_gd, count(*) as stages,
       sum(case when s.game_day <> ((s.scheduled_at at time zone 'Europe/Copenhagen')::date - date '2026-08-25') then 1 else 0 end) as gd_mismatch
from public.race_stage_schedule s
join public.races r on r.id = s.race_id
join public.league_divisions ld on ld.id = r.league_division_id
where r.season_id = '00000000-0000-0000-0000-000000000003'
group by ld.tier order by ld.tier;

\echo '--- verify 2: binding_span-overlaps (forventet: ingen rækker)'
select count(*) as overlapping_pairs
from public.race_entries a
join public.race_entries b
  on a.rider_id = b.rider_id and a.race_id::text < b.race_id::text
 and a.binding_span && b.binding_span
where a.binding_span is not null and b.binding_span is not null
having count(*) > 0;

\echo '--- verify 2b: felt-størrelse pr. tier før/efter (rapport til ejer-GO)'
select ld.tier,
       count(*) as entries_now,
       (select count(*) from public.backup_4155_entries_removed bb
         join public.races rr on rr.id = bb.race_id
         join public.league_divisions ldd on ldd.id = rr.league_division_id
        where ldd.tier = ld.tier) as entries_removed
from public.race_entries e
join public.races r on r.id = e.race_id
join public.league_divisions ld on ld.id = r.league_division_id
where r.season_id = '00000000-0000-0000-0000-000000000003'
group by ld.tier order by ld.tier;

\echo '--- verify 3: de 4 komprimerede løb (forventet spans: Catalana 5, Léman 5, Corsa 6, Émirats 6 IRL-dage)'
select r.name, r.stages, min(s.scheduled_at) as first_at, max(s.scheduled_at) as last_at,
       (max(s.scheduled_at)::date - min(s.scheduled_at)::date + 1) as irl_days
from public.races r join public.race_stage_schedule s on s.race_id = r.id
where r.id in ('dc73c0fd-2d90-4374-8552-9ad1a28c0a05','026ef77a-dc07-4e43-b683-5a584b1ea1a4',
               'c27b61c2-4704-4eec-98e7-08cb7ad18f19','13441a7b-1538-449d-b6bf-b1223a94c2eb')
group by r.name, r.stages order by min(s.scheduled_at);

\echo '--- verify 4: constraint på plads (forventet 1 række)'
select conname from pg_constraint
where conname = 'no_rider_double_booking' and conrelid = 'public.race_entries'::regclass;

\echo '--- verify 6: hårdest ramte løb (mindste tilbageværende felter, rapport)'
select ld.tier, r.name, r.stages,
       count(e.rider_id) as entries_left,
       coalesce(rm.n, 0) as removed
from public.races r
join public.league_divisions ld on ld.id = r.league_division_id
left join public.race_entries e on e.race_id = r.id
left join (select race_id, count(*) as n from public.backup_4155_entries_removed group by race_id) rm on rm.race_id = r.id
where r.season_id = '00000000-0000-0000-0000-000000000003' and ld.tier in (1,2,3)
group by ld.tier, r.name, r.stages, rm.n
order by count(e.rider_id) asc
limit 15;

\echo '--- verify 5: fjernede entries pr. tier/auto (rapport)'
select ld.tier, b.is_auto_filled, count(*) as removed
from public.backup_4155_entries_removed b
join public.races r on r.id = b.race_id
join public.league_divisions ld on ld.id = r.league_division_id
group by ld.tier, b.is_auto_filled order by ld.tier, b.is_auto_filled;

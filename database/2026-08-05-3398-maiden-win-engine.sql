-- Maiden Win Engine (#3398, bølge 1 af verdensklasse-planen #3395) — career-firsts
-- detektion ved race/stage-finalization: rytterens første professionelle sejr,
-- første podium, første klassifikationstrøje, plus klub-milepæle (fx 50. sejr i
-- klubfarver).
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER MANUELT POST-MERGE (ejer-politik,
-- jf. feedback_migrations_never_auto_apply_via_mcp / #2642-rammerne). Ingen
-- apply_migration/execute_sql er kørt af agenten. Idempotent (CREATE TABLE IF
-- NOT EXISTS, DROP POLICY IF EXISTS + genskab).
--
-- ── EVENTMODEL-BESLUTNING (delt med #2490 rytter-krøniken, jf. #3398-scope) ──
-- Tabellen hedder `rider_career_events` (samme navn #2490's issue-body selv
-- foreslår) med et GENERISK `event_type text` — IKKE en dedikeret maiden-win-
-- tabel. #2490 (opdaget/gennembrud/tier-overgange/pension) kan forbruge SAMME
-- tabel ved blot at tilføje sine egne event_type-værdier (fx 'discovered',
-- 'breakthrough', 'tier_change', 'retired') — ingen paralleltabel, samme
-- "genbrug substratet"-regel som race_stage_moments (S6, #2355) allerede
-- demonstrerer for etape-momenter. Genmålt FØR denne fil blev skrevet: hverken
-- `rider_career_events`, `palmares` eller nogen anden career-event-tabel findes
-- i repoet i dag (grep 2026-08-05, ingen SQL-referencer) — dette ER fundamentet.
--
-- Denne slice skriver KUN fire event_type-værdier (se CHECK-constraint):
--   'maiden_win'        — rytterens FØRSTE nogensinde rank=1 (stage ELLER gc)
--   'first_podium'      — rytterens FØRSTE nogensinde rank<=3 (stage ELLER gc),
--                         udelades hvis rytteren SAMME afvikling også fik
--                         maiden_win (vinde > podie som "første"-historie)
--   'first_jersey'      — rytterens FØRSTE nogensinde rank=1 i en sekundær
--                         klassifikation (points/mountain/young) — SEPARAT pr.
--                         klassifikationstype (første sprinter-trøje ≠ første
--                         bjergtrøje som milepæl)
--   'club_milestone_win' — holdets N'te sejr NOGENSINDE i klubfarver (stage/gc,
--                         rank=1), N = multiplum af 25 (25., 50., 75., ...)
--
-- CHECK-constrainten er bevidst UDVIDELIG (ikke låst til kun disse fire) — en
-- fremtidig #2490-PR tilføjer sine egne værdier i en efterfølger-migration,
-- samme "efterfølger-fil"-mønster som notifications_type_check (se
-- 2026-08-05-3398-maiden-win-notification-type.sql i denne PR for et konkret
-- eksempel på mønstret).
--
-- Denormaliseret rider_name/team_name (mirror af race_results' egen
-- "-- denormalized for display"-konvention, schema.sql:171/173) — frontend kan
-- rendere momentkort/palmarès-linjer uden ekstra joins.
--
-- Idempotens (detektion må ALDRIG dublere ved gen-finalisering): dedupe_key er
-- UNIQUE. Detektions-koden (backend/lib/careerFirsts.js) beregner en stabil
-- nøgle pr. event (fx `rider:<id>:maiden_win`, `team:<id>:club_milestone_win:50`)
-- og tjekker eksistens FØR insert; UNIQUE-constrainten er sikkerhedsnettet ved
-- samtidige/gen-kørte afviklinger (insert-fejl 23505 behandles som "allerede
-- registreret", ikke en fejl).
CREATE TABLE IF NOT EXISTS public.rider_career_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'maiden_win', 'first_podium', 'first_jersey', 'club_milestone_win'
  )),
  race_id uuid REFERENCES public.races(id) ON DELETE SET NULL,
  season_number integer,
  rider_name text,   -- denormalized for display (mirrors race_results.rider_name)
  team_name text,    -- denormalized for display (mirrors race_results.team_name)
  params jsonb NOT NULL DEFAULT '{}'::jsonb, -- fx {age, raceName, resultType, stageNumber, classification, milestoneCount}
  significance smallint NOT NULL DEFAULT 0,
  dedupe_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rider_career_events_dedupe_key_key UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_rider_career_events_rider
  ON public.rider_career_events(rider_id, event_type);
CREATE INDEX IF NOT EXISTS idx_rider_career_events_team
  ON public.rider_career_events(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rider_career_events_race
  ON public.rider_career_events(race_id) WHERE race_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rider_career_events_occurred_at
  ON public.rider_career_events(occurred_at DESC);

ALTER TABLE public.rider_career_events ENABLE ROW LEVEL SECURITY;

-- RLS: SELECT for alle authenticated — offentlig karrierehistorik/palmarès-fakta
-- (mirror race_stage_moments_read, samme "offentlig løbsinformation"-begrundelse).
-- Write = admin/service_role (backend bypasser RLS ved persistering,
-- backend/lib/careerFirsts.js).
DROP POLICY IF EXISTS "rider_career_events_read" ON public.rider_career_events;
CREATE POLICY "rider_career_events_read"
  ON public.rider_career_events FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "rider_career_events_admin_write" ON public.rider_career_events;
CREATE POLICY "rider_career_events_admin_write"
  ON public.rider_career_events FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.rider_career_events IS
  '#3398 (Maiden Win Engine): career-first + klub-milepæl-events detekteret ved race/stage-finalization (backend/lib/careerFirsts.js, kaldt fra raceRunner.js). Generisk event_type — designet til at #2490 (rytter-krøniken: opdaget/gennembrud/tier-overgange/pension) kan genbruge SAMME tabel med sine egne event_type-værdier i en efterfølger-migration, i stedet for en konkurrerende paralleltabel. dedupe_key er UNIQUE og garanterer idempotent gen-finalisering (ingen dublet-events).';

-- Post-verify (kør efter apply): SELECT count(*), event_type FROM
-- public.rider_career_events GROUP BY event_type; — bør være 0 rækker lige
-- efter apply (ingen backfill i denne slice — kun fremadrettet detektion, jf.
-- #2490's egen "start fremadrettet; backfill kun hvad data tillader"-regel).

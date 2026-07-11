-- Ugentlig træningsrytme på holdniveau (#1895 PR 1) — slice 1 af "smart default rytme".
-- ============================================================
-- Ejer-godkendt design 11/7: holdets ugerytme = ønsket intensitet pr. ugedag
-- (mon..sun). Fokus rører den ALDRIG — fokus bor 100% i training_plans (#1163)
-- + smartDefaultFocus (#1894). Motoren lagdeler dagens intensitet pr. rytter:
--   1) rytterens pr-dag-override (rider_id sat — PR 2, ingen UI/motor-brug endnu)
--   2) holdets ugerytme for dagens ugedag (rider_id IS NULL), hvis sat
--   3) rytterens sæson-intensitet fra training_plans (nuværende adfærd)
--   4) "normal"
-- Hold uden nogen row = flad "normal" hver dag = BIT-IDENTISK med i dag (nul
-- balance-ændring). days-validering sker i app-kode (backend/lib/training.js
-- isValidWeekPlanDays), samme mønster som training_plans' focus/intensity.

CREATE TABLE IF NOT EXISTS training_week_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
  -- NULL = holdets fælles ugerytme. Sat = pr-rytter-override (PR 2 — feltet skal
  -- FINDES i skemaet nu, men ingen UI/motor-brug endnu i denne PR).
  rider_id    UUID NULL REFERENCES riders(id) ON DELETE CASCADE,
  -- {"mon":{"intensity":"normal"}, ..., "sun":{"intensity":"rest"}} — alle 7
  -- ugedags-nøgler kræves af app-koden. "theme"-nøgle pr. dag reserveret til
  -- fremtidig brug (#2337), skrives ikke af denne PR.
  days        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Postgres' almindelige UNIQUE(team_id, rider_id) behandler NULL ≠ NULL, så den
-- ville tillade flere holdrytme-rows pr. hold (rider_id IS NULL matcher aldrig
-- sig selv i unikheds-tjekket). Løsning: to PARTIAL unique indexes — én for
-- holdets rytme (rider_id IS NULL, højst én pr. hold), én for pr-rytter-rows
-- (rider_id IS NOT NULL, højst én pr. hold+rytter). Begge dækker upsert-stien
-- (onConflict skal matche en faktisk unik/eksklusions-begrænsning).
CREATE UNIQUE INDEX IF NOT EXISTS idx_training_week_plans_team_only
  ON training_week_plans (team_id) WHERE rider_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_training_week_plans_team_rider
  ON training_week_plans (team_id, rider_id) WHERE rider_id IS NOT NULL;

-- Engine slår op pr. hold (rider_id IS NULL) hver dag — dækkes af index'et
-- ovenfor (team_id, rider_id IS NULL). Ingen ekstra index nødvendigt.

COMMENT ON TABLE training_week_plans IS
  'Ugentlig træningsrytme (#1895 PR 1): holdets (rider_id NULL) eller en rytters '
  '(rider_id sat, PR 2 — ubrugt endnu) ønskede intensitet pr. ugedag. days-form: '
  '{"mon":{"intensity":"rest|easy|normal|hard"},...,"sun":{...}}, alle 7 nøgler '
  'krævet, valideret i app-kode. Fokus uændret — bor kun i training_plans.';

-- RLS: et hold må kun se/skrive sine egne rytme-rows. Backend bruger service-role
-- (bypasser RLS) på alle training-routes; policy'en holder direkte klient-læsning
-- sikker hvis vi senere eksponerer den (samme mønster som training_plans).
ALTER TABLE training_week_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_week_plans_own_select" ON training_week_plans;
CREATE POLICY "training_week_plans_own_select" ON training_week_plans
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "training_week_plans_own_insert" ON training_week_plans;
CREATE POLICY "training_week_plans_own_insert" ON training_week_plans
  FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "training_week_plans_own_update" ON training_week_plans;
CREATE POLICY "training_week_plans_own_update" ON training_week_plans
  FOR UPDATE TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()))
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "training_week_plans_own_delete" ON training_week_plans;
CREATE POLICY "training_week_plans_own_delete" ON training_week_plans
  FOR DELETE TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE user_id = auth.uid()));

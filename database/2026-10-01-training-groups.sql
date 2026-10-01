-- #6000 — traeningsgrupper (beta): een beslutning for flere ryttere.
-- Ejer-godkendt mockup 1/10: docs/design/mockups-traen-nu-2026-09-29/training-groups-2026-10-01.png
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
-- Applies post-merge (auto-migrate.yml, #2642). Indtil da svarer API'et som om
-- holdet ingen grupper har (42P01/PGRST205 → ingen grupper), og motoren og
-- prognosen koerer praecis som foer.
--
-- Datamodel:
--   training_groups          een raekke pr. gruppe (navn, gruppens 35 felter,
--                            valgfri traethedsgraense-undtagelse for hele gruppen).
--   training_group_members   een raekke pr. rytter (rider_id er PRIMARY KEY:
--                            en rytter er i hoejst een gruppe).
--
-- Planen bor stadig i training_week_plans. En gruppe-aendring skriver en KOPI
-- ind i hver foelgende rytters egen raekke (samme ejer-valg 1 som programmer,
-- 26/9), saa motoren laeser praecis som i dag. `follows_group` = false betyder
-- at spilleren har rettet rytterens egen plan bagefter: saa vinder rytterens
-- plan, og gruppen roerer den ikke (stigen: rytter → gruppe → hold).
--
-- days NULL = gruppen har ingen felter endnu; medlemmerne beholder deres plan,
-- indtil spilleren retter gruppens foerste felt eller saetter et program paa.

CREATE TABLE IF NOT EXISTS public.training_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  days              jsonb NULL,
  program_key       text NULL,
  fatigue_threshold integer NULL CHECK (fatigue_threshold BETWEEN 0 AND 100),
  fallback          text NULL CHECK (fallback IN ('light', 'recovery', 'rest', 'off')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Samme par-regel som team_training_rules: graense og erstatning hoerer sammen;
  -- 'off' = ingen traethedsgraense for gruppens ryttere.
  CONSTRAINT training_groups_fatigue_pair CHECK (
    (fallback IS NULL AND fatigue_threshold IS NULL)
    OR (fallback IN ('light', 'recovery', 'rest') AND fatigue_threshold IS NOT NULL)
    OR (fallback = 'off' AND fatigue_threshold IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_training_groups_team ON public.training_groups (team_id);

COMMENT ON TABLE public.training_groups IS
  'Training groups (#6000, beta): one decision for several riders. days = the group''s program week (copied into each following member''s training_week_plans row); fatigue_threshold/fallback = fatigue-limit exception for the whole group.';

CREATE TABLE IF NOT EXISTS public.training_group_members (
  rider_id      uuid PRIMARY KEY REFERENCES public.riders(id) ON DELETE CASCADE,
  group_id      uuid NOT NULL REFERENCES public.training_groups(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  follows_group boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_group_members_group ON public.training_group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_training_group_members_team ON public.training_group_members (team_id);

COMMENT ON TABLE public.training_group_members IS
  'Training group membership (#6000). rider_id is the primary key: a rider is in at most one group. follows_group = false once the player edits the rider''s own plan (the rider''s plan then wins over the group''s).';

-- RLS: et hold ser/skriver kun egne grupper. Backend bruger service-role; policy'erne
-- holder direkte klient-adgang sikker. initplan-form ((SELECT auth.uid())), een
-- permissive policy pr. kommando (#2677).
ALTER TABLE public.training_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS training_groups_own_select ON public.training_groups;
CREATE POLICY training_groups_own_select ON public.training_groups
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_groups_own_insert ON public.training_groups;
CREATE POLICY training_groups_own_insert ON public.training_groups
  FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_groups_own_update ON public.training_groups;
CREATE POLICY training_groups_own_update ON public.training_groups
  FOR UPDATE TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())))
  WITH CHECK (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_groups_own_delete ON public.training_groups;
CREATE POLICY training_groups_own_delete ON public.training_groups
  FOR DELETE TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_group_members_own_select ON public.training_group_members;
CREATE POLICY training_group_members_own_select ON public.training_group_members
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_group_members_own_insert ON public.training_group_members;
CREATE POLICY training_group_members_own_insert ON public.training_group_members
  FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_group_members_own_update ON public.training_group_members;
CREATE POLICY training_group_members_own_update ON public.training_group_members
  FOR UPDATE TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())))
  WITH CHECK (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_group_members_own_delete ON public.training_group_members;
CREATE POLICY training_group_members_own_delete ON public.training_group_members
  FOR DELETE TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

REVOKE ALL ON public.training_groups FROM anon;
REVOKE ALL ON public.training_group_members FROM anon;

-- Stadie-flaget oprettes i 'beta' (moenster: 2026-10-01-training-fatigue-rules.sql).
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.
-- Flip til 'on' er ejer-only.
INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_groups',
  '"beta"'::jsonb,
  'Stage flag (off|beta|on) for training groups (#6000): one plan decision for several riders, group fatigue-limit exception. beta = beta testers see and use groups, and the engine applies group fatigue exceptions only for teams whose owner is a beta tester. off = groups are hidden and no group exception is applied.'
)
ON CONFLICT (key) DO NOTHING;

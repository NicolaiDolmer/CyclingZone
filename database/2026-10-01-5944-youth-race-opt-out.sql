-- #5944 — fravaelg U23-/juniorloeb pr. trup ("Train only").
-- Skitse (ejer-go 1/10): docs/design/mockups-5944-youth-opt-out-2026-10-01/sketch.png.
-- Regel-SSOT: docs/YOUTH_RULES.md §2.3 + docs/ASSISTANT_RULES.md.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
-- Applies post-merge (auto-migrate.yml, #2642). Indtil da svarer backend som om
-- intet hold har fravalgt (42P01/PGRST205 → "Enter races" for alle), og
-- skrivestien svarer 503, saa et valg aldrig ser gemt ud uden at vaere det.
--
-- Raekkens betydning: findes (team_id, squad) her, er truppen sat til
-- "Train only": assistenten udtager den ikke, og manuel tilmelding til truppens
-- ungdomsloeb afvises. Ingen raekke = "Enter races" (standard, uaendret).

CREATE TABLE IF NOT EXISTS public.team_youth_race_opt_outs (
  team_id    uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  squad      text NOT NULL CHECK (squad IN ('u23', 'junior')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, squad)
);

COMMENT ON TABLE public.team_youth_race_opt_outs IS
  'Youth squads set to "Train only" (#5944): the assistant does not enter the squad and manual entry to its youth races is refused. No row = "Enter races" (default).';

-- RLS: et hold ser kun egne valg. Skrivning sker KUN via backend (service-role),
-- fordi et skift til "Train only" ogsaa skal fjerne truppens tilmeldinger til
-- ulaaste loeb i samme kald; en direkte klient-skrivning ville springe det over.
-- initplan-form ((SELECT auth.uid())), én permissive policy (#2677).
ALTER TABLE public.team_youth_race_opt_outs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_youth_race_opt_outs_own_select ON public.team_youth_race_opt_outs;
CREATE POLICY team_youth_race_opt_outs_own_select ON public.team_youth_race_opt_outs
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

REVOKE ALL ON public.team_youth_race_opt_outs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.team_youth_race_opt_outs FROM authenticated;

-- #8592: "Kun denne dag". Et pas for en rytter på én dato i den rullende uge (i dag + 1..7).
-- Ejerbeslutning 26/11 på #8592. Dommer-scenarier: docs/audits/8592-kun-denne-dag-dommer-scenarier.md.
--
-- ADDITIV OG IDEMPOTENT. Ny tabel, ingen eksisterende række ændres, intet slettes, ingen backfill.
-- Køres post-merge af auto-migrate (#2642). Tænding af kontakten er ejer-only.
--
-- 1. training_day_overrides: én række pr. (hold, rytter, dato). `session` er et pas fra
--    programkataloget (valideres i backend/lib/trainingDayOverride8592.js, isProgramSession).
--    Ugeplanen (training_week_plans) røres aldrig; dagen efter læser motoren intet valg.
--    Udløbne rækker (dato før i dag) slettes af API'et ved næste læsning eller skrivning.
-- 2. Kontakten training_day_override_8592 (off|beta|on) seedes "off" (ON CONFLICT DO NOTHING):
--    off = motoren læser hverken kontakten eller tabellen, og API'et afviser skrivning (409).
--
-- RLS: som training_week_plans (eget hold, initplan-wrappet auth.uid()). Backend skriver med
-- service-role som i dag; motoren validerer selv passet og stoler aldrig på kolonnen.

CREATE TABLE IF NOT EXISTS public.training_day_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  rider_id       uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  override_date  date NOT NULL,
  session        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_day_overrides_team_rider_date_key UNIQUE (team_id, rider_id, override_date)
);

-- Motorens og prognosens opslag: hold + dato. Unik-nøglen dækker hold + rytter.
CREATE INDEX IF NOT EXISTS idx_training_day_overrides_team_date
  ON public.training_day_overrides (team_id, override_date);
-- FK-indeks (rider_id), samme vagt som database/2026-08-23-fk-indexes-cutover.sql.
CREATE INDEX IF NOT EXISTS idx_training_day_overrides_rider
  ON public.training_day_overrides (rider_id);

COMMENT ON TABLE public.training_day_overrides IS
  'Kun denne dag (#8592): et pas for en rytter på én dato (i dag + 1..7). Vinder over ugedag, '
  'rotation og ugeblok, aldrig over løb, binding eller skade. Bag kontakten training_day_override_8592.';

ALTER TABLE public.training_day_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS training_day_overrides_own_select ON public.training_day_overrides;
CREATE POLICY training_day_overrides_own_select ON public.training_day_overrides
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_day_overrides_own_insert ON public.training_day_overrides;
CREATE POLICY training_day_overrides_own_insert ON public.training_day_overrides
  FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_day_overrides_own_update ON public.training_day_overrides;
CREATE POLICY training_day_overrides_own_update ON public.training_day_overrides
  FOR UPDATE TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())))
  WITH CHECK (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_day_overrides_own_delete ON public.training_day_overrides;
CREATE POLICY training_day_overrides_own_delete ON public.training_day_overrides
  FOR DELETE TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_day_override_8592',
  '"off"'::jsonb,
  'Stage flag (off|beta|on, #8592): "Only this day", one session for a rider on one date in the rolling week. off = the engine never reads the table and the API rejects writes. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;

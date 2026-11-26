-- #8592: "Kun denne dag". Et pas for en rytter på én dato i den rullende uge (i dag + 1..7).
-- Ejerbeslutning 26/11 på #8592 og #8819. Dommer-scenarier: docs/audits/8592-kun-denne-dag-dommer-scenarier.md.
--
-- ADDITIV OG IDEMPOTENT. Ny tabel, ingen eksisterende række ændres, intet slettes, ingen backfill.
-- Køres post-merge af auto-migrate (#2642). Tænding af kontakten er ejer-only.
--
-- 1. training_day_overrides: én række pr. (hold, rytter, dato). `session` er et pas fra
--    programkataloget (valideres i backend/lib/trainingDayOverride8592.js, isProgramSession).
--    Ugeplanen (training_week_plans) røres aldrig; dagen efter læser motoren intet valg.
--    `beats_fatigue_rule` (#8819, DO-10): valget blev truffet, mens træthedsgrænsen synligt havde
--    erstattet dagen, og går derfor forud for grænsen. Sættes kun af backend.
--    Et valg fra en tidligere dato bevares, til datoen er gjort op (training_date_work = complete),
--    og slettes først derefter af API'et (#8819, DO-9).
-- 2. Kontakten training_day_override_8592 (off|beta|on) seedes "off" (ON CONFLICT DO NOTHING):
--    off = motoren læser aldrig tabellen, og API'et afviser skrivning (409).
--
-- Adgang (#8819, DO-13; docs/DATA_API_GRANTS.md): spilleren må kun LÆSE eget holds rækker.
-- Al skrivning går gennem API'et med service-role, som validerer dato, pas og ryttere.
-- data-api-access: {"table":"public.training_day_overrides","roles":{"anon":[],"authenticated":["SELECT"],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Owners read their own team's day choices; the backend API writes them with service-role and the training engine reads them"}

CREATE TABLE IF NOT EXISTS public.training_day_overrides (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  rider_id            uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  override_date       date NOT NULL,
  session             text NOT NULL,
  beats_fatigue_rule  boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_day_overrides_team_rider_date_key UNIQUE (team_id, rider_id, override_date)
);

-- Idempotent også hvis en tidlig udgave af tabellen (uden kolonnen) allerede findes.
ALTER TABLE public.training_day_overrides
  ADD COLUMN IF NOT EXISTS beats_fatigue_rule boolean NOT NULL DEFAULT false;

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

REVOKE ALL ON TABLE public.training_day_overrides FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.training_day_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.training_day_overrides TO service_role;

DROP POLICY IF EXISTS training_day_overrides_own_select ON public.training_day_overrides;
CREATE POLICY training_day_overrides_own_select ON public.training_day_overrides
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

-- #8819 (Fable-fund 4): ingen skrive-politikker for spilleren. Fjernes, hvis en tidlig udgave findes.
DROP POLICY IF EXISTS training_day_overrides_own_insert ON public.training_day_overrides;
DROP POLICY IF EXISTS training_day_overrides_own_update ON public.training_day_overrides;
DROP POLICY IF EXISTS training_day_overrides_own_delete ON public.training_day_overrides;

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_day_override_8592',
  '"off"'::jsonb,
  'Stage flag (off|beta|on, #8592): "Only this day", one session for a rider on one date in the rolling week. off = the engine never reads the table and the API rejects writes. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;

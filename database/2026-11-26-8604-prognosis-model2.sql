-- #8604 Del 2 · Model 2 for prognosen, bag kontakten prognosis_model2 (seedet "off").
--
-- ADDITIV + IDEMPOTENT. Ingen eksisterende data aendres.
--
-- 1) public.rider_prognosis_model2 - den forberedte prognose pr. (rytter, hold). Skrives kun
--    af baggrundskoerslen (backend/lib/prognosisModel2_8604.js), aldrig i en anmodning.
--    Profil, trup, akademi og hoverkort laeser samme raekke, saa tallet er ens paa alle flader.
--    `input_hash` er en hash af alt, raekken bygger paa; en ny koersel med samme input skriver
--    intet (idempotent publicering). Holdet er en del af noeglen, saa et ejerskifte aldrig
--    viser det tidligere holds raekke. Server-only: RLS uden policies og ingen privilegier
--    til anon/authenticated. Kun det afrundede tal og intervallet naar spilleren, via ruterne.
--
-- 2) app_config.prognosis_model2 seedes "off": med kontakten slukket laeses tabellen aldrig,
--    og prognosen er bit for bit den nuvaerende.
--
-- INTET APPLY FOER MERGE (#2642): auto-migrate.yml koerer filen efter merge.
--
-- ROLLBACK:
--   DELETE FROM public.app_config WHERE key = 'prognosis_model2';
--   DROP TABLE IF EXISTS public.rider_prognosis_model2;
--
-- Refs #8604.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rider_prognosis_model2 (
  rider_id       uuid        NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  team_id        uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  value          smallint    NOT NULL CHECK (value BETWEEN 1 AND 99),
  band_lo        smallint    NOT NULL CHECK (band_lo BETWEEN 1 AND 99),
  band_hi        smallint    NOT NULL CHECK (band_hi BETWEEN 1 AND 99),
  observed_dates smallint    NOT NULL DEFAULT 0 CHECK (observed_dates >= 0),
  model_version  text        NOT NULL,
  input_hash     text        NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rider_id, team_id),
  CHECK (band_lo <= value AND value <= band_hi)
);

CREATE INDEX IF NOT EXISTS rider_prognosis_model2_team ON public.rider_prognosis_model2 (team_id, rider_id);

COMMENT ON TABLE public.rider_prognosis_model2 IS
  '#8604 Model 2: prepared prognosis per (rider, team) from the background batch. One rounded value and a band that narrows with settled dates. Server-only: RLS without policies, no client privileges.';

-- data-api-access: {"table":"public.rider_prognosis_model2","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Prepared prognosis per rider and team (#8604); only the backend batch writes it and the backend routes read it"}
ALTER TABLE public.rider_prognosis_model2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rider_prognosis_model2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_prognosis_model2 TO service_role;

INSERT INTO public.app_config (key, value, description)
VALUES (
  'prognosis_model2',
  '"off"'::jsonb,
  'Stage flag (off|on, #8604): Model 2 for the prognosis. On = own riders read the prepared prognosis from rider_prognosis_model2 (engine XP simulation with the current training mix, calibrated to the visible potential estimate). Off = the current pace prognosis, unchanged. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

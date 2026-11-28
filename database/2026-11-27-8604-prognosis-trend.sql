-- #8604 Trend-prognosen, bag kontakten prognosis_trend_8604 (seedet "off").
--
-- ADDITIV + IDEMPOTENT. Ingen eksisterende data aendres.
--
-- 1) public.rider_prognosis_trend - den forberedte trend-prognose pr. (rytter, hold). Skrives
--    kun af baggrundskoerslen (backend/lib/prognosisTrendSweep.js), aldrig i en anmodning.
--    Profil, trup, akademi og hoverkort laeser samme raekke, saa tallet er ens paa alle flader.
--    `input_hash` er en hash af alt, raekken bygger paa; en ny koersel med samme input skriver
--    intet (idempotent publicering). Holdet er en del af noeglen, saa et ejerskifte aldrig
--    viser det tidligere holds raekke. Ingen baand (ejer 27/11): kun tallet, om det stadig
--    laeres, og om det er toppen eller "om et aar". Server-only: RLS uden policies og ingen
--    privilegier til anon/authenticated.
--
-- 2) app_config.prognosis_trend_8604 seedes "off": med kontakten slukket laeses tabellen
--    aldrig, og prognosen er bit for bit den nuvaerende.
--
-- INTET APPLY FOER MERGE (#2642): auto-migrate.yml koerer filen efter merge.
--
-- ROLLBACK:
--   DELETE FROM public.app_config WHERE key = 'prognosis_trend_8604';
--   DROP TABLE IF EXISTS public.rider_prognosis_trend;
--
-- Refs #8604.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rider_prognosis_trend (
  rider_id       uuid        NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  team_id        uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  value          smallint    NOT NULL CHECK (value BETWEEN 1 AND 99),
  learning       boolean     NOT NULL DEFAULT true,
  horizon        text        NOT NULL DEFAULT 'top' CHECK (horizon IN ('top', 'year')),
  own_dates      smallint    NOT NULL DEFAULT 0 CHECK (own_dates >= 0),
  model_version  text        NOT NULL,
  input_hash     text        NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rider_id, team_id)
);

CREATE INDEX IF NOT EXISTS rider_prognosis_trend_team ON public.rider_prognosis_trend (team_id, rider_id);

COMMENT ON TABLE public.rider_prognosis_trend IS
  '#8604 Trend prognosis: prepared prognosis per (rider, team) from the background batch. One rounded value, a learning mark and the horizon (top before the decline, or one year ahead). Server-only: RLS without policies, no client privileges.';

-- data-api-access: {"table":"public.rider_prognosis_trend","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Prepared trend prognosis per rider and team (#8604); only the backend batch writes it and the backend routes read it"}
ALTER TABLE public.rider_prognosis_trend ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rider_prognosis_trend FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_prognosis_trend TO service_role;

INSERT INTO public.app_config (key, value, description)
VALUES (
  'prognosis_trend_8604',
  '"off"'::jsonb,
  'Stage flag (off|on, #8604): trend prognosis. On = own riders read the prepared prognosis from rider_prognosis_trend (settled XP pace over the career, engine price per ability step, aging spread over the season). Off = the current pace prognosis, unchanged. "beta" reads as off. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

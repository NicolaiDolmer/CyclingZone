-- #8604 Trend-prognosen: kørslens hukommelse i databasen (ejer 28/11).
--
-- ADDITIV + IDEMPOTENT. Ingen eksisterende data aendres.
--
-- public.prognosis_trend_state - én raekke (id 1): datoen for dagens fulde koersel, maalingen
-- af "normal traening" (faktoren) og de hold, der fejlede. Saa starter et deploy eller en
-- genstart ikke en ny fuld koersel, og et fejlende hold proeves alene naeste time. Skrives kun
-- af baggrundskoerslen (backend/lib/prognosisTrendSweep.js). Server-only: RLS uden policies og
-- ingen privilegier til anon/authenticated. Bag kontakten prognosis_trend_8604: slukket laeses
-- og skrives tabellen aldrig.
--
-- INTET APPLY FOER MERGE (#2642): auto-migrate.yml koerer filen efter merge.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.prognosis_trend_state;
--
-- Refs #8604.

BEGIN;

CREATE TABLE IF NOT EXISTS public.prognosis_trend_state (
  id               smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  full_run_date    date,
  factor           double precision CHECK (factor IS NULL OR factor > 0),
  failed_team_ids  uuid[]      NOT NULL DEFAULT '{}',
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.prognosis_trend_state IS
  '#8604 Trend prognosis batch memory: one row with the date of the day''s full run, the measured normal-training factor and the teams that failed (retried alone next hour). Server-only: RLS without policies, no client privileges.';

-- data-api-access: {"table":"public.prognosis_trend_state","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Trend prognosis batch memory (#8604); only the backend batch reads and writes it"}
ALTER TABLE public.prognosis_trend_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prognosis_trend_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prognosis_trend_state TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

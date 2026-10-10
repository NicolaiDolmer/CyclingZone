-- #5979 · selection_warning_receipts: varigt bevis for at en manager HAR faaet
-- holdudtagelses-paamindelsen (selection_warning) for et bestemt loeb.
--
-- Hvorfor en egen tabel: selectionWarningSweep.js dedup'ede kun mod
-- notifications-raekker inden for 24 t. Indbakken sletter raekker fysisk, saa
-- naar manageren slettede beskeden, forsvandt dedup-beviset, og naeste sweep-tick
-- (hvert 5. min) sendte den igen. 36-timers-vinduet er desuden laengere end
-- 24-timers-dedup'en, saa beskeden kunne komme to gange selv uden sletning.
-- En kvittering slettes ALDRIG naar beskeden slettes.
--
-- Raekkens betydning: (user_id, race_id) findes = paamindelsen er sendt (eller var
-- allerede sendt) til den manager for det loeb. PRIMARY KEY er claim'en: sweepet
-- skriver med ON CONFLICT DO NOTHING foer det sender, saa to samtidige sweeps
-- giver én besked.
--
-- ADDITIV OG IDEMPOTENT: CREATE TABLE IF NOT EXISTS, ingen eksisterende raekke
-- aendres, intet slettes. Applies post-merge af auto-migrate.yml (#2642).
-- DEPLOY-RAEKKEFOELGE: backend kan naa prod foer tabellen; sweepet falder da
-- tilbage til den gamle 24 t-dedup (42P01/PGRST205, ingen Sentry) til migrationen
-- er koert.
--
-- RLS: enabled, INGEN policy, kun service_role (samme moenster som
-- user_milestones). Klienten laeser/skriver aldrig tabellen.
--
-- FK: user_id -> auth.users ON DELETE CASCADE (som user_milestones). race_id har
-- bevidst INGEN FK: en FK ville tage en laas paa den varme races-tabel under
-- apply, og en foraeldreloes kvittering for et slettet loeb er harmloes.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT column_name, data_type FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='selection_warning_receipts' ORDER BY ordinal_position;
--   2. SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_schema='public' AND table_name='selection_warning_receipts';  -- kun service_role (+ postgres)
--   3. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.selection_warning_receipts'::regclass;  -- true
--
-- Rollback: DROP TABLE IF EXISTS public.selection_warning_receipts;
--
-- Refs #5979
-- data-api-access: {"table":"public.selection_warning_receipts","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Server-written reminder receipts; only the backend selection-warning sweep reads and writes them"}

BEGIN;
-- FK'en til auth.users tager en kort laas paa den; fejl hurtigt i stedet for at
-- koe bag live-trafik (re-run er idempotent).
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.selection_warning_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  race_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, race_id)
);

-- Sweepet slaar kvitteringer op pr. race_id (de loeb der er i vinduet).
CREATE INDEX IF NOT EXISTS selection_warning_receipts_race_id_idx
  ON public.selection_warning_receipts (race_id);

ALTER TABLE public.selection_warning_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.selection_warning_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.selection_warning_receipts TO service_role;

COMMENT ON TABLE public.selection_warning_receipts IS
  '#5979: durable receipt that the selection_warning reminder was sent to a user for a race. '
  'Never deleted when the notification is deleted. service_role only.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- #7382 (ejer-beslutning 30/10): hvem der får den bløde overgang, låst ved
-- tændingen.
--
-- Kun evner der stod på eller over kurve B's bløde loft, da kurve B blev tændt,
-- får overgangen. Første gang kurve B er aktiv, tager træningsmotoren
-- (backend/lib/developmentCurveBTransition7382.ts) ÉT samlet øjebliksbillede: én
-- række pr. rytter på et managerhold (managerhold-reglen; ikke pensioneret) med de
-- evner der stod på eller over loftet (også tomme rækker). Først derefter stemples
-- tændingsdatoen (dagens danske dato) i app_config. insert ... on conflict do
-- nothing, så en genkørsel aldrig flytter medlemskabet. Resten af vinduet læses
-- kun rækken; en rytter uden række (fx kommet til et managerhold senere) får kurve
-- B fuldt. En ny tænding (ny dato) giver nye rækker.
--
-- Privat: RLS slået til UDEN policies, og kun service_role har grants. Ingen
-- klient (anon/authenticated) kan læse eller skrive.
--
-- ADDITIV + IDEMPOTENT: en ny tabel, intet andet ændres. Kan køres igen uden
-- effekt. Apply post-merge (#2642), og før development_curve_b tændes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- data-api-access: {"table":"public.development_curve_b_transition_members","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Curve B transition membership locked by the ignition snapshot (#7382); written and read by the training engine with the service role only"}
CREATE TABLE IF NOT EXISTS public.development_curve_b_transition_members (
  rider_id uuid NOT NULL,
  -- Tændingsdatoen (app_config development_curve_b_ignited_at, dansk dato).
  ignited_on date NOT NULL,
  -- Evnerne på eller over det bløde loft ved tændingen. Tom = ingen.
  abilities text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rider_id, ignited_on)
);

ALTER TABLE public.development_curve_b_transition_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.development_curve_b_transition_members FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.development_curve_b_transition_members TO service_role;

-- Constraint tilføjes NOT VALID (ingen fuld-scan under lås) og valideres bagefter.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'development_curve_b_transition_members_rider_fk') THEN
    ALTER TABLE public.development_curve_b_transition_members
      ADD CONSTRAINT development_curve_b_transition_members_rider_fk
      FOREIGN KEY (rider_id) REFERENCES public.riders(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE public.development_curve_b_transition_members VALIDATE CONSTRAINT development_curve_b_transition_members_rider_fk;

COMMENT ON TABLE public.development_curve_b_transition_members IS
  '#7382: abilities at or above the curve B soft ceiling at ignition (one snapshot of all manager-team riders, soft transition membership). Written once per rider and ignition by the training engine. Service role only.';

COMMIT;

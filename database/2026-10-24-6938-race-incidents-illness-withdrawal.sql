-- =============================================================================
-- 2026-10-24 · #6938 - race_incidents kender 'illness' og 'withdrawal'
-- =============================================================================
-- BAGGRUND: motor v3-tilvalget "flere udgaaede" (#6938, spec
-- docs/superpowers/specs/2026-10-23-6804-v3-tilvalg-design.md §2.2) giver to nye
-- veje ud af et loeb, bag den slukkede regel-revision s5_profiles_v3:
--
--   1. 'illness' (U1): rytteren starter ikke dagens etape (traethed og form).
--   2. 'withdrawal' (U3): en sat hjaelper stiger af i et endagsloeb.
--
-- Begge skrives som outcome='abandon' (saa loadAbandonedRiderIds holder rytteren
-- ude af naeste etape) med injury_days = NULL og severity = NULL: ingen af dem er
-- en skade (#4520: kun et styrt skader).
--
-- SCOPE: kun en udvidelse af race_incidents_kind_check. Ingen data muteres,
-- ingen eksisterende raekke bliver ugyldig. Intet loeb kan skrive de nye vaerdier
-- foer s5_profiles_v3 er taendt (ejer-only).
--
-- IDEMPOTENT: constrainten erstattes kun naar den mangler en af de nye vaerdier.
-- NOT VALID + VALIDATE i hvert sit skridt (svagere laas paa valideringen).
--
-- ROLLBACK (kun muligt hvis ingen raekke med de nye vaerdier er skrevet):
--   ALTER TABLE public.race_incidents DROP CONSTRAINT IF EXISTS race_incidents_kind_check;
--   ALTER TABLE public.race_incidents ADD CONSTRAINT race_incidents_kind_check
--     CHECK (kind = ANY (ARRAY['crash','mechanical','injury','time_limit']));
--
-- Post-verify (read-only):
--   SELECT pg_get_constraintdef(oid), convalidated FROM pg_constraint
--    WHERE conname = 'race_incidents_kind_check' AND conrelid = 'public.race_incidents'::regclass;
--
-- Refs #6938, #6804, #4879, #4418, #4520
-- =============================================================================

SET lock_timeout = '3s';

BEGIN;

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'race_incidents_kind_check'
     AND conrelid = 'public.race_incidents'::regclass;
  IF def IS NULL OR position('illness' IN def) = 0 OR position('withdrawal' IN def) = 0 THEN
    ALTER TABLE public.race_incidents
      DROP CONSTRAINT IF EXISTS race_incidents_kind_check;
    ALTER TABLE public.race_incidents
      ADD CONSTRAINT race_incidents_kind_check
      CHECK (kind = ANY (ARRAY['crash'::text, 'mechanical'::text, 'injury'::text, 'time_limit'::text, 'illness'::text, 'withdrawal'::text])) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.race_incidents.kind IS
  'Haendelsens art. crash/mechanical opstaar UNDER etapen (race engine v3 #1176, '
  'v4''s trappe #2944). injury (#4418): rytteren blev skadet uden for loebet og '
  'kunne ikke stille til start. time_limit (#2582): v4''s tidsgraense. illness '
  '(#6938 U1, s5_profiles_v3): rytteren startede ikke etapen (traethed og form). '
  'withdrawal (#6938 U3, s5_profiles_v3): en sat hjaelper steg af i et endagsloeb. '
  'time_limit, illness og withdrawal skrives med outcome=abandon. Kun et styrt '
  'saetter injury_days (#4520).';

COMMIT;

ALTER TABLE public.race_incidents
  VALIDATE CONSTRAINT race_incidents_kind_check;

DO $$
DECLARE
  def text;
  validated boolean;
BEGIN
  SELECT pg_get_constraintdef(oid), convalidated INTO def, validated
    FROM pg_constraint
   WHERE conname = 'race_incidents_kind_check'
     AND conrelid = 'public.race_incidents'::regclass;
  IF def IS NULL OR position('illness' IN def) = 0 OR position('withdrawal' IN def) = 0
     OR position('time_limit' IN def) = 0 OR position('injury' IN def) = 0
     OR position('mechanical' IN def) = 0 OR position('crash' IN def) = 0 THEN
    RAISE EXCEPTION '#6938 verify: race_incidents_kind_check mangler en art (%).', def;
  END IF;
  IF NOT validated THEN
    RAISE EXCEPTION '#6938 verify: race_incidents_kind_check er ikke valideret.';
  END IF;
END $$;

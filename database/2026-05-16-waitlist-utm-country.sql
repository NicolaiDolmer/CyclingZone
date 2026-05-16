-- Founder Supporter waitlist — UTM-tracking + country attribution.
-- Refs #362 (waitlist-form). Adds 3 nullable columns:
--   country         — ISO 3166-1 alpha-2 (DK, SE, NO, etc.). User-selected i form.
--   utm_campaign    — Auto-captured fra ?utm_campaign=... query-param.
--                     Bruges af Option B price-variant-tracking: 3 landing-page-varianter
--                     med forskellige pris-punkter sender forskellige utm_campaign-værdier.
--   utm_medium      — Auto-captured fra ?utm_medium=... (organic / paid / social / referral).
--
-- Eksisterende `source`-kolonne (#359) bevarer rolle som utm_source/manuel-tag (single field).
-- Disse 3 udvider attribution uden at bryde eksisterende dashboard-queries (#363).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS — auto-migrate kan re-køre uden side-effekter.
--
-- Rollback:
--   ALTER TABLE founder_supporter_waitlist
--     DROP COLUMN IF EXISTS country,
--     DROP COLUMN IF EXISTS utm_campaign,
--     DROP COLUMN IF EXISTS utm_medium;

ALTER TABLE public.founder_supporter_waitlist
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_medium text;

-- Country er ISO 3166-1 alpha-2 (2 tegn, uppercase). Soft-constraint via CHECK
-- så form-validation kan tilbyde EU-prefill uden at hard-blokere edge-cases.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'waitlist_country_iso_format'
      AND conrelid = 'public.founder_supporter_waitlist'::regclass
  ) THEN
    ALTER TABLE public.founder_supporter_waitlist
      ADD CONSTRAINT waitlist_country_iso_format
        CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
  END IF;
END $$;

COMMENT ON COLUMN public.founder_supporter_waitlist.country IS
  'ISO 3166-1 alpha-2 country code (DK, SE, NO, etc.). Self-reported via form-dropdown med EU-prefill.';

COMMENT ON COLUMN public.founder_supporter_waitlist.utm_campaign IS
  'Auto-captured fra ?utm_campaign=... query-param. Driver Option B price-variant-tracking (#362): 3 landing-varianter → 3 campaign-værdier.';

COMMENT ON COLUMN public.founder_supporter_waitlist.utm_medium IS
  'Auto-captured fra ?utm_medium=... query-param. Standard UTM: organic / paid / social / referral / email.';

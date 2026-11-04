-- =============================================================================
-- 2026-11-04 · #7666 - roadmap-horisonter + datoer paa known issues' tidslinje
-- =============================================================================
-- Ejer 4/11: spillerne skal kunne se, HVORNAAR noget er planlagt. Plan-fanen
-- grupperer derfor efter horisont: denne uge, naeste uge, denne saeson, naeste
-- saeson, 2027 og senere.
--
-- 1. roadmap_items.horizon faar de nye vaerdier. 'next' BEVARES: eksisterende
--    punkter staar paa 'next', indtil ejeren har flyttet dem (data-skridt efter
--    merge, ikke her). Klienten viser 'next' som sin egen gruppe imens.
--
-- 2. known_issues faar confirmed_at og fixing_at, saa status-tidslinjen
--    (meldt -> bekraeftet -> rettes -> rettet) kan vise en dato pr. trin.
--    created_at og closed_at fandtes i forvejen. En trigger stempler trinnet,
--    naar status skifter; gaar en fejl et trin tilbage, ryddes de senere
--    stempler, saa tidslinjen aldrig viser et trin der ikke gaelder mere.
--    Ingen backfill: datoen for tidligere skift kendes ikke, og et gaet ville
--    vise spilleren en forkert dato. Klienten viser trinnet uden dato.
--
-- Additiv + idempotent. Ingen data flyttes eller slettes, ingen RLS aendres
-- (tabel-grants daekker de nye kolonner).
-- APPLY IKKE her: auto-migrate.yml applier post-merge (#2642).
--
-- Rollback (kun hvis noedvendigt, og foerst naar ingen raekke bruger de nye
-- horisonter):
--   DROP TRIGGER IF EXISTS known_issues_stamp_status ON public.known_issues;
--   DROP FUNCTION IF EXISTS public.known_issues_stamp_status();
--   ALTER TABLE public.known_issues DROP COLUMN IF EXISTS confirmed_at, DROP COLUMN IF EXISTS fixing_at;
--   ALTER TABLE public.roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_horizon_check;
--   ALTER TABLE public.roadmap_items ADD CONSTRAINT roadmap_items_horizon_check CHECK (horizon IN ('next', 'later'));
-- =============================================================================

SET lock_timeout = '3s';

-- 1. Horisonter -------------------------------------------------------------
ALTER TABLE public.roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_horizon_check;
ALTER TABLE public.roadmap_items ADD CONSTRAINT roadmap_items_horizon_check
  CHECK (horizon IN ('this_week', 'next_week', 'next', 'this_season', 'next_season', 'y2027', 'later'));

COMMENT ON COLUMN public.roadmap_items.horizon IS
  'Hvornaar punktet er planlagt (#7666): this_week, next_week, this_season, next_season, y2027, later. next er den gamle "snart"-vaerdi og bevares, til data er flyttet.';

-- 2. Tidslinje paa kendte fejl ---------------------------------------------
ALTER TABLE public.known_issues ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE public.known_issues ADD COLUMN IF NOT EXISTS fixing_at TIMESTAMPTZ;

COMMENT ON COLUMN public.known_issues.confirmed_at IS
  'Hvornaar fejlen blev bekraeftet (#7666). Stemples af known_issues_stamp_status; NULL = ukendt eller ikke naaet.';
COMMENT ON COLUMN public.known_issues.fixing_at IS
  'Hvornaar rettelsen gik i gang (#7666). Stemples af known_issues_stamp_status; NULL = ukendt eller ikke naaet.';

CREATE OR REPLACE FUNCTION public.known_issues_stamp_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  -- Tilbage til "meldt": ingen senere trin gaelder.
  IF NEW.status = 'checking' THEN
    NEW.confirmed_at := NULL;
    NEW.fixing_at := NULL;
  ELSIF NEW.status = 'confirmed' THEN
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
    NEW.fixing_at := NULL;
  ELSIF NEW.status = 'fixing' THEN
    NEW.fixing_at := COALESCE(NEW.fixing_at, NOW());
  END IF;
  -- Lukket faar en dato; en genaabnet fejl mister sin gamle, saa en ny lukning
  -- ikke arver den.
  IF NEW.status IN ('fixed', 'dismissed') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, NOW());
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS known_issues_stamp_status ON public.known_issues;
CREATE TRIGGER known_issues_stamp_status
  BEFORE INSERT OR UPDATE OF status ON public.known_issues
  FOR EACH ROW EXECUTE FUNCTION public.known_issues_stamp_status();

-- Verifikation (read-only, efter apply):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'roadmap_items_horizon_check';
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'known_issues' AND column_name IN ('confirmed_at', 'fixing_at');
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.known_issues'::regclass AND NOT tgisinternal;

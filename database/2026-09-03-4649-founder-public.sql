-- #4649 · Offentligt Founder-maerke (Pro v1.1, ejer-valg 2/9)
--
-- Problem: subscriptions er RLS-lukket til laesning af egen raekke (spilleren
-- laeser kun sit eget abonnement). Founder-badget skal derimod vises til
-- ANDRE managere (stilling, holdside, forum) -- men subscriptions baerer
-- betalings-status/plan/id'er, som aldrig maa laekkes bredt.
--
-- Loesning: en SECURITY DEFINER-funktion der KUN eksponerer team_id +
-- foelgende-nummer (raekkefoelge efter subscriptions.created_at blandt
-- is_founder=true) -- ingen status, ingen plan, ingen Alunta-id'er. Funktion
-- (ikke et view) fordi raeknummerering kraever ROW_NUMBER() OVER(...), og en
-- SECURITY DEFINER-funktion holder samme "kun de to trygge felter"-kontrakt
-- som et view uden at aabne subscriptions-tabellen selv for PostgREST.
--
-- #1903's FOUNDER_SEAT_CAP = 50 (backend/lib/founderSeats.js) er loftet for
-- HVOR MANGE der optjener status -- denne funktion lister blot de der allerede
-- har den (kan i teorien vaere <=50, aldrig flere, jf. webhook-logikken).
--
-- Idempotent: CREATE OR REPLACE FUNCTION (uaendret signatur -> ACL bevares,
-- men vi re-GRANT'er alligevel for sikkerheds skyld).
--
-- Migration auto-applies i prod ved merge -- EJEREN merger PR'en (database/*.sql).
--
-- Rollback:
--   REVOKE EXECUTE ON FUNCTION public.founder_public_list() FROM anon, authenticated;
--   DROP FUNCTION IF EXISTS public.founder_public_list();

CREATE OR REPLACE FUNCTION public.founder_public_list()
RETURNS TABLE (team_id UUID, founder_number BIGINT)
  -- Forward-guard (#927): fast search_path, saa et evt. re-run ikke kan blive
  -- kapret af et andet schema tidligere i en session-lokal search_path.
  SET search_path = public
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
AS $$
  SELECT
    s.team_id,
    ROW_NUMBER() OVER (ORDER BY s.created_at ASC) AS founder_number
  FROM public.subscriptions s
  WHERE s.is_founder = true
  ORDER BY s.created_at ASC;
$$;

COMMENT ON FUNCTION public.founder_public_list() IS
  '#4649: offentligt Founder-maerke. Eksponerer KUN team_id + foelgende-nummer '
  '(raekkefoelge efter created_at blandt is_founder=true) -- aldrig status, plan '
  'eller Alunta-id''er. Kaldes af alle authenticated (stilling/holdside/forum).';

GRANT EXECUTE ON FUNCTION public.founder_public_list() TO authenticated;

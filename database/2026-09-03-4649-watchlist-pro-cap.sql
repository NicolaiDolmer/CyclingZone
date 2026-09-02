-- #4649 · Stoerre oenskeliste for Pro (Pro v1.1, ejer-valg 2/9)
--
-- Fund under implementeringen: der findes IKKE noget eksisterende loft paa
-- rider_watchlist i dag (grep "limit" mod backend/routes/api.js's watchlist-
-- kode og alle frontend insert-steder gav nul hits). Fire skaermbilleder
-- indsaetter direkte mod tabellen fra klienten (RidersPage, AuctionsPage,
-- RiderStatsPage, WatchlistPage) -- der er ingen enkelt "ruten der tilfoejer
-- til oensekelisten" at goere Pro-tjekket i, som opgaven ellers antog.
--
-- Loesning: haandhaev loftet i selve databasen (BEFORE INSERT-trigger paa
-- rider_watchlist), saa det gaelder ALLE fire indsaettelses-veje uden at
-- omskrive dem alle risikabelt i én PR. GET /api/watchlist/limit
-- (backend/lib/watchlistLimit.js) bruger isPro() til at vise "N of M" i UI'et
-- -- selve haandhaevelsen ligger her, saa den ikke kan omgaas ved at ramme
-- databasen direkte.
--
-- Grænser (ejer kan justere -- ingen eksisterende værdi at laase mod, jf.
-- fundet ovenfor): FRI = 20, PRO/FOUNDER = 100.
--
-- Pro-opslag i SQL spejler computeIsPro() (frontend/src/lib/proEntitlement.js +
-- backend/lib/entitlement.js): status IN (active, past_due) med periodeslut +
-- 3 dages respit, ELLER status=cancelled med periodeslut ikke overskredet
-- endnu, ELLER is_founder=true (permanent, uafhaengigt af status).
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS/CREATE TRIGGER.
--
-- Migration auto-applies i prod ved merge -- EJEREN merger PR'en (database/*.sql).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_rider_watchlist_cap ON public.rider_watchlist;
--   DROP FUNCTION IF EXISTS public.enforce_rider_watchlist_cap();

CREATE OR REPLACE FUNCTION public.enforce_rider_watchlist_cap()
  SET search_path = public
  LANGUAGE plpgsql
AS $$
DECLARE
  v_team_id UUID;
  v_is_pro BOOLEAN := false;
  v_cap INTEGER;
  v_count INTEGER;
BEGIN
  -- Pro-status afgoeres af BRUGERENS eget hold (rider_watchlist er
  -- brugerbundet, ikke holdbundet -- se riderInterest.js's kommentar om det
  -- samme). Ingen hold endnu (frisk onboarding) -> ikke Pro.
  SELECT t.id INTO v_team_id FROM public.teams t WHERE t.user_id = NEW.user_id LIMIT 1;

  IF v_team_id IS NOT NULL THEN
    SELECT
      (s.is_founder IS TRUE)
      OR (
        s.status IN ('active', 'past_due')
        AND s.current_period_end IS NOT NULL
        AND s.current_period_end + INTERVAL '3 days' > now()
      )
      OR (
        s.status = 'cancelled'
        AND s.current_period_end IS NOT NULL
        AND s.current_period_end > now()
      )
    INTO v_is_pro
    FROM public.subscriptions s
    WHERE s.team_id = v_team_id
    LIMIT 1;
  END IF;

  v_cap := CASE WHEN COALESCE(v_is_pro, false) THEN 100 ELSE 20 END;

  SELECT count(*) INTO v_count FROM public.rider_watchlist WHERE user_id = NEW.user_id;

  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'watchlist_limit_reached: cap % reached (% of %)', v_cap, v_count, v_cap
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rider_watchlist_cap ON public.rider_watchlist;
CREATE TRIGGER trg_rider_watchlist_cap
  BEFORE INSERT ON public.rider_watchlist
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rider_watchlist_cap();

COMMENT ON FUNCTION public.enforce_rider_watchlist_cap() IS
  '#4649: haandhaever oenskeliste-loft (fri=20, pro/founder=100) paa ALLE '
  'indsaettelser i rider_watchlist, uanset hvilken frontend-side der skriver.';

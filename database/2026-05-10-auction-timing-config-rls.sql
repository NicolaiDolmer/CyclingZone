-- AdminPage.jsx:209 reads auction_timing_config via supabase.from() i.e.
-- authenticated rolle. RLS var enabled men 0 policies = postgres
-- default-deny. Siden 2026-05-02 har AdminPage's auction-timing-config-form
-- vist tom/null state for alle admins i stedet for actual config.
-- Samme bug-mønster som slice 14 (#279).
--
-- Tabellens data (åbnings-timer, deadline-day-override, market-pause-level)
-- er auction-konfiguration uden følsom data — samme klasse som loan_config
-- og race_points der allerede er public-readable.

DROP POLICY IF EXISTS "auction_timing_config_select_authenticated" ON public.auction_timing_config;
CREATE POLICY "auction_timing_config_select_authenticated"
  ON public.auction_timing_config
  FOR SELECT
  TO authenticated
  USING (true);

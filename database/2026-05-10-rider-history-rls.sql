-- Slice 14 RLS-policy fix der blev anvendt manuelt 2026-05-10 (#279).
-- Denne fil committes så repo og prod ikke driver fra hinanden.
--
-- rider_uci_history + rider_stat_history blev oprettet via Supabase
-- Studio UI og fik aldrig committed migration. Studio auto-aktiverer RLS,
-- men opretter ingen policies — så authenticated frontend-reads i
-- RiderStatsPage's "Udvikling"-fane returnerede 0 rows i 14 dage selv om
-- service_role-skrivninger lykkes.

DROP POLICY IF EXISTS "rider_uci_history_select_authenticated" ON public.rider_uci_history;
CREATE POLICY "rider_uci_history_select_authenticated"
  ON public.rider_uci_history
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "rider_stat_history_select_authenticated" ON public.rider_stat_history;
CREATE POLICY "rider_stat_history_select_authenticated"
  ON public.rider_stat_history
  FOR SELECT
  TO authenticated
  USING (true);

-- #10/#197 follow-up: frontend skal kunne vise managerens eget auto-by-loft
-- uden at eksponere andre managers private max_amount.

ALTER TABLE public.auction_proxy_bids ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.auction_proxy_bids TO authenticated;

DROP POLICY IF EXISTS "Own proxy bids" ON public.auction_proxy_bids;

CREATE POLICY "Own proxy bids" ON public.auction_proxy_bids
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.teams
      WHERE teams.id = auction_proxy_bids.team_id
        AND teams.user_id = auth.uid()
    )
  );

-- #19 audit fix: distinct status for a buyout exercised while the window is
-- CLOSED. Previously a parked buyout reused 'window_pending' (the same status as
-- a parked loan-accept), which (a) double-counted the rider against the
-- borrower's squad cap — it is also parked via rider.pending_team_id — and
-- (b) forced the window-open flush to guess buyout-vs-loan from mutated rider
-- state. 'buyout_pending' makes the loan record self-describing.
--
-- Backfill: any existing window_pending loan whose rider is already parked to
-- the loan's to_team (pending_team_id = to_team_id) is in fact a parked buyout
-- and must be migrated to the new status so the flush classifies it correctly.

ALTER TABLE loan_agreements
  DROP CONSTRAINT IF EXISTS loan_agreements_status_check;

ALTER TABLE loan_agreements
  ADD CONSTRAINT loan_agreements_status_check
  CHECK (status IN ('pending','active','window_pending','buyout_pending','completed','rejected','cancelled','buyout'));

UPDATE loan_agreements la
SET status = 'buyout_pending', updated_at = NOW()
FROM riders r
WHERE la.status = 'window_pending'
  AND la.rider_id = r.id
  AND r.pending_team_id = la.to_team_id;

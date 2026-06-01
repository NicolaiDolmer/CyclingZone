-- #19 Del B: rider-loans can be agreed while the transfer window is closed.
-- Payments happen at agreement time; status window_pending means registration
-- is completed by POST /api/admin/transfer-window/open.

ALTER TABLE loan_agreements
  DROP CONSTRAINT IF EXISTS loan_agreements_status_check;

ALTER TABLE loan_agreements
  ADD CONSTRAINT loan_agreements_status_check
  CHECK (status IN ('pending','active','window_pending','completed','rejected','cancelled','buyout'));

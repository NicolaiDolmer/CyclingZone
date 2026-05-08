-- #203: is_test_account flag på teams til verifikations-infrastruktur.
--
-- Test-konti markeret med is_test_account=true udelukkes fra leaderboards,
-- standings, board-logik, beta-resets — så smoke-tests aldrig påvirker
-- ægte managers.
--
-- Anvendt i prod 2026-05-08 via Supabase MCP apply_migration.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_teams_is_test_account
  ON public.teams (is_test_account)
  WHERE is_test_account = TRUE;

COMMENT ON COLUMN public.teams.is_test_account IS
  'True for dedicated verification-infrastructure accounts (#203). Excluded from standings, leaderboards, board logic, beta resets. Real managers + AI accounts must remain false.';

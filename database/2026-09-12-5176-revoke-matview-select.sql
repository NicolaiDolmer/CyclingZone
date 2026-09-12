-- #5176: materialized-view access is served by the authenticated backend.
-- Idempotent: REVOKE/GRANT can be repeated. No rows, refresh functions or
-- materialized-view definitions change. PUBLIC is included to prevent an
-- inherited grant from defeating the explicit client-role revokes.
-- Auto-applied on merge. Codex does not execute this against production.

BEGIN;

REVOKE SELECT ON TABLE
  public.rider_rankings_mv,
  public.global_rank_mv,
  public.team_standings_ext_mv,
  public.team_race_points_mv
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.rider_rankings_mv,
  public.global_rank_mv,
  public.team_standings_ext_mv,
  public.team_race_points_mv
TO service_role;

COMMIT;

-- Claude post-merge verification (read-only, expect four f/f/t rows):
-- SELECT name,
--   has_table_privilege('anon', name, 'SELECT') AS anon_select,
--   has_table_privilege('authenticated', name, 'SELECT') AS authenticated_select,
--   has_table_privilege('service_role', name, 'SELECT') AS service_select
-- FROM unnest(ARRAY['public.rider_rankings_mv', 'public.global_rank_mv',
--   'public.team_standings_ext_mv', 'public.team_race_points_mv']) AS name;
-- Also check column-level access (expect f/f for every row):
-- SELECT name,
--   has_any_column_privilege('anon', name, 'SELECT') AS anon_column_select,
--   has_any_column_privilege('authenticated', name, 'SELECT') AS auth_column_select
-- FROM unnest(ARRAY['public.rider_rankings_mv', 'public.global_rank_mv',
--   'public.team_standings_ext_mv', 'public.team_race_points_mv']) AS name;
-- Then get_advisors(type: 'security'): expect 0016 count 0. The three 0029
-- function findings remain until separately addressed; do not report 0 WARN.
-- Verify all five /api/rankings endpoints with an authenticated session and
-- confirm the backend deployment containing rankings.ts is serving traffic.

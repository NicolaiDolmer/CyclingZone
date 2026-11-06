-- #7664: fjern planner-indstillingerne igen paa refresh_team_race_points_mv(boolean).
-- 2026-11-04-7664-team-race-points-mv.sql satte enable_mergejoin = off og work_mem = '32MB'.
-- I prod timede REFRESH ... CONCURRENTLY derefter ud efter 60 s hver gang (statement timeout),
-- mens de andre refresh-RPC'er lykkedes. Rollback er koert i prod 5/11 (ejer-go); denne
-- migration bringer repoet i overensstemmelse. Permanent loesning: #6765.
-- Idempotent: RESET paa en ikke-sat indstilling er en no-op. Den gamle migration roeres ikke.
-- Post-verify (proconfig skal kun indeholde search_path, ingen enable_mergejoin/work_mem):
--   SELECT proconfig FROM pg_proc WHERE oid = 'public.refresh_team_race_points_mv(boolean)'::regprocedure;

ALTER FUNCTION public.refresh_team_race_points_mv(boolean) RESET enable_mergejoin;
ALTER FUNCTION public.refresh_team_race_points_mv(boolean) RESET work_mem;

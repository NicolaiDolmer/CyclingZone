-- =============================================================================
-- 2026-07-19 — Hærd over-eksponerede SECURITY DEFINER-RPC'er (#2676)
-- =============================================================================
-- PROBLEM (Supabase security-advisor 0028 "Function ... has a role that can be
-- accessed by anon"): flere SECURITY DEFINER-funktioner var EXECUTE-bare af
-- `anon` og/eller `authenticated` via PostgREST (/rest/v1/rpc/<fn>), selvom
-- deres egne migrationer kun grantede service_role. Sandsynlig mekanisme (som i
-- #1971 29/6): Supabase' ALTER DEFAULT PRIVILEGES gen-granter EXECUTE til anon/
-- authenticated ved schema-restore/rebuild.
--
-- Mest alvorlig: `apply_global_rank_season_rollover(uuid)` — en write-RPC der
-- ubetinget kører `UPDATE teams SET banked_points = banked_points / 2` (season-
-- rollover halverer HELE ligaens banked_points). UPDATE'et er ubetinget: selv et
-- ikke-matchende season-uuid trigger stadig halveringen. En uautoriseret
-- PostgREST-kalder med den offentlige anon-apikey kunne dermed nulstille/forvride
-- alle holds banked_points. SECURITY DEFINER bypasser RLS, så row-policies
-- beskytter ikke.
--
-- HVAD DENNE MIGRATION GØR:
-- REVOKE-only på funktions-EXECUTE (ingen funktionsbody røres → global-rank-,
-- retention- og race-result-motorerne er urørte). `service_role` (backend cron +
-- seasonTransition, kaldt via service_role-klient) beholder EXECUTE overalt, så
-- rollover/snapshot/trigger-afvikling er uændret.
--
-- Matrix:
--   apply_global_rank_season_rollover(uuid)  → REVOKE anon, authenticated, PUBLIC (write-RPC: backend-only)
--   take_global_rank_weekly_snapshot()       → REVOKE anon, authenticated, PUBLIC (write-RPC: backend-only)
--   snapshot_race_result_rider_name()        → REVOKE anon, authenticated, PUBLIC (trigger-funktion: intet direkte kald)
--   snapshot_race_result_team_name()         → REVOKE anon, authenticated, PUBLIC (trigger-funktion: intet direkte kald)
--   get_retention_scorecard_activity(int)    → REVOKE anon (behold authenticated: body har is_admin()/service_role-guard)
--   is_admin()                               → GRANT anon (fixer 42501-støj; se nedenfor)
--
-- is_admin() → GRANT anon: modsat de øvrige. `is_admin()` kaldes fra riders-
-- SELECT-policyen "Public read riders" (2026-06-22-hide-intake-riders-from-db.sql),
-- så DEN manglende anon-EXECUTE (revoket 29/6 i #1971) producerer en løbende
-- "permission denied for function is_admin" (42501) fejlstrøm på enhver anon-
-- læsning af riders. is_admin() returnerer false for anon (auth.uid() er NULL) →
-- lækker intet + genopretter #2671 RLS-invarianten. Opskrift pre-blessed i
-- .claude/learnings/2026-07-18-anon-riders-select-fail-closed-42501.md.
--
-- Idempotent: REVOKE på et allerede-manglende privilegium er en no-op; GRANT på
-- et allerede-eksisterende ditto. Ingen rækker muteres (kun katalog-grants).
--
-- ROLLBACK (ikke anbefalet — gen-åbner sårbarheden):
--   GRANT EXECUTE ON FUNCTION public.apply_global_rank_season_rollover(uuid) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.take_global_rank_weekly_snapshot() TO anon, authenticated;
--   -- (m.fl. efter behov); REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
-- =============================================================================

BEGIN;

-- ── Write-RPC'er (global-rank): backend-only, service_role beholder EXECUTE ──
REVOKE EXECUTE ON FUNCTION public.apply_global_rank_season_rollover(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.take_global_rank_weekly_snapshot() FROM anon, authenticated, PUBLIC;

-- ── Trigger-funktioner (race-results): intet legitimt direkte kald ──────────
REVOKE EXECUTE ON FUNCTION public.snapshot_race_result_rider_name() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.snapshot_race_result_team_name() FROM anon, authenticated, PUBLIC;

-- ── Read-RPC: fjern kun anon (behold authenticated; body admin-gater selv) ──
REVOKE EXECUTE ON FUNCTION public.get_retention_scorecard_activity(int) FROM anon;

-- ── is_admin(): GRANT anon — fixer 42501 på riders-RLS-policy (se header) ───
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;

COMMIT;

-- PostgREST henter schema-cache på ny så grant-ændringerne slår igennem med det samme.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verifikation efter migration (forventet output)
-- =============================================================================
-- Kør efter apply for at bekræfte at REVOKE/GRANT landede (og senere: at det
-- HOLDER efter en evt. restore — gentag periodisk / efter reset-operationer):
--
--   SELECT p.proname,
--          pg_get_function_identity_arguments(p.oid) AS args,
--          (SELECT array_agg(grantee::text || '=' || privilege_type ORDER BY grantee::text)
--           FROM information_schema.routine_privileges rp
--           WHERE rp.specific_schema = 'public' AND rp.routine_name = p.proname) AS grants
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('apply_global_rank_season_rollover','take_global_rank_weekly_snapshot',
--                       'snapshot_race_result_rider_name','snapshot_race_result_team_name',
--                       'get_retention_scorecard_activity','is_admin')
--   ORDER BY p.proname;
--
-- Forventet:
--   apply_global_rank_season_rollover → {postgres=EXECUTE, service_role=EXECUTE}                 (INGEN anon/authenticated/PUBLIC)
--   take_global_rank_weekly_snapshot  → {postgres=EXECUTE, service_role=EXECUTE}                 (INGEN anon/authenticated/PUBLIC)
--   snapshot_race_result_rider_name   → {postgres=EXECUTE, service_role=EXECUTE}                 (INGEN anon/authenticated/PUBLIC)
--   snapshot_race_result_team_name    → {postgres=EXECUTE, service_role=EXECUTE}                 (INGEN anon/authenticated/PUBLIC)
--   get_retention_scorecard_activity  → {postgres=EXECUTE, authenticated=EXECUTE, service_role=EXECUTE}  (INGEN anon)
--   is_admin                          → {anon=EXECUTE, authenticated=EXECUTE, postgres=EXECUTE, service_role=EXECUTE}
-- =============================================================================

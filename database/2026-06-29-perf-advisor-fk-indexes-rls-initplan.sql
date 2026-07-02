-- =============================================================================
-- 2026-06-29 — Perf-advisor: FK-indexes (race hot path) + auth_rls_initplan (#1973)
-- =============================================================================
-- KILDE: Supabase performance-advisor 29/6 (projekt ghwvkxzhsbbltzfnuhhz).
--
-- DEL 1 — unindexed_foreign_keys (INFO): de race_*-hot-path-FK'er der manglede
-- et daekkende index. Verificeret mod live (pg_constraint vs pg_index 29/6):
-- race_entries.team_id, race_entries.rider_id og races.league_division_id var
-- de eneste race_*-FK'er uden ledende index (resten har allerede race_id-index).
-- De oevrige ~50 unindexed FK'er + al INFO paa backup-tabeller er BEVIDST ude af
-- scope (lille population, lav prioritet — #1973 task 4; backups droppes i #1972).
--
-- DEL 2 — auth_rls_initplan (WARN): 4 SELECT-policies re-evaluerede auth.uid()
-- pr. row. Wrap i scalar-subquery (select auth.uid()) saa den evalueres ÉN gang
-- pr. query. SEMANTISK IDENTISK — samme bruger, samme adgang, kun query-plan-
-- perf. Policy-qual verificeret mod live (pg_policies 29/6): alle 4 har identisk
-- form `team_id IN (SELECT id FROM teams WHERE user_id = auth.uid())`.
--
-- IKKE i denne migration: multiple_permissive_policies (20). RLS-konsolidering
-- kraever per-tabel-analyse (hvilken policy beholdes) for ikke at regressere
-- adgang — behandles som separat, omhyggelig PR.
--
-- IDEMPOTENT: CREATE INDEX IF NOT EXISTS + ALTER POLICY (re-run = no-op).
-- Refs #1973.
-- =============================================================================

-- DEL 1 — race-hot-path FK-indexes -------------------------------------------
CREATE INDEX IF NOT EXISTS idx_race_entries_team_id
  ON public.race_entries (team_id);

CREATE INDEX IF NOT EXISTS idx_race_entries_rider_id
  ON public.race_entries (rider_id);

CREATE INDEX IF NOT EXISTS idx_races_league_division_id
  ON public.races (league_division_id);

-- DEL 2 — auth_rls_initplan: wrap auth.uid() i scalar-subquery ----------------
ALTER POLICY academy_graduation_owner_read ON public.academy_graduation
  USING (team_id IN (
    SELECT teams.id FROM teams WHERE teams.user_id = (SELECT auth.uid())
  ));

ALTER POLICY sponsor_contracts_select_own ON public.sponsor_contracts
  USING (team_id IN (
    SELECT teams.id FROM teams WHERE teams.user_id = (SELECT auth.uid())
  ));

ALTER POLICY team_race_strategy_select_own ON public.team_race_strategy
  USING (team_id IN (
    SELECT teams.id FROM teams WHERE teams.user_id = (SELECT auth.uid())
  ));

ALTER POLICY team_rider_role_rules_select_own ON public.team_rider_role_rules
  USING (team_id IN (
    SELECT teams.id FROM teams WHERE teams.user_id = (SELECT auth.uid())
  ));

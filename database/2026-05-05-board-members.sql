-- S-02c · Navngivne board-members
-- Master roadmap: docs/slices/02-board-redesign-MASTER.md
--
-- Tilføjer:
--   1. team_board_members — 5 medlemmer pr. human team (3 identity-matched + 2 non-conflicting wildcards).
--      Tildelt ved sæson-1-slut i startSequentialNegotiation, samtidig med season_1_identity_basis.
--   2. teams.consecutive_low_satisfaction_expirations — per-team counter til replacement-trigger
--      (2× plan-udløb i træk under 30% tilfredshed → ny formand).
--
-- Q-bekræftelser (2026-05-05 session):
--   A1=5 medlemmer fast, A2=3 identity + 2 non-conflicting wildcards, A3=tildelt ved sæson-1-slut,
--   A6=chairman taler ved tvivl, A7=udskift 1 medlem (formanden), A8=per-team counter.
--
-- AI/bank/frozen teams får IKKE members (Q-batch 1A Q8 — manager-only).

BEGIN;

CREATE TABLE IF NOT EXISTS team_board_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  archetype_key TEXT NOT NULL,
  selection_kind TEXT NOT NULL CHECK (selection_kind IN ('identity', 'wildcard')),
  alignment_score INTEGER NOT NULL DEFAULT 0,
  is_chairman BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, archetype_key)
);

CREATE INDEX IF NOT EXISTS idx_team_board_members_team_id
  ON team_board_members(team_id);

CREATE INDEX IF NOT EXISTS idx_team_board_members_chairman
  ON team_board_members(team_id) WHERE is_chairman = TRUE;

COMMENT ON TABLE team_board_members IS
  'S-02c: 5 board-medlemmer pr. human team. Tildelt ved sæson-1-slut. selection_kind: identity (top-3 matchet til identity_basis) eller wildcard (2 ekstra valgt non-conflicting). is_chairman = højeste alignment_score, taler ved tvivl + er den der udskiftes ved replacement-trigger.';

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS consecutive_low_satisfaction_expirations INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN teams.consecutive_low_satisfaction_expirations IS
  'S-02c: Per-team counter for board-formand-replacement. Increment ved plan-udløb med satisfaction<30, reset til 0 ved plan-udløb med satisfaction>=30, trigger replacement når =2.';

COMMIT;

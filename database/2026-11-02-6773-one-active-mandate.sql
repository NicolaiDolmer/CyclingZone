-- #6773: a team can hold at most one active board mandate. The season change
-- now closes ended seasons' mandates for every team (closeEndedSeasonMandatesForAllTeams),
-- and a returning team gets its mandate through ensureMandateForReturningTeam;
-- this index makes the database refuse a second active row whatever the code path.
--
-- Measured 2026-11-02 (read-only): 0 teams have more than one active mandate,
-- so the index builds without touching data. board_mandates has ~700 rows, so a
-- plain (non-concurrent) build is instant. Replaying this file is a no-op.

create unique index if not exists board_mandates_one_active_per_team
  on public.board_mandates (team_id)
  where status = 'active';

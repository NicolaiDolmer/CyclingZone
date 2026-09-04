-- #4485 — BACKUP-TABELLER FOR REPARATION AF UNGDOMSKLASSEMENTET (young/young_day, S3).
--
-- Opretter KUN tomme tabeller. Selve reparationen (delete+re-insert af young/
-- young_day-raekker, penge begge veje, standings-recompute) sker fra
-- `backend/scripts/repair-4485-young-classification.js --apply`, ikke herfra —
-- samme arbejdsdeling som #4576 (`2026-09-03-4576-academy-intake-backup-table.sql`):
-- DDL i en fil der kan reviewes, dataflytning i et script der kan toerkoeres og
-- verificeres. Fuld metode + maalte tal: docs/audits/4485-genberegning-forslag-
-- 2026-09-04.md og docs/audits/4485-dry-run-2026-09-04.md.
--
-- HVAD DEN DAEKKER (ejer-beslutning 4/9 paa #4485: U25 = 25 og yngre bekraeftet,
-- penge rettes BEGGE veje):
--   1) race_results — foer-billedet af de young/young_day-raekker der bliver
--      slettet+genopbygget (fuld raekke, ikke kun de aendrede felter).
--   2) season_standings — foer-billedet af sæson 3's standings-raekker foer
--      updateStandings() genafleder dem fra de rettede race_results.
--   3) teams — foer-balancen for hvert hold der faar en kredit/debit via
--      incrementBalanceWithAudit/debitTeam (selve transaktionen er allerede
--      revisions-sikret i finance_transactions; denne tabel er et hurtigt
--      rollback-anker uden at skulle rekonstruere balance fra ledger-summen).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS. Sikker at koere igen.
-- IKKE DESTRUKTIV: opretter kun; roerer ingen eksisterende data.

CREATE TABLE IF NOT EXISTS public.backup_4485_race_results_20260904 (
  id             uuid        PRIMARY KEY,
  race_id        uuid,
  stage_number   integer,
  result_type    text,
  rank           integer,
  rider_id       uuid,
  team_id        uuid,
  team_name      text,
  points_earned  integer,
  prize_money    bigint,
  captured_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.backup_4485_race_results_20260904 IS
  'FOER-billede af de race_results young/young_day-raekker #4485-reparationen erstatter (forkert U25-klassificering, sæson 3). Fyldes af backend/scripts/repair-4485-young-classification.js. Kan slettes naar reparationen er verificeret stabil.';

CREATE TABLE IF NOT EXISTS public.backup_4485_season_standings_20260904 (
  season_id           uuid        NOT NULL,
  team_id             uuid        NOT NULL,
  division            integer,
  league_division_id  uuid,
  total_points        integer,
  penalty_points      integer,
  rank_in_division    integer,
  captured_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, team_id)
);

COMMENT ON TABLE public.backup_4485_season_standings_20260904 IS
  'FOER-billede af sæson 3s season_standings-raekker, taget lige foer #4485-reparationens updateStandings()-kald genafleder dem fra de rettede race_results.';

CREATE TABLE IF NOT EXISTS public.backup_4485_teams_balance_20260904 (
  team_id         uuid        PRIMARY KEY,
  balance_before  bigint,
  captured_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.backup_4485_teams_balance_20260904 IS
  'FOER-balance for hvert hold der faar en #4485-korrektion (kredit eller tilbagefoersel). Selve transaktionen er revisions-sikret i finance_transactions (reason_code race_prize_correction_credit/clawback) — denne tabel er et hurtigt rollback-anker.';

ALTER TABLE public.backup_4485_race_results_20260904 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_4485_season_standings_20260904 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_4485_teams_balance_20260904 ENABLE ROW LEVEL SECURITY;

-- ── POST-VERIFY efter apply ─────────────────────────────────────────────────
--   SELECT count(*) FROM public.backup_4485_race_results_20260904;
--   -- skal matche summen af young+young_day-raekker foer reparationen
--   -- (rapporteret af scriptet: youngRowsBefore + youngDayRowsBefore).
--
--   SELECT count(*) FROM public.backup_4485_teams_balance_20260904;
--   -- skal matche antallet af hold med et faktisk CZ$-delta (report.teamsAffected).

-- ── ROLLBACK (kun hvis noedvendigt — foer race_results, saa standings/balance) ──
--   BEGIN;
--   DELETE FROM public.race_results
--     WHERE result_type IN ('young','young_day')
--       AND race_id IN (
--         SELECT DISTINCT race_id FROM public.backup_4485_race_results_20260904
--       );
--   INSERT INTO public.race_results
--     (id, race_id, stage_number, result_type, rank, rider_id, team_id, team_name, points_earned, prize_money)
--     SELECT id, race_id, stage_number, result_type, rank, rider_id, team_id, team_name, points_earned, prize_money
--     FROM public.backup_4485_race_results_20260904;
--   UPDATE public.season_standings s
--      SET division = b.division, league_division_id = b.league_division_id,
--          total_points = b.total_points, penalty_points = b.penalty_points,
--          rank_in_division = b.rank_in_division
--     FROM public.backup_4485_season_standings_20260904 b
--    WHERE b.season_id = s.season_id AND b.team_id = s.team_id;
--   -- Balance: brug incrementBalanceWithAudit(teamId, balance_before - nuvaerende_balance, ...)
--   -- pr. hold, ALDRIG en direkte UPDATE teams.balance (mister finance_transactions-sporet).
--   COMMIT;

-- ── OPRYDNING (efter ejer-go, naar reparationen er verificeret stabil) ───────
--   DROP TABLE public.backup_4485_race_results_20260904;
--   DROP TABLE public.backup_4485_season_standings_20260904;
--   DROP TABLE public.backup_4485_teams_balance_20260904;

-- Refs #4485

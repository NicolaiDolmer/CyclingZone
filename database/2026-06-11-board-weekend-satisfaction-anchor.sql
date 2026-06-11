-- #1187 · Løbende bestyrelses-tilfredshed (weekend-target-tracking, PR #1265-mekanikken).
-- =====================================================================================
-- Weekend-opdateringen (boardWeekendUpdate.computeWeekendSatisfactionUpdate) target-
-- tracker mod evaluateBoardSeason: target = sæson-START-satisfaction + sæson-delta.
-- Fra weekend 2 og frem SKAL ankeret (sæson-start-værdien) gives eksplicit — ellers
-- driver tallet ubegrænset (delta lægges oveni den allerede-flyttede værdi hver
-- weekend). Ankeret persisteres derfor pr. board sammen med hvilken sæson det
-- gælder for; sæson-skift selv-healer (season-id-mismatch → re-anker ved første
-- weekend i den nye sæson).
--
-- Sæson-slut-evalueringen (processTeamSeasonEnd) læser samme anker, så slut-
-- resultatet = anker + delta — præcis hvad dagens evaluering ville give. Uden
-- ankeret ville sæson-slut dobbelt-anvende deltaet oven i den konvergerede værdi.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE board_profiles
  ADD COLUMN IF NOT EXISTS season_start_satisfaction INTEGER,
  ADD COLUMN IF NOT EXISTS season_start_anchor_season_id UUID REFERENCES seasons(id);

COMMENT ON COLUMN board_profiles.season_start_satisfaction IS
  '#1187: satisfaction ved sæson-start — anker for weekend-target-tracking. NULL = ingen weekend-opdatering kørt endnu i ankersæsonen.';
COMMENT ON COLUMN board_profiles.season_start_anchor_season_id IS
  '#1187: sæsonen som season_start_satisfaction gælder for. Mismatch mod aktiv sæson → re-anker ved næste weekend-finalization.';

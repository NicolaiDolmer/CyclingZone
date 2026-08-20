// #3915 — pure helpers for the dashboard's "Today's stages" strip. No React,
// no I/O, so `node --test` can load the module directly (same discipline as
// raceHubLogic.js/raceCentre.js).
//
// GENBRUG (ingen ny data-logik):
//   - terrainGlyphBucket wraps stageTerrain.js's already-shipped, backend-
//     parity-tested terrainBucket() — same 5-bucket simplification the app
//     already ships elsewhere (roleHint.js reuses it as-is) — just renamed to
//     match TerrainGlyph's calendar vocabulary (flat -> sprint).
//   - computeStageRaceStanding wraps raceLiveStandings.js's
//     deriveTeamStandings — the SAME per-day team classification
//     RaceDetailPage already derives for an ongoing stage race's "Overall"
//     tab — instead of re-deriving GC time/gaps from scratch.

import { terrainBucket } from "./stageTerrain.js";
import { deriveTeamStandings } from "./raceLiveStandings.js";

// Mini profile silhouette bucket for TerrainGlyph (calendar's 6-name
// vocabulary: sprint/cobbles/hilly/mountain/itt/ttt). stageTerrain.js's
// terrainBucket already folds itt+ttt into "itt" (an existing, shipped
// simplification) — we only rename its "flat" to TerrainGlyph's "sprint" key.
export function terrainGlyphBucket(profileType) {
  const bucket = terrainBucket(profileType);
  return bucket === "flat" ? "sprint" : bucket;
}

// Team's current overall position for a stage race "i dag"-panel (#3915).
// `rows` = race_results rows for ONE race, result_type in ('leader','team').
// Two honest sources, in the order the data actually becomes available
// during a race:
//   1. result_type='team' — the DEFINITIVE team classification, written once
//      at the race's final stage.
//   2. result_type='leader' — the day's full GC snapshot (rank 1..N, written
//      every stage since #2081); deriveTeamStandings turns that into a
//      provisional team ranking, the same derivation RaceDetailPage already
//      uses for an ongoing race's live "Overall" tab. A single rank-1 jersey
//      row (pre-#2081 legacy stage, or day 1 before the full snapshot lands)
//      can't derive a standing.
// Returns { rank, total, final } or null (no snapshot exists yet).
export function computeStageRaceStanding(rows, teamId) {
  if (!Array.isArray(rows) || teamId == null) return null;

  const teamRows = rows.filter((r) => r.result_type === "team");
  if (teamRows.length) {
    const maxStage = Math.max(...teamRows.map((r) => r.stage_number ?? 1));
    const finalRows = teamRows.filter((r) => (r.stage_number ?? 1) === maxStage);
    const mine = finalRows.find((r) => r.team_id === teamId);
    return mine ? { rank: mine.rank, total: finalRows.length, final: true } : null;
  }

  const leaderRows = rows.filter((r) => r.result_type === "leader");
  if (!leaderRows.length) return null;
  const maxStage = Math.max(...leaderRows.map((r) => r.stage_number ?? 1));
  const dayRows = leaderRows.filter((r) => (r.stage_number ?? 1) === maxStage);
  // A single rank-1 jersey row (not yet a full field snapshot) can't derive a
  // team standing — same gate as raceLiveStandings.js's buildLiveStandings.
  if (dayRows.length <= 1) return null;
  const teamStandings = deriveTeamStandings(dayRows);
  const mine = teamStandings.find((r) => r.team_id === teamId);
  return mine ? { rank: mine.rank, total: teamStandings.length, final: false } : null;
}

// Today's stage winner (rank 1, result_type='stage') for one (raceId,
// stageNumber) slot — the "vindernavn når færdig" status line. `rows` =
// race_results rows for however many of today's own races were fetched
// (already bounded upstream). null = results have not landed yet.
export function todayStageWinner(rows, raceId, stageNumber) {
  if (!Array.isArray(rows)) return null;
  const row = rows.find((r) => r.race_id === raceId && (r.stage_number ?? 1) === stageNumber
    && r.result_type === "stage" && r.rank === 1);
  return row ? row.rider_name : null;
}

// How many riders (any team) are entered in a one-day race today — the
// "ellers antal ryttere tilmeldt" branch of the mockup contract. `rows` =
// race_entries rows (already bounded to today's own one-day races upstream).
export function entryCountFor(rows, raceId) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => r.race_id === raceId).length;
}

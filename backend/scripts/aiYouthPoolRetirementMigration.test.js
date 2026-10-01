import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../../database/2026-09-28-4753-youth-pool-retirement-replacement.sql", import.meta.url), "utf8");

test("#4753 retirement replaces youth group members inside the retiring update transaction", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.replace_retired_ai_youth_group/);
  assert.match(sql, /AFTER UPDATE OF retired_at ON public\.teams/);
  assert.match(sql, /PERFORM public\.replace_retired_ai_youth_group\(NEW\.id, NEW\.retired_at\)/);
  assert.match(sql, /FOR UPDATE OF t SKIP LOCKED/);
  assert.match(sql, /RAISE EXCEPTION 'no_safe_youth_replacement'/);
  assert.match(sql, /UPDATE public\.teams SET u23_league_division_id=NULL,junior_league_division_id=NULL/);
  assert.match(sql, /UPDATE public\.teams SET u23_league_division_id=target_u23,junior_league_division_id=target_junior/);
});

test("#4753 replacement excludes unavailable AI and cannot steal youth race entries", () => {
  assert.match(sql, /t\.pending_removal_at IS NULL/);
  assert.match(sql, /t\.u23_league_division_id IS NULL AND t\.junior_league_division_id IS NULL/);
  assert.match(sql, /r\.squad='u23'/);
  assert.match(sql, /r\.squad='junior'/);
  assert.match(sql, /e\.team_id=t\.id OR e\.rider_id IN/);
  assert.match(sql, /AND x\.squad IN \('u23','junior'\)/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.replace_retired_ai_youth_group\(uuid\) TO service_role/);
});

test("#4753 reserve readiness mirrors injury and pending-transfer entry gates with explicit time", () => {
  assert.match(sql, /r\.pending_team_id IS NULL/);
  assert.match(sql, /c\.injured_until >= \(p_now AT TIME ZONE 'Europe\/Copenhagen'\)::date/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.replace_retired_ai_youth_group\(uuid,timestamptz\) FROM PUBLIC,anon,authenticated/);
});

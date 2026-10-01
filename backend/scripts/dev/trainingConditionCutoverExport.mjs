// #5928: READ-ONLY export of a fresh cutover input for trainingConditionCutoverDryRun.mjs.
// Never mutates. Output contains private rider data: write it OUTSIDE the repo.
// Usage (repo root): infisical run --env=prod -- node backend/scripts/dev/trainingConditionCutoverExport.mjs <date> <season_id> <out.private.json> [season-reset-proof.private.json|-] [yesterday-corrections.private.json]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";
import { copenhagenHourToUTC } from "../../lib/copenhagenTime.js";

const [date, seasonId, outPath, proofPath] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !seasonId || !outPath) {
  throw new Error("Usage: <date> <season_id> <out.private.json> [season-reset-proof.private.json]");
}
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_KEY required (infisical run --env=prod)");
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const nextDate = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const prevDate = (d) => new Date(Date.parse(`${d}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
const start = copenhagenHourToUTC(date, 0).toISOString();
const end = copenhagenHourToUTC(nextDate(date), 0).toISOString();
const yesterday = prevDate(date);

// 1) The date's canonical stages in this season, and their immutable runs.
const schedule = await fetchAllRows(() => sb.from("race_stage_schedule")
  .select("race_id,stage_number,scheduled_at,game_day,races!inner(season_id)")
  .eq("races.season_id", seasonId).gte("scheduled_at", start).lt("scheduled_at", end)
  .order("race_id").order("stage_number"));
const raceIds = [...new Set(schedule.map((s) => s.race_id))];
const runsRaw = await fetchAllRowsChunkedIn(raceIds, (chunk) => sb.from("race_simulation_runs")
  .select("race_id,stage_number,created_at,entrant_snapshot").in("race_id", chunk).order("race_id").order("stage_number"));
const profiles = await fetchAllRowsChunkedIn(raceIds, (chunk) => sb.from("race_stage_profiles")
  .select("race_id,stage_number,profile_type").in("race_id", chunk).order("race_id").order("stage_number"));
const key = (r) => `${r.race_id}:${r.stage_number}`;
const schedByKey = new Map(schedule.map((s) => [key(s), s]));
const profByKey = new Map(profiles.map((p) => [key(p), p]));
const runs = runsRaw.filter((r) => schedByKey.has(key(r))).map((r) => ({
  race_id: r.race_id, season_id: seasonId, created_at: r.created_at,
  profile_type: profByKey.get(key(r))?.profile_type ?? null,
  scheduled_at: schedByKey.get(key(r)).scheduled_at, stage_number: r.stage_number,
  entrant_snapshot: r.entrant_snapshot,
}));
const unrun = schedule.filter((s) => !runs.some((r) => key(r) === key(s)));

// 2) Effort inputs for exactly those stages.
const roles = (await fetchAllRowsChunkedIn(raceIds, (chunk) => sb.from("race_stage_roles")
  .select("race_id,stage_number,rider_id,race_role,effort,updated_at").in("race_id", chunk)
  .order("race_id").order("stage_number").order("rider_id"))).filter((r) => schedByKey.has(key(r)));
const orders = (await fetchAllRowsChunkedIn(raceIds, (chunk) => sb.from("race_team_orders")
  .select("team_id,race_id,stage_number,breakaway_stance,riders,locked_at,created_at,updated_at").in("race_id", chunk)
  .order("race_id").order("stage_number").order("team_id"))).filter((r) => schedByKey.has(key(r)));

// 3) Starters, their current condition (CAS) and yesterday's final report.
const starters = [...new Set(runs.flatMap((r) => (r.entrant_snapshot ?? []).map((e) => (typeof e === "string" ? e : e?.rider_id))))];
const current = await fetchAllRowsChunkedIn(starters, (chunk) => sb.from("rider_condition")
  .select("rider_id,form,fatigue").in("rider_id", chunk).order("rider_id"));
const curById = new Map(current.map((c) => [c.rider_id, c]));
const yRuns = await fetchAllRows(() => sb.from("training_day_runs")
  .select("id,game_day,report").eq("tick_date", yesterday).order("id"));
const last = new Map();
for (const run of yRuns) {
  for (const rr of run.report?.riders ?? []) {
    const prev = last.get(rr.rider_id);
    if (!prev || Number(run.game_day ?? -1) > prev.game_day) {
      last.set(rr.rider_id, { id: run.id, game_day: Number(run.game_day ?? -1), form: Number(rr.form), fatigue: Number(rr.fatigue) });
    }
  }
}
const riders = await fetchAllRowsChunkedIn(starters, (chunk) => sb.from("riders")
  .select("id,created_at,team_id").in("id", chunk).order("id"));
const riderById = new Map(riders.map((r) => [r.id, r]));
const openings = starters.map((id) => {
  const y = last.get(id);
  const c = curById.get(id);
  return {
    rider_id: id,
    source: y ? y.id : null, source_date: y ? yesterday : null,
    opening_form: y ? y.form : null, opening_fatigue: y ? y.fatigue : null,
    expected_form: c ? c.form : null, expected_fatigue: c ? c.fatigue : null,
  };
});
const missing = openings.filter((o) => !o.source).map((o) => ({
  rider_id: o.rider_id, created_at: riderById.get(o.rider_id)?.created_at ?? null,
  expected_form: o.expected_form, expected_fatigue: o.expected_fatigue,
}));

// Optional yesterday correction: CAS values for corrected riders who did NOT start today.
const correctionsPath = process.argv[6];
let corrections, extraOpenings = [];
if (correctionsPath) {
  corrections = JSON.parse(fs.readFileSync(correctionsPath, "utf8")).corrections;
  const starterSet = new Set(starters);
  const others = Object.keys(corrections).filter((id) => !starterSet.has(id));
  const cur = await fetchAllRowsChunkedIn(others, (chunk) => sb.from("rider_condition")
    .select("rider_id,form,fatigue").in("rider_id", chunk).order("rider_id"));
  extraOpenings = cur.map((c) => ({ rider_id: c.rider_id, expected_form: c.form, expected_fatigue: c.fatigue }));
}

const { count: trainingRuns, error: trErr } = await sb.from("training_day_runs")
  .select("id", { count: "exact", head: true }).eq("tick_date", date);
if (trErr) throw trErr;
const seasonResetProof = proofPath && proofPath !== "-" ? JSON.parse(fs.readFileSync(proofPath, "utf8")) : undefined;

const out = { date, captured_at: new Date().toISOString(), training_runs: trainingRuns ?? 0,
  runs, roles, orders, openings, ...(seasonResetProof ? { seasonResetProof } : {}),
  ...(corrections ? { corrections, extra_openings: extraOpenings } : {}),
  _missing_openings: missing, _unrun_stages: unrun };
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ date, stages: schedule.length, runs: runs.length, unrun: unrun.length, starters: starters.length,
  missing_openings: missing.length, no_current_condition: openings.filter((o) => o.expected_form == null).length,
  training_runs: trainingRuns ?? 0, roles: roles.length, orders: orders.length }));

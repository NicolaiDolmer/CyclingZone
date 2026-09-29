// #5952 — Regn holdklassementet om for den aktive sæsons løb med UCI-tiebreaket.
//
// Baggrund: teamClassification brød lige tid på team_id (reelt alfabetisk), og
// v4 giver hele feltet samme tid ved massespurt. Rettelsen i
// raceClassifications.js gælder fremad; dette script retter de allerede skrevne
// hold-rækker ('team' og 'team_day') i sæsonens løb (ejer-valg 29/9: holdklasse-
// mentet regnes om, point fra passager står).
//
// SIKKERHED
//  - DRY-RUN er default. Intet skrives uden --apply.
//  - Baseline-vagt: for hvert løb genskabes FØRST den gamle rangering (uden
//    tiebreak) fra de gemte rækker. Matcher den ikke de gemte placeringer 1:1,
//    er rekonstruktionen ikke til at stole på, og løbet markeres og røres ALDRIG.
//  - Udbetalte løb (races.prize_paid_at != null) røres ALDRIG af --apply: deres
//    præmier er bogført i finance_transactions. De listes med beløb, så ejeren
//    kan beslutte en særskilt korrektion.
//  - --apply ændrer kun rank/points_earned/prize_money på eksisterende
//    hold-rækker (ingen inserts/deletes) og kræver ejerens "kør".
//
// Brug (fra backend/):
//   infisical run --env=prod -- node scripts/recompute-5952-team-classification.js            # dry-run
//   infisical run --env=prod -- node scripts/recompute-5952-team-classification.js --json     # dry-run, JSON
//   infisical run --env=prod -- node scripts/recompute-5952-team-classification.js --apply    # kun efter ejer-go

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import {
  accumulateStageRows,
  dailyTeamPlacesFromStageRows,
  filterCompletedEntrants,
  parseGapSeconds,
  rankByCumTimeAsc,
  teamClassification,
} from "../lib/raceClassifications.js";
import { buildRacePointsLookup, prizeMoneyForPoints } from "../lib/raceResultsEngine.js";

const TEAM_TYPES = new Set(["team", "team_day"]);

function sameOrder(stored, rebuilt) {
  if (stored.length !== rebuilt.length) return false;
  const rankByTeam = new Map(stored.map((r) => [r.team_id, r.rank]));
  return rebuilt.every((r) => rankByTeam.get(r.team_id) === r.rank);
}

/**
 * Ren kerne: givet ét løbs rækker, returnér hvilke hold-rækker der skal flyttes.
 *
 * @param {{ race: object, results: object[], profileTypeByStage: Map<number,string>, pointsLookup: object }} args
 * @returns {{ status: "ok"|"baseline_mismatch"|"no_team_rows", groups: number, changes: object[], mismatches: object[] }}
 */
export function recomputeTeamRowsForRace({ race, results, profileTypeByStage = new Map(), pointsLookup = {} }) {
  const teamRows = results.filter((r) => TEAM_TYPES.has(r.result_type));
  if (!teamRows.length) return { status: "no_team_rows", groups: 0, changes: [], mismatches: [] };

  // Grupper: én pr. (result_type, stage_number).
  const groups = new Map();
  for (const r of teamRows) {
    const key = `${r.result_type}:${r.stage_number ?? 1}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const changes = [];
  const mismatches = [];
  for (const [key, stored] of groups) {
    const [resultType, stageStr] = key.split(":");
    const stageNumber = Number(stageStr);
    let entrants;
    let time;
    let tiebreak;
    if (race.race_type !== "stage_race") {
      // Endagsløb: holdklassementet er regnet af GC-rækkerne (= målrækkefølgen).
      const gcRows = results.filter((r) => r.result_type === "gc" && (r.stage_number ?? 1) === stageNumber && r.rider_id);
      entrants = gcRows.map((r) => ({ rider_id: r.rider_id, team_id: r.team_id }));
      time = new Map(gcRows.map((r) => [r.rider_id, parseGapSeconds(r.finish_time)]));
      tiebreak = { mode: "stage", placeByRider: new Map(gcRows.map((r) => [r.rider_id, r.rank])) };
    } else {
      // Etapeløb: samme akkumulering som raceRunner.buildStageRowsAccumulated,
      // af etaperækkerne til og med denne etape.
      const stageRows = results.filter((r) => r.result_type === "stage" && r.rider_id && (r.stage_number ?? 1) <= stageNumber);
      const acc = accumulateStageRows({ stageRows, profileTypeByStage });
      const teamOf = new Map();
      for (const r of stageRows) teamOf.set(r.rider_id, r.team_id);
      const all = [...teamOf.entries()].map(([rider_id, team_id]) => ({ rider_id, team_id }));
      entrants = filterCompletedEntrants(all, acc.stagesByRider, acc.stageNumbers);
      time = acc.cumTime;
      const gc = rankByCumTimeAsc(entrants, acc.cumTime, acc.posSum);
      tiebreak = {
        mode: "overall",
        placeByRider: new Map(gc.map((g) => [g.rider_id, g.rank])),
        dailyPlacesByTeam: dailyTeamPlacesFromStageRows(stageRows),
      };
    }

    // Baseline-vagt: den gamle regel skal genskabe de gemte placeringer 1:1.
    const oldRule = teamClassification(entrants, time);
    if (!sameOrder(stored, oldRule)) {
      mismatches.push({ result_type: resultType, stage_number: stageNumber, stored: stored.length, rebuilt: oldRule.length });
      continue;
    }
    const newRule = teamClassification(entrants, time, tiebreak);
    const newRankByTeam = new Map(newRule.map((r) => [r.team_id, r.rank]));
    for (const row of stored) {
      const newRank = newRankByTeam.get(row.team_id);
      if (newRank == null || newRank === row.rank) continue;
      const newPoints = pointsLookup[`${resultType}__${newRank}`] || 0;
      changes.push({
        id: row.id,
        result_type: resultType,
        stage_number: stageNumber,
        team_id: row.team_id,
        team_name: row.team_name,
        old_rank: row.rank,
        new_rank: newRank,
        old_points: Number(row.points_earned) || 0,
        new_points: newPoints,
        old_prize: Number(row.prize_money) || 0,
        new_prize: prizeMoneyForPoints(newPoints, race),
      });
    }
  }
  return {
    status: mismatches.length ? "baseline_mismatch" : "ok",
    groups: groups.size,
    changes,
    mismatches,
  };
}

async function loadSeasonData(supabase) {
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  if (!season) return { season: null, races: [] };

  const races = await fetchAllRows(() => supabase.from("races")
    .select("id, name, race_type, race_class, prize_paid_at, squad, stages_completed, status")
    .eq("season_id", season.id)
    .gt("stages_completed", 0)
    .order("id"));
  const raceIds = races.map((r) => r.id);
  const results = raceIds.length ? await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase.from("race_results")
      .select("id, race_id, stage_number, result_type, rank, rider_id, team_id, team_name, finish_time, points_earned, prize_money, sprint_points, kom_points, bonus_seconds")
      .in("race_id", chunk)
      .in("result_type", ["stage", "gc", "team", "team_day"])
      .order("id"), { chunkSize: 20 }) : [];
  const profiles = raceIds.length ? await fetchAllRowsChunkedIn(raceIds, (chunk) =>
    supabase.from("race_stage_profiles").select("race_id, stage_number, profile_type").in("race_id", chunk).order("id")) : [];
  const racePoints = await fetchAllRows(() => supabase.from("race_points").select("race_class, result_type, rank, points").order("race_class"));
  return { season, races, results, profiles, racePoints };
}

export function buildReport({ races, results, profiles, racePoints }) {
  const resultsByRace = new Map();
  for (const r of results) {
    if (!resultsByRace.has(r.race_id)) resultsByRace.set(r.race_id, []);
    resultsByRace.get(r.race_id).push(r);
  }
  const profilesByRace = new Map();
  for (const p of profiles) {
    if (!profilesByRace.has(p.race_id)) profilesByRace.set(p.race_id, new Map());
    profilesByRace.get(p.race_id).set(p.stage_number || 1, p.profile_type);
  }
  const pointsByClass = new Map();
  for (const p of racePoints) {
    if (!pointsByClass.has(p.race_class)) pointsByClass.set(p.race_class, []);
    pointsByClass.get(p.race_class).push(p);
  }

  const perRace = [];
  for (const race of races) {
    const pointsLookup = buildRacePointsLookup({ racePoints: pointsByClass.get(race.race_class) || [], raceType: race.race_type });
    const out = recomputeTeamRowsForRace({
      race,
      results: resultsByRace.get(race.id) || [],
      profileTypeByStage: profilesByRace.get(race.id) || new Map(),
      pointsLookup,
    });
    if (out.status === "no_team_rows") continue;
    perRace.push({ race_id: race.id, name: race.name, race_type: race.race_type, paid: Boolean(race.prize_paid_at), ...out });
  }

  const changed = perRace.filter((r) => r.changes.length);
  const moneyDelta = (rows) => rows.reduce((s, c) => s + Math.abs(c.new_prize - c.old_prize), 0) / 2;
  const pointsDelta = (rows) => rows.reduce((s, c) => s + Math.abs(c.new_points - c.old_points), 0) / 2;
  const unpaid = changed.filter((r) => !r.paid && r.status === "ok");
  const paid = changed.filter((r) => r.paid);
  return {
    summary: {
      races_with_team_rows: perRace.length,
      races_changed: changed.length,
      rows_changed: changed.reduce((s, r) => s + r.changes.length, 0),
      baseline_mismatch_races: perRace.filter((r) => r.status === "baseline_mismatch").length,
      unpaid_races_to_apply: unpaid.length,
      unpaid_rows_to_apply: unpaid.reduce((s, r) => s + r.changes.length, 0),
      unpaid_points_moved: pointsDelta(unpaid.flatMap((r) => r.changes)),
      paid_races_not_touched: paid.length,
      paid_prize_money_that_would_move: moneyDelta(paid.flatMap((r) => r.changes)),
      paid_points_that_would_move: pointsDelta(paid.flatMap((r) => r.changes)),
    },
    races: perRace,
  };
}

export async function applyUnpaid(supabase, report, warn = console.warn) {
  let updated = 0;
  for (const race of report.races) {
    if (race.paid || race.status !== "ok") continue;
    // Recheck payment immediately before this race's updates. A report is a
    // snapshot, not a lock against concurrent payout; apply still requires a
    // quiet payout window, verified by the operator before owner approval.
    const { data: currentRace, error: raceError } = await supabase.from("races")
      .select("id, prize_paid_at")
      .eq("id", race.race_id)
      .maybeSingle();
    if (raceError) throw new Error(`races ${race.race_id}: ${raceError.message}`);
    if (!currentRace || currentRace.prize_paid_at) {
      warn(`races ${race.race_id}: skipped (missing or paid since report)`);
      continue;
    }
    for (const c of race.changes) {
      const { data, error } = await supabase.from("race_results")
        .update({ rank: c.new_rank, points_earned: c.new_points, prize_money: c.new_prize })
        .eq("id", c.id)
        .eq("rank", c.old_rank) // optimistisk vagt: rækken må ikke have flyttet sig siden dry-run
        .select("id");
      if (error) throw new Error(`race_results ${c.id}: ${error.message}`);
      if (data?.length) updated += data.length;
      else warn(`race_results ${c.id}: skipped (rank changed since dry-run)`);
    }
  }
  return updated;
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(resolve(__dirname, ".."), ".env"), quiet: true });
  const args = new Set(process.argv.slice(2));
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const data = await loadSeasonData(supabase);
  if (!data.season) { console.log("Ingen aktiv sæson."); return; }
  const report = buildReport(data);

  if (args.has("--json")) console.log(JSON.stringify({ season: data.season, ...report }, null, 2));
  else {
    console.log(`#5952 holdklassement, sæson ${data.season.number} (${args.has("--apply") ? "APPLY" : "DRY-RUN"})`);
    console.table(report.summary);
    for (const r of report.races.filter((x) => x.changes.length || x.status !== "ok").slice(0, 40)) {
      console.log(`- ${r.name} [${r.race_type}${r.paid ? ", UDBETALT" : ""}] ${r.status}: ${r.changes.length} rækker`);
    }
  }

  if (args.has("--apply")) {
    const updated = await applyUnpaid(supabase, report);
    console.log(`APPLY: ${updated} hold-rækker opdateret (kun ikke-udbetalte løb). Kør sæsonstillingens opdatering bagefter.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => { console.error(err?.message || err); process.exit(1); });
}

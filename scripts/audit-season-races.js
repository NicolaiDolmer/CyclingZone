#!/usr/bin/env node
// Audit en sæsons race-katalog for jersey-points-dækning + expected prize-payout.
// Bruges som baseline-check før sæson-start: verificerer at alle løb har korrekt
// race_class, at race_points-tabellen dækker det relevante (race_class × race_type),
// og beregner forventet payout-total per løb.
//
// Usage:
//   node scripts/audit-season-races.js                 # sæson 1, human-readable
//   node scripts/audit-season-races.js --season 2      # andet sæson-nummer
//   node scripts/audit-season-races.js --json          # JSON-output
//   node scripts/audit-season-races.js --baseline-out docs/metrics/season-1-prize-audit.json
//
// Refs: GitHub issue #503.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { PRIZE_PER_POINT } from "../backend/lib/economyConstants.js";

const STAGE_RACE_TYPES = {
  finals: ["Klassement", "Pointtroje", "Bjergtroje", "Ungdomstroje", "EtapelobHold"],
  perStage: ["Etapeplacering", "Forertroje", "BjergtrojeDag", "PointtrojeDag", "UngdomstrojeDag"],
};

const SINGLE_RACE_TYPES = {
  finals: ["Klassiker", "Pointtroje", "Bjergtroje", "Ungdomstroje", "KlassikerHold"],
  perStage: [],
};

const args = process.argv.slice(2);
function argValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const jsonOutput = args.includes("--json");
const baselineOut = argValue("--baseline-out");
const seasonNumber = Number.parseInt(argValue("--season") ?? "1", 10);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

function pointsSumFor(rows, raceClass, resultType) {
  return rows
    .filter((r) => r.race_class === raceClass && r.result_type === resultType)
    .reduce((sum, r) => sum + (r.points || 0), 0);
}

function computeExpectedPayout(race, racePoints) {
  if (!race.race_class) return { total_points: 0, total_czk: 0, coverage: {}, warnings: ["missing race_class"] };

  const isStage = race.race_type === "stage_race";
  const cfg = isStage ? STAGE_RACE_TYPES : SINGLE_RACE_TYPES;
  const stages = Math.max(1, race.stages || 1);

  let totalPoints = 0;
  const coverage = {};
  const warnings = [];

  for (const resultType of cfg.finals) {
    const sum = pointsSumFor(racePoints, race.race_class, resultType);
    coverage[resultType] = { rows: racePoints.filter((r) => r.race_class === race.race_class && r.result_type === resultType).length, points_sum: sum };
    totalPoints += sum;
    if (sum === 0) warnings.push(`no race_points for ${race.race_class}.${resultType}`);
  }

  for (const resultType of cfg.perStage) {
    const perStageSum = pointsSumFor(racePoints, race.race_class, resultType);
    coverage[resultType] = { rows: racePoints.filter((r) => r.race_class === race.race_class && r.result_type === resultType).length, points_sum_per_stage: perStageSum, total_across_stages: perStageSum * stages };
    totalPoints += perStageSum * stages;
    if (perStageSum === 0) warnings.push(`no race_points for ${race.race_class}.${resultType}`);
  }

  return {
    total_points: totalPoints,
    total_czk: totalPoints * PRIZE_PER_POINT,
    coverage,
    warnings,
  };
}

async function loadSeasonRaces(seasonNumber) {
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number, status")
    .eq("number", seasonNumber)
    .maybeSingle();
  if (seasonError) throw new Error(`Supabase error loading season: ${seasonError.message}`);
  if (!season) throw new Error(`Season number ${seasonNumber} not found`);

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, name, race_type, race_class, stages, status, edition_year")
    .eq("season_id", season.id)
    .order("name");
  if (racesError) throw new Error(`Supabase error loading races: ${racesError.message}`);

  return { season, races: races || [] };
}

async function loadRacePoints(raceClasses) {
  if (!raceClasses.length) return [];
  const { data, error } = await supabase
    .from("race_points")
    .select("race_class, result_type, rank, points")
    .in("race_class", raceClasses);
  if (error) throw new Error(`Supabase error loading race_points: ${error.message}`);
  return data || [];
}

function formatCZ(n) {
  return n.toLocaleString("da-DK", { maximumFractionDigits: 0 }) + " CZ$";
}

function printHuman(report) {
  console.log(`\n=== Race-audit: sæson ${report.season.number} (status: ${report.season.status}) ===`);
  console.log(`Total løb: ${report.races.length}`);
  console.log(`Total forventet pulje: ${formatCZ(report.season_total_czk)}`);
  console.log(`Race classes brugt: ${[...new Set(report.races.map((r) => r.race_class).filter(Boolean))].sort().join(", ") || "(ingen)"}`);
  const warnings = report.races.flatMap((r) => (r.warnings || []).map((w) => `[${r.name}] ${w}`));
  console.log(`Advarsler: ${warnings.length}`);

  console.log("\n--- Per-race ---");
  for (const race of report.races) {
    const cls = race.race_class || "MISSING";
    const ed = race.edition_year ? `${race.edition_year}-udgave` : "—";
    const stages = race.race_type === "stage_race" ? `${race.stages} etaper` : "1-dag";
    console.log(`• ${race.name.padEnd(40, " ")} | ${cls.padEnd(20, " ")} | ${stages.padEnd(10, " ")} | ${ed.padEnd(14, " ")} | ${formatCZ(race.total_czk).padStart(18, " ")}`);
    if (race.warnings?.length) {
      for (const w of race.warnings) {
        console.log(`   ⚠ ${w}`);
      }
    }
  }
  console.log("");
}

async function main() {
  const { season, races } = await loadSeasonRaces(seasonNumber);
  const raceClasses = [...new Set(races.map((r) => r.race_class).filter(Boolean))];
  const racePoints = await loadRacePoints(raceClasses);

  const racesReport = races.map((race) => {
    const calc = computeExpectedPayout(race, racePoints);
    return {
      id: race.id,
      name: race.name,
      race_type: race.race_type,
      race_class: race.race_class,
      edition_year: race.edition_year,
      stages: race.stages,
      status: race.status,
      ...calc,
    };
  });

  const seasonTotalCzk = racesReport.reduce((s, r) => s + r.total_czk, 0);

  const report = {
    generated_at: new Date().toISOString(),
    season: { number: season.number, status: season.status, id: season.id },
    race_classes_used: raceClasses,
    race_points_rows_loaded: racePoints.length,
    season_total_czk: seasonTotalCzk,
    races: racesReport,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  if (baselineOut) {
    const out = path.resolve(baselineOut);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`Baseline gemt til ${out}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

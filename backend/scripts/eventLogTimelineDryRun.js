// #2410 (event-log S1) — dry-run-bevis: kør buildStageTimeline mod ÉN ægte,
// allerede-persisteret etapes data (read-only SELECT mod prod, 17/8) og print
// den resulterende tidslinje. INGEN skrivning — ren demonstration af generatoren
// mod virkelige input (raceRunner.js's egne fixtures dækkes af raceTimeline.test.js).
//
// Kør: node backend/scripts/eventLogTimelineDryRun.js
//
// Fixture: backend/scripts/fixtures/eventLogTimelineDryRunStage.json — snapshot
// af Tour des Volcans d'Auvergne, etape 8/8 (high_mountain, summit-finish,
// 2 uheld, 2 escapees indhentet, GC-skifte på slutetapen). Hentet read-only via
// Supabase MCP execute_sql (race_stage_profiles, race_results, race_incidents,
// race_stage_moments, race_stage_passages, race_simulation_runs.seed) — INGEN
// migration/write kørt. Se PR-beskrivelsen for det fulde output.

import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildStageTimeline } from "../lib/raceTimeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "eventLogTimelineDryRunStage.json"), "utf8"),
);

// race_stage_passages er persisteret som flade rækker (én pr. rytter pr.
// waypoint) — grupér til computePassages(...).passages-formen buildStageTimeline
// forventer: { kind, index, name, km, category, results:[{rider_id, passage_rank, points, bonus_seconds}] }.
function groupPassages(flatRows) {
  const byWaypoint = new Map();
  for (const row of flatRows) {
    const key = `${row.waypoint_kind}:${row.waypoint_index}`;
    if (!byWaypoint.has(key)) {
      byWaypoint.set(key, {
        kind: row.waypoint_kind, index: row.waypoint_index, name: row.waypoint_name,
        km: row.waypoint_km, category: row.climb_category ?? null, results: [],
      });
    }
    byWaypoint.get(key).results.push({
      rider_id: row.rider_id, passage_rank: row.passage_rank,
      points: row.points, bonus_seconds: row.bonus_seconds,
    });
  }
  return [...byWaypoint.values()].sort((a, b) => a.km - b.km);
}

// Persisteret in_breakaway/breakaway_caught (race_results) → PRÆCIS den samme
// Map-form deriveBreakawayStatus(ranked) ville have produceret — genbruger den
// ÆGTE, allerede-afledte etiket i stedet for at gætte den om fra components
// (rå score-komponenter persisteres kun i race_simulation_rider_scores, admin-RLS,
// og er bevidst UDENFOR denne dry-runs read-scope — fog-gaten starter allerede her).
function breakawayStatusFromRanked(ranked) {
  const out = new Map();
  for (const r of ranked) {
    out.set(r.rider_id, { in_breakaway: !!r.in_breakaway, breakaway_caught: !!r.breakaway_caught });
  }
  return out;
}

const { meta, stageProfile, ranked, incidents, moments, passagesFlat, gc_after, gc_before } = fixture;

const result = buildStageTimeline({
  ranked,
  stageProfile,
  moments,
  incidents,
  passages: groupPassages(passagesFlat),
  breakawayStatus: breakawayStatusFromRanked(ranked),
  gc: gc_after,
  previousGc: gc_before,
  seed: meta.seed,
  isStageRace: true,
});

console.log(`#2410 dry-run — ${meta.race_name}, etape ${meta.stage_number} (${stageProfile.profile_type}, ${stageProfile.distance_km} km, race_id=${meta.race_id}, seed=${meta.seed})`);
console.log(`Kilde: ${meta.source}`);
console.log(`timeline_version=${result.timeline_version}, ${result.events.length} events\n`);
for (const e of result.events) {
  console.log(`  km ${String(e.km).padStart(6)}  ${e.type.padEnd(20)} ${JSON.stringify(e.params)}`);
}

// Determinisme-kvitto: samme input igen → byte-identisk (konsistensregel 4).
const again = buildStageTimeline({
  ranked, stageProfile, moments, incidents,
  passages: groupPassages(passagesFlat),
  breakawayStatus: breakawayStatusFromRanked(ranked),
  gc: gc_after, previousGc: gc_before, seed: meta.seed, isStageRace: true,
});
const identical = JSON.stringify(result) === JSON.stringify(again);
console.log(`\nDeterminisme-kvitto (samme input igen → byte-identisk): ${identical ? "OK" : "FEJL"}`);
if (!identical) process.exitCode = 1;

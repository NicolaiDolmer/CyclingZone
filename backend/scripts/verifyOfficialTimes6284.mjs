// Read-only paired verification using an explicitly supplied private fixture.
// No database access, no fixture identifiers or measured balance values logged.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { loadRaceEngineV4 } from "../lib/raceEngineV4Bridge.js";
import { accumulateStageRows, formatGap } from "../lib/raceClassifications.js";

const [inputPath, reportPath] = process.argv.slice(2);
if (!inputPath || !reportPath) throw new Error("Usage: verifyOfficialTimes6284.mjs <private-input.json> <report.json>");
const cases = JSON.parse(readFileSync(inputPath, "utf8"));
const engine = await loadRaceEngineV4();
const report = { method: "Paired new-seed simulations on supplied fixtures, not historical replay", cases: cases.length, pairedRuns: 0, rawOutputParity: true, savedTimeIntegrity: true, resumedGcIntegrity: true };
for (const fixture of cases) {
  const stageProfile = fixture.profiles.find((stage) => stage.stage_number === fixture.stage);
  assert.ok(stageProfile);
  for (let seed = 1; seed <= 5; seed++) {
    const args = {
      entrants: fixture.entrants, stageProfile,
      seedString: `5951-analysis-7oct:${fixture.race.id}:${fixture.stage}:${seed}`,
      stageNumber: fixture.stage, teamOrderRows: fixture.orders,
      isStageRace: fixture.race.stages > 1, raceStages: fixture.profiles,
      squad: fixture.race.squad,
      gcStandings: fixture.previousGc.map((row) => ({ rider_id: row.rider_id, time: String(row.finish_time ?? "0:00").replace("+", "").split(":").reduce((total, part) => total * 60 + Number(part), 0) })),
    };
    const old = engine.simulateStage({ ...args, rulesRevision: "orders_gc_v2" });
    const official = engine.simulateStage({ ...args, rulesRevision: "official_times_v1" });
    assert.deepEqual(official.v4Output, old.v4Output, "raw engine output must retain v2 mechanics");
    assert.deepEqual(official.incidents, old.incidents);
    assert.deepEqual(official.passages, old.passages);
    const finishers = official.v4Output.results.filter((row) => row.status !== "otl" && row.status !== "abandoned");
    const winnerTime = finishers[0]?.time_seconds;
    official.ranked.forEach((row, index) => {
      assert.equal(row.stageGap, Math.max(0, Math.round(finishers[index].time_seconds - winnerTime)));
      assert.deepEqual({ ...row, stageGap: old.ranked[index].stageGap }, old.ranked[index]);
    });
    const saved = JSON.parse(JSON.stringify(official.ranked.map((row) => ({
      ...row, stage_number: 1, finish_time: formatGap(row.stageGap),
      ...(official.passages?.perRider.get(row.rider_id) ?? {}),
    }))));
    const resumed = accumulateStageRows({ stageRows: [...saved, ...saved.map((row) => ({ ...row, stage_number: 2 }))] });
    official.ranked.forEach((row) => {
      const bonus = official.passages?.perRider.get(row.rider_id)?.bonus_seconds ?? 0;
      assert.equal(resumed.cumTime.get(row.rider_id), (row.stageGap - bonus) * 2);
    });
    report.pairedRuns++;
  }
}
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log("Official time paired verification passed; report written without fixture identifiers or balance measurements.");

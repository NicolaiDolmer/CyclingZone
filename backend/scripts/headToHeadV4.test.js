// backend/scripts/headToHeadV4.test.js
// Race Engine v4 F2 (#4030), Fase B4: verificerer headToHeadV4.js's STUB koerer
// fejlfrit (a) som modul (runHeadToHead) og (b) som ægte CLI-kommando mod det
// syntetiske eksempel-input i fixtures/headToHeadV4-example/.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §7.

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHeadToHead } from "./headToHeadV4.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(SCRIPT_DIR, "fixtures", "headToHeadV4-example");
const POPULATION_PATH = path.join(FIXTURE_DIR, "population.json");
const STAGES_PATH = path.join(FIXTURE_DIR, "stages.json");

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

// ── Modul-niveau: runHeadToHead() direkte mod fixturen ────────────────────────

test("runHeadToHead: koerer v3+v4 fejlfrit paa det syntetiske eksempel-input, returnerer én row pr. etape", () => {
  const population = readJson(POPULATION_PATH);
  const stagesFile = readJson(STAGES_PATH);
  const rows = runHeadToHead({ population, stages: stagesFile.stages, seedInput: "test-seed" });

  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(Number.isFinite(row.stageNumber) || typeof row.stageNumber === "string");
    assert.ok(typeof row.profileType === "string");
    assert.ok(["sprint_win", "close_win", "solo_win"].includes(row.v3.winType));
    assert.ok(["sprint_win", "close_win", "solo_win"].includes(row.v4.winType));
    assert.ok(row.v3.groupCountProxy >= 1);
    assert.ok(row.v4.groupCount >= 1);
    assert.ok(row.v3.timeSpreadSeconds >= 0);
    assert.ok(row.v4.timeSpreadSeconds >= 0);
  }
});

test("runHeadToHead: haandterer stage 2's legacy segments:null/weather:null (routeAdapter-fallback) uden at kaste", () => {
  const population = readJson(POPULATION_PATH);
  const stagesFile = readJson(STAGES_PATH);
  const legacyStage = stagesFile.stages.find((s) => s.stage_number === 2);
  assert.equal(legacyStage.segments, null);
  assert.equal(legacyStage.weather, null);
  assert.doesNotThrow(() => runHeadToHead({ population, stages: [legacyStage], seedInput: "legacy-check" }));
});

test("runHeadToHead: deterministisk — samme (population, stages, seedInput) giver samme rows, to kald", () => {
  const population = readJson(POPULATION_PATH);
  const stagesFile = readJson(STAGES_PATH);
  const a = runHeadToHead({ population, stages: stagesFile.stages, seedInput: "determinism-check" });
  const b = runHeadToHead({ population, stages: stagesFile.stages, seedInput: "determinism-check" });
  assert.deepEqual(a, b);
});

test("runHeadToHead: kaster tydeligt naar en etape mangler demand_vector (v3-krav)", () => {
  const population = readJson(POPULATION_PATH);
  const stage = { stage_number: 1, profile_type: "flat", distance_km: 100 };
  assert.throws(
    () => runHeadToHead({ population, stages: [stage] }),
    /demand_vector mangler/,
  );
});

test("runHeadToHead: kaster tydeligt naar population.riders er tom", () => {
  assert.throws(
    () => runHeadToHead({ population: { riders: [] }, stages: [{ demand_vector: {} }] }),
    /population\.riders mangler eller er tom/,
  );
});

// ── CLI-niveau: den ÆGTE kommandolinje koerer fejlfrit og printer tabellen ────

function runCli(args) {
  return spawnSync(process.execPath, [path.join(SCRIPT_DIR, "headToHeadV4.js"), ...args], {
    encoding: "utf8",
    cwd: SCRIPT_DIR,
  });
}

test("CLI: node backend/scripts/headToHeadV4.js --population=... --stages=... koerer med exit 0 og printer sammenligningstabellen", () => {
  const result = runCli([`--population=${POPULATION_PATH}`, `--stages=${STAGES_PATH}`, "--seed=cli-test"]);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const lines = result.stdout.trim().split("\n");
  assert.ok(lines[0].startsWith("Population: 8 ryttere. Etaper: 2."));
  // Header-linje (tab-separeret) med de forventede kolonner (d)-kravet.
  const headerLine = lines[1];
  for (const col of ["stage", "profile_type", "v3_win_type", "v3_groups(proxy)", "v3_spread_s", "v4_win_type", "v4_groups", "v4_spread_s"]) {
    assert.ok(headerLine.includes(col), `header mangler kolonnen "${col}": ${headerLine}`);
  }
  // To datarraekker (én pr. etape).
  assert.equal(lines.length, 2 + 2);
});

test("CLI: manglende --population/--stages exit'er 2 med usage-besked paa stderr", () => {
  const result = runCli([]);
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes("Usage:"));
});

// backend/lib/engine/v4/s5MotorBench.test.ts
// #6362 (S5-etapeprofiler): den rigtige motor-bench bag benchmark-gatens del (4).
//
//   1. Fixturen (__fixtures__/s5MotorBench.json) er ikke en stub og er skrevet med den
//      kanoniske bench-konfiguration.
//   2. Benchen genkoeres her (v4 under s5_profiles_v1, KUN i testen; flaget og prod-
//      revisionen roeres ikke) og SKAL give praecis fixturens dom. Saa kan fixturen ikke
//      drive fra motoren eller generatoren: aendres en af dem, bliver denne test roed, og
//      fixturen skrives igen med `node backend/scripts/dev/s5MotorBench.mjs --write-fixture`
//      - hvorefter gaten doemmer den nye dom (blokerende ved fail).
//   3. Gaten laeser dommen og blokerer paa den.
//   4. Afslutningernes raekkefoelge i tidsgab passer med cykelsporten.
//   5. Vindertypen: stigende spurt -> spurtere, bjergtop -> klatrere. Altid som "hyppigste
//      vinder"; den praecise andels-taerskel er privat (balance-internals/6362/
//      winner-thresholds.json), og fixturen baerer kun dommen, som gaten blokerer paa.
//
// Tal og taerskler staar ikke her (hard rule 17); de ligger i balance-internals/6362/.
import test from "node:test";
import assert from "node:assert/strict";

import {
  S5_MOTOR_BENCH_CONFIG, S5_WINNER_EXPECTATIONS, buildS5BenchRaces, dominantWinnerType, finishesNeedingSeasonSample,
  gateMeasurement, gateRowsFor, loadWinnerThresholds, runS5MotorBench, winnerVerdicts,
} from "../../../scripts/dev/s5MotorBench.mjs";
import {
  evaluateMotorGaps, evaluateS5BenchmarkGate, formatS5BenchmarkReport, loadMotorGapFile, loadS5Benchmark,
  MOTOR_GAP_VERDICTS, MOTOR_WINNER_VERDICTS,
} from "../../s5BenchmarkGate.js";
import { CURRENT_RACE_RULES_REVISION } from "../../raceEngineRulesRevision.ts";

type Row = { finish: string; grandTour: boolean; gap10: number | null; winnerType: string | null; seasonId: string; raceId: string; stage_number: number };
type WinnerVerdict = { expected: string; verdict: string };

const BENCHMARK = loadS5Benchmark();
const FIXTURE = loadMotorGapFile() as {
  stub: boolean; config: Record<string, unknown>; verdicts: Record<string, string>; sources: Record<string, string>;
  winners: Record<string, WinnerVerdict>;
};

// Én koersel af den kanoniske bench, delt af testene nedenfor.
const ROWS = (await runS5MotorBench()) as Row[];
const MEASURED = gateMeasurement(ROWS, BENCHMARK) as { medians: Record<string, number>; sources: Record<string, string>; verdicts: Record<string, string> };

test("#6362: fixturen er den rigtige bench (ikke en stub), skrevet med den kanoniske konfiguration", () => {
  assert.equal(FIXTURE.stub, false);
  assert.deepEqual(FIXTURE.config, { ...S5_MOTOR_BENCH_CONFIG });
  assert.equal(S5_MOTOR_BENCH_CONFIG.revision, "s5_profiles_v1");
  assert.notEqual(CURRENT_RACE_RULES_REVISION, "s5_profiles_v1", "benchen taender aldrig revisionen i prod");
  for (const v of Object.values(FIXTURE.verdicts)) assert.ok(MOTOR_GAP_VERDICTS.includes(v), v);
  assert.ok(!("medians" in FIXTURE), "ingen maalte tal i det offentlige repo (hard rule 17)");
});

test("#6362: benchen koerer paa S5-ruter fra generatoren: Grand Tours + saesonens loeb for de afslutninger GT'erne mangler", () => {
  const gts = buildS5BenchRaces({ scope: "gt" });
  assert.equal(gts.length, 3 * S5_MOTOR_BENCH_CONFIG.genSeeds, "tre Grand Tours pr. saeson-traek");
  assert.ok(gts.every((r) => r.stages.every((s) => (s as { generator_version: number }).generator_version >= 6)), "S5-modellen");
  const missing = finishesNeedingSeasonSample(gts);
  assert.ok(missing.includes("wall_finish"), "S5-GT'erne har ingen mur; den maales paa resten af saesonen");
  for (const finish of missing) assert.equal(MEASURED.sources[finish], "season", finish);
  assert.ok(ROWS.some((r) => r.grandTour) && ROWS.some((r) => !r.grandTour));
});

test("#6362: genkoert bench = fixturens dom (fixturen kan ikke drive fra motoren)", () => {
  assert.deepEqual(MEASURED.verdicts, FIXTURE.verdicts, "koer `node backend/scripts/dev/s5MotorBench.mjs --write-fixture` og gennemse dommen");
  assert.deepEqual(MEASURED.sources, FIXTURE.sources);
});

test("#6362: gatens del (4) doemmer paa benchen og blokerer ved fail", () => {
  const part = evaluateMotorGaps({ motor: FIXTURE, benchmark: BENCHMARK });
  assert.equal(part.stub, false);
  const judged = part.rows.filter((r: { judged: boolean }) => r.judged);
  assert.ok(judged.length >= 6, "alle afslutninger med nok benchmark-etaper doemmes");
  for (const r of judged) assert.ok(r.verdict, `${r.finish} er maalt`);
  const allInside = judged.every((r: { verdict: string }) => r.verdict === "inside");
  const winnersPass = Object.values(FIXTURE.winners).every((w) => w.verdict === "pass");
  const green = allInside && winnersPass;
  assert.equal(part.status, green ? "green" : "red");
  const gate = (evaluateS5BenchmarkGate as unknown as (args: { races: unknown[]; benchmark: unknown[]; motor: unknown }) => { blocking: string[] })({ races: [], benchmark: BENCHMARK, motor: FIXTURE });
  assert.equal(gate.blocking.some((b: string) => b.startsWith("S5 (4) motor")), !green, "en roed bench blokerer");
  assert.ok(!formatS5BenchmarkReport(gate as never).some((l: string) => l.includes("STUB")));
});

test("#6362: tidsgabene stiger med afslutningens sværhed, som i cykelsporten", () => {
  const m = MEASURED.medians;
  const order = ["flat_sprint", "uphill_sprint", "punch", "wall_finish", "long_climb"];
  for (let i = 1; i < order.length; i++) assert.ok(m[order[i - 1]] <= m[order[i]], `${order[i - 1]} <= ${order[i]}`);
  assert.equal(m.flat_sprint, 0, "flad spurt: feltet kommer samlet");
  assert.ok(m.uphill_sprint > 0, "stigende spurt: feltet trækkes ud på rampen");
});

test("#6362: stigende spurt vindes oftest af spurtere, bjergtop af klatrere", () => {
  // Uden taerskel (CI har ingen privat fil): den forventede type er den hyppigste vinder.
  for (const [finish, type] of Object.entries(S5_WINNER_EXPECTATIONS)) {
    assert.equal(dominantWinnerType(gateRowsFor(ROWS, finish).rows), type, finish);
  }
});

test("#6362: fixturens vindertype-dom er bestaaet og blokerer gaten ved fail", () => {
  assert.deepEqual(Object.keys(FIXTURE.winners).sort(), Object.keys(S5_WINNER_EXPECTATIONS).sort());
  for (const [finish, w] of Object.entries(FIXTURE.winners)) {
    assert.deepEqual(Object.keys(w).sort(), ["expected", "verdict"], `${finish}: kun dommen, ingen tal`);
    assert.equal(w.expected, S5_WINNER_EXPECTATIONS[finish as keyof typeof S5_WINNER_EXPECTATIONS]);
    assert.ok(MOTOR_WINNER_VERDICTS.includes(w.verdict), w.verdict);
  }
  const part = evaluateMotorGaps({ motor: FIXTURE, benchmark: BENCHMARK });
  const failed = Object.values(FIXTURE.winners).some((w) => w.verdict !== "pass");
  assert.equal(part.violations.some((v: string) => v.includes("vinder ikke")), failed, "en fejlet vindertype er et brud i del (4)");
});

// Den praecise taerskel er motor-intern og ligger privat (hard rule 17). Lokalt med filen
// genkoeres dommen og skal give fixturens; i CI (ingen fil) gaelder fixturens dom ovenfor.
const WINNER_THRESHOLDS = loadWinnerThresholds();
test(
  "#6362: genkoert vindertype-dom mod den private taerskel = fixturens",
  { skip: WINNER_THRESHOLDS ? false : "privat taerskelfil mangler (balance-internals/6362/winner-thresholds.json eller CZ_6362_WINNER_THRESHOLDS)" },
  () => {
    assert.deepEqual(winnerVerdicts(ROWS, WINNER_THRESHOLDS), FIXTURE.winners, "koer `node backend/scripts/dev/s5MotorBench.mjs --write-fixture` og gennemse dommen");
  },
);

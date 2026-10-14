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
//      CI haandhaever dommen uden taersklen: fixturens winnerDigests skal matche den
//      genkoerte benchs maalinger, ellers kan dommen ikke genberegnes og testen er roed.
//   6. Etapeloeb koeres med akkumuleret traethed og hviledage, PRAECIS raceRunner's
//      sekvens (entrantFatigueSequences), ikke med friske ryttere paa hver etape.
//
// Tal og taerskler staar ikke her (hard rule 17); de ligger i balance-internals/6362/.
import test from "node:test";
import assert from "node:assert/strict";

import {
  S5_MOTOR_BENCH_CONFIG, S5_WINNER_EXPECTATIONS, benchStageFatigues, buildS5BenchRaces, dominantWinnerType, finishesNeedingSeasonSample,
  gateMeasurement, gateRowsFor, loadBenchField, loadWinnerThresholds, runS5MotorBench, winnerRowsDigests, winnerVerdicts,
} from "../../../scripts/dev/s5MotorBench.mjs";
import { sortedStages, splitEntrants } from "../../../scripts/dev/lib/tourScorecard.mjs";
import { entrantFatigueSequences } from "../../raceRunner.js";
import { loadRaceEngineV4 } from "../../raceEngineV4Bridge.js";
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
  winners: Record<string, WinnerVerdict>; winnerDigests: Record<string, string>;
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

// CI-haandhaevelsen (review-runde 3): dommen er en ren funktion af (maalinger, privat
// taerskel). Er maalingerne de samme som da dommen blev skrevet, er dommen stadig den
// rigtige; er de ikke, kan den ikke genberegnes uden taersklen, og testen er roed. Saa kan
// en motor-aendring ikke skubbe den forventede type under taersklen og beholde et "pass".
test("#6362: vindertype-dommen er bundet til de genkoerte maalinger (CI, uden taersklen)", () => {
  assert.deepEqual(Object.keys(FIXTURE.winnerDigests ?? {}).sort(), Object.keys(S5_WINNER_EXPECTATIONS).sort());
  for (const d of Object.values(FIXTURE.winnerDigests)) assert.match(d, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    winnerRowsDigests(ROWS), FIXTURE.winnerDigests,
    "vindertype-maalingerne har flyttet sig: den committede dom kan ikke genberegnes uden den private taerskel. Koer `node backend/scripts/dev/s5MotorBench.mjs --write-fixture` med balance-internals/6362/winner-thresholds.json (eller CZ_6362_WINNER_THRESHOLDS) og gennemse dommen",
  );
});

test("#6362: winnerRowsDigests reagerer paa een flyttet vinder og ignorerer raekkefoelgen", () => {
  const rows = gateRowsFor(ROWS, "long_climb").rows;
  const base = winnerRowsDigests(ROWS).long_climb;
  assert.equal(winnerRowsDigests([...ROWS].reverse()).long_climb, base, "raekkefoelge-uafhaengig");
  const i = ROWS.indexOf(rows[0]);
  const flipped = ROWS.map((r, j) => (j === i ? { ...r, winnerType: r.winnerType === "climber" ? "sprinter" : "climber" } : r));
  assert.notEqual(winnerRowsDigests(flipped).long_climb, base, "een vinder skiftet -> anden digest");
});

type BenchStage = { stage_number: number; game_day: number | null };
type FatigueSeqs = Map<string, number[]>;
const fatigueSequences = entrantFatigueSequences as unknown as (opts: Record<string, unknown>) => FatigueSeqs;
const stageFatigues = benchStageFatigues as unknown as (data: unknown) => { stagesSorted: BenchStage[]; fatigueById: FatigueSeqs };

test("#6362: etapeloeb koeres med raceRunner's akkumulerede traethed og hviledage", async () => {
  const gt = buildS5BenchRaces({ scope: "gt" })[0] as { seasonId: string; race: { id: string }; stages: object[]; grandTour: boolean };
  const field = loadBenchField();
  const raceId = `${gt.race.id}:${gt.seasonId}`;
  const profiles = gt.stages.map((p) => ({ ...p, race_id: raceId }));
  const data = { ...field, race: { ...field.race, id: raceId, stages: profiles.length }, profiles };

  // Sekvensen er PRAECIS raceRunner's (samme funktion, samme input), ikke en kopi.
  const { stagesSorted, fatigueById } = stageFatigues(data);
  const expected = fatigueSequences({ stagesSorted: sortedStages(data), entrants: splitEntrants(data).entrants, rulesRevision: S5_MOTOR_BENCH_CONFIG.revision });
  assert.deepEqual(fatigueById, expected);

  // Grand Tour'en har kalender-hviledage, og traetheden falder over dem.
  const restIdx = stagesSorted.map((s, i) => (i > 0 && s.game_day! - stagesSorted[i - 1].game_day! > 1 ? i : -1)).filter((i) => i > 0);
  assert.ok(restIdx.length >= 1, "S5-Grand Tour'en har mindst een hviledag i kalender-planen");
  const anyRider = [...fatigueById.values()][0];
  assert.equal(anyRider[0], 0, "etape 1 koeres frisk");
  assert.ok(anyRider[anyRider.length - 1] > 0, "sidste etape koeres med akkumuleret traethed");
  const noRest = fatigueSequences({ stagesSorted: stagesSorted.map((s) => ({ ...s, game_day: null })), entrants: splitEntrants(data).entrants, rulesRevision: S5_MOTOR_BENCH_CONFIG.revision });
  const [id0] = [...fatigueById.keys()];
  assert.ok(fatigueById.get(id0)![restIdx[0]] < noRest.get(id0)![restIdx[0]], "hviledagen restituerer");

  // Motoren faar faktisk sekvensen: hver etapes entrants baerer etapens traethed.
  const engine = await loadRaceEngineV4();
  const seen: Array<Map<string, number>> = [];
  const recording = { ...engine, simulateStage: (args: { entrants: Array<{ rider_id: string; fatigue: number }> }) => {
    seen.push(new Map(args.entrants.map((e) => [e.rider_id, e.fatigue])));
    return (engine.simulateStage as (a: unknown) => unknown)(args);
  } };
  await runS5MotorBench({ races: [gt], simSeeds: 1, v4: recording });
  assert.equal(seen.length, stagesSorted.length);
  seen.forEach((byRider, i) => {
    for (const [id, f] of byRider) assert.equal(f, fatigueById.get(id)![i], `etape ${i + 1}, rytter ${id}`);
  });
});

// Den praecise taerskel er motor-intern og ligger privat (hard rule 17). Lokalt med filen
// genkoeres dommen og skal give fixturens; i CI (ingen fil) haandhaeves den via
// winnerDigests ovenfor.
const WINNER_THRESHOLDS = loadWinnerThresholds();
test(
  "#6362: genkoert vindertype-dom mod den private taerskel = fixturens",
  { skip: WINNER_THRESHOLDS ? false : "privat taerskelfil mangler (balance-internals/6362/winner-thresholds.json eller CZ_6362_WINNER_THRESHOLDS)" },
  () => {
    assert.deepEqual(winnerVerdicts(ROWS, WINNER_THRESHOLDS), FIXTURE.winners, "koer `node backend/scripts/dev/s5MotorBench.mjs --write-fixture` og gennemse dommen");
  },
);

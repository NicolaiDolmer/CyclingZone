// backend/scripts/v4FlipReadiness.test.js
// Tests for flip-klar-harnessen (#5515). Maaleredskabet skal selv vaere testet
// foer et tal fra det bruges som flip-argument — samme praecedens som
// headToHeadV4.test.js og v4TailSpread.test.js.
//
// Den vigtigste test er hard rule 17-vagten: den OFFENTLIGE blok maa aldrig
// indeholde maalte anker-vaerdier, rater eller baand-graenser.
//
// Filen hedder .test.js (ikke .test.mjs) med vilje: backend/scripts/run-tests.js
// samler kun *.test.js/*.test.ts op, saa en .test.mjs ville aldrig koere i CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  END_MARKER,
  OWNER_INCIDENT_TARGET,
  PERF_GATE_MS,
  START_MARKER,
  TAIL_GATE_SEEDS,
  HEAD_TO_HEAD_SEEDS,
  accumulateStageRates,
  countSeedVerdicts,
  measureHeadToHead,
  parseTap,
  renderPrivateReport,
  renderPublicBlock,
  replaceBlock,
  runPerf,
  summarizeAnchorGate,
  summarizeRates,
  summarizeTimings,
} from "./v4FlipReadiness.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(SCRIPT_DIR, "fixtures", "headToHeadV4-example");

function cell(verdict, value = null) {
  return { verdict, value, sampleCount: verdict === "N/A" ? 0 : 10 };
}

function card(entries) {
  return entries.map(([id, v3, v4]) => ({ id, label: id, source: "src", bandLabel: "band", v3, v4 }));
}

// ── Konstanter: gaten er laast som spec'en og RULES siger ────────────────────

test("gaten er laast: 5 seeds til ankrene, 3 ejer-laaste til halen, 60 s ydelse", () => {
  assert.deepEqual([...HEAD_TO_HEAD_SEEDS], ["s1", "s2", "s3", "s4", "s5"]);
  assert.deepEqual([...TAIL_GATE_SEEDS], ["s1", "s2", "s3"]);
  assert.equal(PERF_GATE_MS, 60_000);
  assert.ok(OWNER_INCIDENT_TARGET.min < OWNER_INCIDENT_TARGET.max);
});

// ── (1) Ankre ────────────────────────────────────────────────────────────────

test("countSeedVerdicts taeller PASS/FAIL/N-A pr. anker og motor paa tvaers af seeds", () => {
  const cards = [
    card([["a", cell("PASS", 1), cell("FAIL", 1)], ["b", cell("N/A"), cell("PASS", 2)]]),
    card([["a", cell("PASS", 1), cell("PASS", 1)], ["b", cell("N/A"), cell("PASS", 2)]]),
    card([["a", cell("FAIL", 1), cell("PASS", 1)], ["b", cell("N/A"), cell("FAIL", 2)]]),
  ];
  const counts = countSeedVerdicts(cards);
  assert.deepEqual(counts.get("a").v3, { PASS: 2, FAIL: 1, "N/A": 0 });
  assert.deepEqual(counts.get("a").v4, { PASS: 2, FAIL: 1, "N/A": 0 });
  assert.deepEqual(counts.get("b").v3, { PASS: 0, FAIL: 0, "N/A": 3 });
  assert.deepEqual(counts.get("b").v4, { PASS: 2, FAIL: 1, "N/A": 0 });
});

test("summarizeAnchorGate: dommen er MIDDEL-dommen; én v4-FAIL = ikke alle groenne; N/A listes separat", () => {
  const perSeed = [
    card([["a", cell("PASS", 1), cell("PASS", 1)], ["b", cell("PASS", 1), cell("FAIL", 1)], ["c", cell("N/A"), cell("N/A")]]),
    card([["a", cell("PASS", 1), cell("FAIL", 1)], ["b", cell("PASS", 1), cell("FAIL", 1)], ["c", cell("N/A"), cell("N/A")]]),
  ];
  const aggregated = card([
    ["a", cell("PASS", 1), cell("PASS", 1)],
    ["b", cell("PASS", 1), cell("FAIL", 1)],
    ["c", cell("N/A"), cell("N/A")],
  ]);
  const gate = summarizeAnchorGate(aggregated, countSeedVerdicts(perSeed), 2);
  assert.equal(gate.v4AllGreen, false);
  assert.deepEqual(gate.v4Fail, ["b"]);
  assert.deepEqual(gate.v4NotMeasured, ["c"]);
  assert.deepEqual(gate.v4Pass, ["a"]);
  // Middel-dommen PASS for "a" selvom kun 1 af 2 seeds bestod for sig — begge tal vises.
  const a = gate.rows.find((r) => r.id === "a");
  assert.equal(a.v4.verdict, "PASS");
  assert.equal(a.v4.seedsPass, 1);
  assert.equal(a.v4.seedsMeasured, 2);
});

// ── (3) Uheld + OTL ──────────────────────────────────────────────────────────

function stageOutput({ statuses, incidents = [], rescued = 0 }) {
  return {
    results: statuses.map((status, i) => ({ rider_id: `r${i}`, status })),
    incidents,
    timeline: { events: rescued ? [{ type: "grupetto_saved", params: { rider_count: rescued } }] : [] },
  };
}

test("accumulateStageRates: OTL fra status, redning fra tidslinjen, trappen klassificeres rigtigt", () => {
  const acc = new Map();
  accumulateStageRates(acc, "mountain", stageOutput({
    statuses: ["finished", "finished", "otl", "otl", "abandoned"],
    incidents: [
      { kind: "crash", severity: "light" },
      { kind: "crash", severity: "hard" },
      { kind: "crash", severity: "serious" },
      { kind: "mechanical", severity: null },
    ],
    rescued: 3,
  }));
  accumulateStageRates(acc, "flat", stageOutput({ statuses: ["finished", "finished", "finished", "finished"] }));
  const m = acc.get("mountain");
  assert.equal(m.stages, 1);
  assert.equal(m.riderStarts, 5);
  assert.equal(m.otl, 2);
  assert.equal(m.stagesWithOtl, 1);
  assert.equal(m.abandoned, 1);
  assert.equal(m.rescued, 3);
  assert.deepEqual([m.light, m.hard, m.serious, m.mechanical], [1, 1, 1, 1]);
  const total = acc.get("_total");
  assert.equal(total.stages, 2);
  assert.equal(total.riderStarts, 9);
  assert.equal(total.incidents, 4);
});

test("summarizeRates: dom mod ejer-maalet KUN paa totalen; typer uden OTL listes ikke", () => {
  const acc = new Map();
  // 1 uheld pr. 100 starter = inden for maalet.
  accumulateStageRates(acc, "flat", stageOutput({
    statuses: Array.from({ length: 100 }, () => "finished"),
    incidents: [{ kind: "mechanical", severity: null }, { kind: "crash", severity: "light" }],
  }));
  accumulateStageRates(acc, "hilly", stageOutput({
    statuses: [...Array.from({ length: 99 }, () => "finished"), "otl"],
    rescued: 5,
  }));
  const s = summarizeRates(acc);
  assert.deepEqual(s.rows.map((r) => r.key), ["flat", "hilly"]);
  assert.equal(s.total.incidentRate, 2 / 200);
  assert.equal(s.incidentVerdict, "PASS");
  assert.equal(s.otlObserved, true);
  assert.deepEqual(s.otlTypes, ["hilly"]);
  assert.deepEqual(s.rescueTypes, ["hilly"]);

  const none = summarizeRates(new Map());
  assert.equal(none.incidentVerdict, "N/A");
  assert.equal(none.otlObserved, false);
});

test("summarizeRates: for mange uheld = FAIL", () => {
  const acc = new Map();
  accumulateStageRates(acc, "flat", stageOutput({
    statuses: Array.from({ length: 10 }, () => "finished"),
    incidents: [{ kind: "crash", severity: "light" }],
  }));
  assert.equal(summarizeRates(acc).incidentVerdict, "FAIL");
});

// ── (4) Ydelse ───────────────────────────────────────────────────────────────

test("summarizeTimings: maks afgoer dommen, og den langsomste etape navngives", () => {
  const s = summarizeTimings([
    { ms: 10, stageNumber: 1, profileType: "flat" },
    { ms: 30, stageNumber: 2, profileType: "mountain" },
    { ms: 20, stageNumber: 3, profileType: "hilly" },
  ]);
  assert.equal(s.n, 3);
  assert.equal(s.maxMs, 30);
  assert.equal(s.meanMs, 20);
  assert.deepEqual(s.worst, { stageNumber: 2, profileType: "mountain" });
  assert.equal(s.verdict, "PASS");
  assert.equal(summarizeTimings([{ ms: PERF_GATE_MS, stageNumber: 1, profileType: "x" }]).verdict, "FAIL");
  assert.equal(summarizeTimings([]).verdict, "N/A");
});

// ── (6) TAP-parser til kill-switch-testene ───────────────────────────────────

test("parseTap: top-level ok/not ok, opsummering, kill-switch-navne og escapede #", () => {
  const tap = [
    "TAP version 13",
    "ok 1 - \\#3855 (a) flag off: motoren kaldes ALDRIG",
    "    ok 1 - subtest der ikke maa taelle",
    "not ok 2 - \\#3855 (d) kill-switch: etape 1 paa v4 + etape 2 paa v3",
    "ok 3 - determinisme",
    "# tests 3",
    "# pass 2",
    "# fail 1",
  ].join("\n");
  const r = parseTap(tap);
  assert.equal(r.tests.length, 3);
  assert.equal(r.total, 3);
  assert.equal(r.pass, 2);
  assert.equal(r.fail, 1);
  assert.equal(r.ok, false);
  assert.equal(r.tests[0].name, "#3855 (a) flag off: motoren kaldes ALDRIG");
  assert.deepEqual(r.killSwitch.map((k) => k.ok), [true, false]);
  assert.equal(parseTap("").ok, false, "intet output er ikke groent");
});

// ── Rendering + hard rule 17-vagten ──────────────────────────────────────────

function syntheticResult() {
  const aggregated = [
    {
      id: "favorite_win_rate",
      label: "Felt-favoritters win-rate",
      source: "src",
      bandLabel: "25.0%-40.0%",
      v3: { verdict: "PASS", value: 0.3712, sampleCount: 9, spread: { min: 0.3301, max: 0.4104, seeds: 5 } },
      v4: { verdict: "FAIL", value: 0.6234, sampleCount: 9, spread: { min: 0.5877, max: 0.6611, seeds: 5 } },
    },
    {
      id: "mountain_top10_spread",
      label: "Bjergetape top-10-spredning",
      source: "src",
      bandLabel: "180-240s",
      v3: { verdict: "FAIL", value: 108.7, sampleCount: 9, spread: { min: 101.2, max: 113.9, seeds: 5 } },
      v4: { verdict: "PASS", value: 203.4, sampleCount: 9, spread: { min: 187.6, max: 219.3, seeds: 5 } },
    },
  ];
  const counts = new Map([
    ["favorite_win_rate", { v3: { PASS: 4, FAIL: 1, "N/A": 0 }, v4: { PASS: 0, FAIL: 5, "N/A": 0 } }],
    ["mountain_top10_spread", { v3: { PASS: 0, FAIL: 5, "N/A": 0 }, v4: { PASS: 4, FAIL: 1, "N/A": 0 } }],
  ]);
  const acc = new Map();
  accumulateStageRates(acc, "mountain", stageOutput({
    statuses: [...Array.from({ length: 70 }, () => "finished"), "otl", "otl", "otl"],
    incidents: [{ kind: "crash", severity: "light" }],
    rescued: 7,
  }));
  return {
    meta: {
      generated_at: "2026-09-23T00:00:00.000Z",
      engine_sha: "abc1234",
      population_file: "pop.json",
      stages_file: "stages.json",
      stage_count: 1,
      seeds: ["s1", "s2", "s3", "s4", "s5"],
      tail_seeds: ["s1", "s2", "s3"],
      field_size: 180,
      host: "TESTPC",
      node: "v24",
    },
    anchors: summarizeAnchorGate(aggregated, counts, 5),
    tailGate: {
      rows: [{ profileType: "mountain", n: 3, value: 9.3781, meanPerSeed: 9.41, minPerSeed: 8.9123, maxPerSeed: 9.8765, band: [6, 12], gated: true, status: "PASS" }],
      gatedRows: [{ profileType: "mountain", n: 3, value: 9.3781, band: [6, 12], gated: true, status: "PASS" }],
      allPass: true,
    },
    rates: summarizeRates(acc),
    perf: [{ fieldSize: 180, summary: summarizeTimings([{ ms: 12.4, stageNumber: 1, profileType: "mountain" }]) }],
    infraTests: [{ file: "backend/lib/x.test.js", ...parseTap("ok 1 - kill-switch virker\n# tests 1\n# pass 1\n# fail 0") }],
  };
}

test("hard rule 17: den OFFENTLIGE blok indeholder ingen maalte vaerdier, rater eller baand", () => {
  const block = renderPublicBlock(syntheticResult());
  assert.ok(block.startsWith(START_MARKER));
  assert.ok(block.endsWith(END_MARKER));
  // Anker-vaerdier (som RULES §7b-formatteren ville vise dem), spaend og baand.
  for (const forbidden of ["62.3", "37.1", "58.8", "66.1", "203", "108.7", "187", "219", "25.0%", "40.0%", "180-240", "9.38", "8.91", "9.88", "6-12"]) {
    assert.ok(!block.includes(forbidden), `offentlig blok laekker "${forbidden}"`);
  }
  // Ingen procent-tal fra maalingerne (rater er private). NB: de syntetiske
  // anker-navne her har ingen procent; de aegte navne fra headToHeadAnchors.js
  // gengives ordret, som i RULES §7b, og er ikke maalinger.
  assert.doesNotMatch(block, /\d\s*%/u);
  // Men dommene, seed-taellingerne og ydelsen ER der.
  assert.match(block, /Felt-favoritters win-rate \| PASS \| 4\/5 \| \*\*FAIL\*\* \| 0\/5 \|/u);
  assert.match(block, /\| 180 \| 1 \| 12 ms/u);
  assert.match(block, /OTL forekommer:\*\* ja \(etapetyper: mountain\)/u);
  assert.match(block, /Kill-switch samlet:\*\* groen/u);
  assert.match(block, /IKKE OPFYLDT/u);
});

test("den PRIVATE fil har tallene (middel, spaend, baand, rater)", () => {
  const priv = renderPrivateReport(syntheticResult());
  assert.match(priv, /62\.3 %/u);
  assert.match(priv, /58\.8 %-66\.1 %/u);
  assert.match(priv, /25\.0%-40\.0%/u);
  assert.match(priv, /9\.38/u);
  assert.match(priv, /4\.110 %/u, "OTL-rate pr. type (3 af 73)");
});

test("replaceBlock bevarer prosaen uden for markoererne og kraever begge markoerer", () => {
  const doc = `# Titel\n\nProsa foer.\n\n${START_MARKER}\ngammel\n${END_MARKER}\n\nProsa efter.\n`;
  const out = replaceBlock(doc, `${START_MARKER}\nny\n${END_MARKER}`);
  assert.equal(out, `# Titel\n\nProsa foer.\n\n${START_MARKER}\nny\n${END_MARKER}\n\nProsa efter.\n`);
  assert.equal(replaceBlock("ingen markoerer", "x"), null);
});

// ── Ende-til-ende paa det lille syntetiske eksempel-input ────────────────────

test("measureHeadToHead + runPerf koerer ende-til-ende paa eksempel-input (deterministisk)", () => {
  const population = JSON.parse(readFileSync(join(FIXTURE_DIR, "population.json"), "utf8"));
  const stagesFile = JSON.parse(readFileSync(join(FIXTURE_DIR, "stages.json"), "utf8"));
  const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;

  const first = measureHeadToHead({ population, stages, seeds: ["t1", "t2"], fieldSize: null });
  const second = measureHeadToHead({ population, stages, seeds: ["t1", "t2"], fieldSize: null });
  assert.deepEqual(first, second, "samme input -> samme rapport");
  assert.equal(first.anchors.seedCount, 2);
  assert.ok(first.anchors.rows.length > 0);
  assert.equal(first.rates.total.stages, stages.length * 2);
  assert.equal(first.rates.total.riderStarts, stages.length * 2 * population.riders.length);

  const perf = runPerf({ population, stages, fieldSizes: [population.riders.length] });
  assert.equal(perf.length, 1);
  assert.equal(perf[0].summary.n, stages.length);
  assert.equal(perf[0].summary.verdict, "PASS");
});

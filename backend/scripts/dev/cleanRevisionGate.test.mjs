import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FROZEN_TEST_FILES,
  TRACK_TEST_FILES,
  assembleVerdict,
  exitCodeFor,
  judgeAnchorsJson,
  judgeTourJson,
  main,
  makeStep,
  parseArgs,
  renderMarkdown,
  runGate,
} from "./cleanRevisionGate.mjs";

const pass = { status: "PASS", reasons: [] };
const allPass = { 1: pass, 2: pass, 3: pass, 4: pass, 5: pass };

test("alle fem trin PASS giver GREEN og exit 0", () => {
  const r = assembleVerdict(allPass);
  assert.equal(r.verdict, "GREEN");
  assert.equal(r.steps.length, 5);
  assert.deepEqual(r.steps.map((s) => s.id), [1, 2, 3, 4, 5]);
  assert.equal(exitCodeFor(r), 0);
});

test("ét FAIL giver RED og exit 1", () => {
  const r = assembleVerdict({ ...allPass, 3: { status: "FAIL", reasons: ["anker x"] } });
  assert.equal(r.verdict, "RED");
  assert.equal(r.steps[2].status, "FAIL");
  assert.deepEqual(r.steps[2].reasons, ["anker x"]);
  assert.equal(exitCodeFor(r), 1);
});

test("et trin uden data er FAIL, aldrig groent", () => {
  const { 4: _gone, ...missing } = allPass;
  const r = assembleVerdict(missing);
  assert.equal(r.verdict, "RED");
  assert.equal(r.steps[3].status, "FAIL");
  assert.match(r.steps[3].reasons[0], /ikke maalt/);
  assert.equal(assembleVerdict({}).verdict, "RED");
  assert.equal(assembleVerdict(undefined).verdict, "RED");
});

test("ugyldig eller tom status er FAIL", () => {
  assert.equal(makeStep(1, { status: "OK" }).status, "FAIL");
  assert.equal(makeStep(1, { status: "PASS-ish", reasons: [] }).status, "FAIL");
  assert.equal(makeStep(1, null).status, "FAIL");
  assert.equal(makeStep(1, { status: "FAIL", reasons: [] }).reasons.length, 1);
});

test("parseArgs: defaults og afvisning af ugyldige seeds", () => {
  const o = parseArgs([]);
  assert.equal(o.revision, "official_times_v3");
  assert.equal(o.baseline, "official_times_v2");
  assert.equal(o.seeds, 12);
  assert.equal(parseArgs(["--seeds=3", "--revision=x", "--baseline=y"]).seeds, 3);
  assert.throws(() => parseArgs(["--seeds=0"]));
  assert.throws(() => parseArgs(["--seeds=abc"]));
});

const tourJson = (counts, extra = {}) => ({ runs: [{ revision: "r", summary: { counts, stages: [], classes: [], race: { verdicts: {} }, ...extra } }] });

test("judgeTourJson: PASS/WARN er groent, FAIL, TODO og manglende data er ikke", () => {
  assert.equal(judgeTourJson(tourJson({ PASS: 10, WARN: 2, FAIL: 0, TODO: 0 }), "r", "x").status, "PASS");
  const f = judgeTourJson(tourJson({ PASS: 10, FAIL: 1, TODO: 0 }, { stages: [{ stage: 7, verdicts: { gapTo10: "FAIL" } }] }), "r", "x");
  assert.equal(f.status, "FAIL");
  assert.match(f.reasons.join(" "), /etape 7 gapTo10/);
  assert.equal(judgeTourJson(tourJson({ PASS: 10, FAIL: 0, TODO: 1 }), "r", "x").status, "FAIL");
  assert.equal(judgeTourJson(tourJson({ PASS: 0, WARN: 0, FAIL: 0, TODO: 0 }), "r", "x").status, "FAIL");
  assert.equal(judgeTourJson({ runs: [] }, "r", "x").status, "FAIL");
  assert.equal(judgeTourJson(null, "r", "x").status, "FAIL");
  assert.equal(judgeTourJson(tourJson(undefined), "r", "x").status, "FAIL");
});

const anchors = (rows, over = {}) => ({
  anchors: { rows: rows.map(([id, v]) => ({ id, v4: { verdict: v } })), v4Fail: rows.filter(([, v]) => v === "FAIL").map(([id]) => id), v4NotMeasured: rows.filter(([, v]) => v === "N/A").map(([id]) => id) },
  realisticField: { anchors: [{ id: "t", verdict: "PASS" }] },
  tailGate: { allPass: true },
  ...over,
});

test("judgeAnchorsJson: groent, regression, ikke maalt, hale og baseline", () => {
  const base = anchors([["a", "PASS"], ["b", "PASS"]]);
  assert.equal(judgeAnchorsJson(anchors([["a", "PASS"], ["b", "PASS"]]), base, "n", "o").status, "PASS");
  const regress = judgeAnchorsJson(anchors([["a", "PASS"], ["b", "FAIL"]]), base, "n", "o");
  assert.equal(regress.status, "FAIL");
  assert.match(regress.reasons.join(" "), /regression/);
  assert.equal(judgeAnchorsJson(anchors([["a", "N/A"]]), base, "n", "o").status, "FAIL");
  assert.equal(judgeAnchorsJson(anchors([["a", "PASS"]], { tailGate: { allPass: false } }), base, "n", "o").status, "FAIL");
  assert.equal(judgeAnchorsJson(anchors([["a", "PASS"]], { realisticField: null }), base, "n", "o").status, "FAIL");
  assert.equal(judgeAnchorsJson(anchors([["a", "PASS"]]), null, "n", "o").status, "FAIL");
  assert.equal(judgeAnchorsJson({}, base, "n", "o").status, "FAIL");
});

function fakeDeps({ existing = new Set(), known = true, nodeStatus = 0, testFiles = [], texts = {}, jsons = {} } = {}) {
  const calls = [];
  const deps = {
    root: "/r",
    backend: "/r/backend",
    abs: (p) => `/r/${p}`,
    cachePath: "/r/cache.json",
    exists: (p) => existing.has(String(p).replaceAll("\\", "/")),
    readJson: (p) => {
      if (!(p.replaceAll("\\", "/") in jsons)) throw new Error(`mangler ${p}`);
      return jsons[p.replaceAll("\\", "/")];
    },
    readText: (p) => texts[String(p).replaceAll("\\", "/")] ?? "",
    stamp: () => "t",
    runNode: (args) => {
      calls.push(args);
      return { status: nodeStatus, stdout: "", stderr: "fejl", error: null };
    },
    listTestFiles: () => testFiles,
    latestJson: () => null,
    revisionKnown: () => known,
  };
  return { deps, calls };
}

test("runGate: intet findes og revisionen er ukendt -> RED, alle fem trin FAIL", () => {
  const { deps, calls } = fakeDeps({ known: false });
  const r = runGate({ opts: parseArgs([]), deps });
  assert.equal(r.verdict, "RED");
  assert.equal(r.steps.length, 5);
  assert.ok(r.steps.every((s) => s.status === "FAIL"));
  assert.equal(calls.length, 0, "ingen vaerktoejer koeres naar testfilerne mangler");
  assert.match(r.steps[0].reasons[0], /RACE_RULES_REVISIONS/);
});

test("runGate: manglende testfil er FAIL selv naar de andre bestaar", () => {
  const present = new Set(TRACK_TEST_FILES.slice(1).map((f) => `/r/backend/${f}`));
  const { deps, calls } = fakeDeps({ existing: present, known: false });
  const r = runGate({ opts: parseArgs([]), deps });
  assert.equal(r.steps[1].status, "FAIL");
  assert.equal(r.steps[1].reasons.filter((x) => /findes ikke/.test(x)).length, 1);
  assert.equal(calls.length, 1, "de eksisterende koeres alligevel");
});

test("runGate: step 2, 4 og 5 PASS naar testene findes og node --test er groen", () => {
  const files = new Set([...TRACK_TEST_FILES, ...FROZEN_TEST_FILES, "lib/engine/v4/mono.test.ts"].map((f) => `/r/backend/${f}`));
  const { deps } = fakeDeps({ existing: files, known: false, testFiles: ["mono.test.ts"], texts: { "/r/backend/lib/engine/v4/mono.test.ts": "// monotoni" } });
  const r = runGate({ opts: parseArgs([]), deps });
  assert.deepEqual(r.steps.map((s) => s.status), ["FAIL", "PASS", "FAIL", "PASS", "PASS"]);
  assert.equal(r.verdict, "RED");
});

test("runGate: failende node --test og ingen monotoni-tests er FAIL", () => {
  const files = new Set(FROZEN_TEST_FILES.map((f) => `/r/backend/${f}`));
  const { deps } = fakeDeps({ existing: files, nodeStatus: 1, testFiles: [], known: false });
  const r = runGate({ opts: parseArgs([]), deps });
  assert.equal(r.steps[4].status, "FAIL");
  assert.match(r.steps[4].reasons[0], /node --test fejlede/);
  assert.equal(r.steps[3].status, "FAIL");
  assert.match(r.steps[3].reasons[0], /ingen monotoni-tests/);
});

test("runGate: et trin der kaster bliver FAIL i stedet for at vaelte svaret", () => {
  const { deps } = fakeDeps();
  deps.listTestFiles = () => {
    throw new Error("boom");
  };
  const r = runGate({ opts: parseArgs([]), deps });
  assert.equal(r.steps[3].status, "FAIL");
  assert.match(r.steps[3].reasons[0], /boom/);
  assert.equal(r.steps.length, 5);
});

test("runGate: GREEN naar alle vaerktoejer er groenne", () => {
  const exists = new Set(["/r/backend/scripts/dev/tourDryRun.mjs", "/r/backend/scripts/dev/descentFinish6200.mjs", "/r/backend/scripts/v4FlipReadiness.mjs", "/r/cache.json", "/r/balance-internals/clean-revision/run-t/descent.md", "/r/balance-internals/clean-revision/run-t/anchors-revision.json", "/r/balance-internals/clean-revision/run-t/anchors-baseline.json"]);
  for (const f of [...TRACK_TEST_FILES, ...FROZEN_TEST_FILES, "lib/engine/v4/mono.test.ts"]) exists.add(`/r/backend/${f}`);
  const good = anchors([["a", "PASS"]]);
  const { deps } = fakeDeps({
    existing: exists,
    testFiles: ["mono.test.ts"],
    texts: { "/r/backend/lib/engine/v4/mono.test.ts": "monotoni" },
    jsons: {
      "/r/tour.json": { runs: [{ revision: "official_times_v3", summary: { counts: { PASS: 3, WARN: 0, FAIL: 0, TODO: 0 }, stages: [], classes: [], race: { verdicts: {} } } }] },
      "/r/balance-internals/clean-revision/run-t/anchors-revision.json": good,
      "/r/balance-internals/clean-revision/run-t/anchors-baseline.json": good,
    },
  });
  deps.latestJson = () => "/r/tour.json";
  const r = runGate({ opts: parseArgs([]), deps });
  assert.deepEqual(r.steps.map((s) => [s.id, s.status, s.reasons]), [1, 2, 3, 4, 5].map((id) => [id, "PASS", []]));
  assert.equal(r.verdict, "GREEN");
  assert.equal(exitCodeFor(r), 0);
});

test("renderMarkdown viser verdict og aarsager uden at kaste", () => {
  const md = renderMarkdown(assembleVerdict({ ...allPass, 2: { status: "FAIL", reasons: ["mangler fil"] } }), "nu");
  assert.match(md, /RED/);
  assert.match(md, /mangler fil/);
});

test("main: skriver rapport og returnerer exit 1 ved RED (injicerede afhaengigheder)", async () => {
  const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "gate-"));
  try {
    const { deps } = fakeDeps({ known: false });
    deps.abs = (p) => path.join(dir, p);
    const origLog = console.log;
    const origErr = console.error;
    console.log = () => {};
    console.error = () => {};
    let res;
    try {
      res = main([], deps);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    assert.equal(res.exitCode, 1);
    assert.equal(res.report.verdict, "RED");
    assert.ok(existsSync(path.join(dir, "balance-internals/clean-revision")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

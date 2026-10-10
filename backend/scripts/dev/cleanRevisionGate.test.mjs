import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FROZEN_TEST_FILES,
  TRACK_TEST_FILES,
  assembleVerdict,
  exitCodeFor,
  judgeAnchorsJson,
  judgeDescentReport,
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

// #6442: de primaere tidsanker-raekker i det realistiske felt (gaten for tidsankrene).
const realisticPrimary = (over = {}) => [
  { id: "t", verdict: "PASS" },
  { id: "mountain_top10_spread", subset: "favorites", verdict: over.mountain ?? "PASS" },
  { id: "short_uphill_finish_gaps", subset: "favorites", verdict: over.short ?? "PASS" },
  { id: "mountain_top10_spread", subset: "all", verdict: over.mountainAll ?? "PASS" },
  { id: "short_uphill_finish_gaps", subset: "all", verdict: over.shortAll ?? "PASS" },
  { id: "gt_winner_margin", subset: "gc", verdict: over.gt ?? "PASS" },
];

const anchors = (rows, over = {}) => ({
  anchors: { rows: rows.map(([id, v]) => ({ id, v4: { verdict: v } })), v4Fail: rows.filter(([, v]) => v === "FAIL").map(([id]) => id), v4NotMeasured: rows.filter(([, v]) => v === "N/A").map(([id]) => id) },
  realisticField: { anchors: realisticPrimary() },
  tailGate: { allPass: true },
  ...over,
});

test("#6442 judgeAnchorsJson: tidsankrene doemmes i det realistiske felt; proxy og 'alle etaper' er info", () => {
  const base = anchors([["a", "PASS"], ["short_uphill_finish_gaps", "FAIL"], ["gt_winner_margin", "N/A"]]);
  // Den situation gate trin 3 stod i: proxy-felt FAIL/ikke maalt paa tidsankrene, 1b's
  // "alle etaper" FAIL (udbrudssejre), men de primaere raekker PASS. Foer #6442: FAIL.
  const cur = anchors([["a", "PASS"], ["short_uphill_finish_gaps", "FAIL"], ["gt_winner_margin", "N/A"], ["mountain_top10_spread", "FAIL"]], {
    realisticField: { anchors: realisticPrimary({ shortAll: "FAIL", mountainAll: "FAIL" }) },
  });
  const ok = judgeAnchorsJson(cur, base, "n", "o");
  assert.equal(ok.status, "PASS", ok.reasons.join(" | "));
  assert.match(ok.notes.join(" "), /short_uphill_finish_gaps=FAIL/);
  assert.match(ok.notes.join(" "), /short_uphill_finish_gaps\/all=FAIL/);

  // Den primaere raekke er gaten: FAIL eller manglende = FAIL ("ikke maalt" er aldrig groent).
  const shortFail = judgeAnchorsJson(anchors([["a", "PASS"]], { realisticField: { anchors: realisticPrimary({ short: "FAIL" }) } }), base, "n", "o");
  assert.equal(shortFail.status, "FAIL");
  assert.match(shortFail.reasons.join(" "), /short_uphill_finish_gaps\/favorites=FAIL/);
  const gtMissing = judgeAnchorsJson(anchors([["a", "PASS"]], { realisticField: { anchors: realisticPrimary().filter((x) => x.id !== "gt_winner_margin") } }), base, "n", "o");
  assert.equal(gtMissing.status, "FAIL");
  assert.match(gtMissing.reasons.join(" "), /gt_winner_margin\/gc mangler/);
  const gtNa = judgeAnchorsJson(anchors([["a", "PASS"]], { realisticField: { anchors: realisticPrimary({ gt: "N/A" }) } }), base, "n", "o");
  assert.equal(gtNa.status, "FAIL");

  // Et ikke-tidsanker i proxy-feltet gater stadig.
  assert.equal(judgeAnchorsJson(anchors([["field_cohesion_flat", "FAIL"]]), base, "n", "o").status, "FAIL");

  // Regression i en gatende realistisk raekke mod baseline er FAIL, selvom den er
  // en "FAIL" mod sit eget baand allerede ville fange det: baseline-sammenligningen
  // skal ogsaa se den.
  const baseRf = anchors([["a", "PASS"]]);
  const regress = judgeAnchorsJson(anchors([["a", "PASS"]], { realisticField: { anchors: realisticPrimary({ mountain: "FAIL" }) } }), baseRf, "n", "o");
  assert.match(regress.reasons.join(" "), /regression mod o .*realistisk mountain_top10_spread\/favorites/);
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

function descentMd(rows) {
  const lines = ["# #6200", "", "## Kontrakten pr. seed (ejer 5/10)", "", "| Revision | Etape | Seed | Udbrud vandt | Nr. 10 lukket / loft | Loft | Nr. 10 (60-150 s) | Klatrer-brud (vaerste s) | Placering | Samlet |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const [rev, stage, seed, samlet] of rows) lines.push(`| ${rev} | ${stage} | ${seed} | nej | 0 / 10 | PASS | 90 PASS | 0 (0) PASS; forklaret 0 | 0 PASS | ${samlet} |`);
  lines.push("", "## Kontrakten pr. revision og etape (antal seeds)", "", "| Revision | Etape | Seeds | Loft PASS | Nr. 10 PASS / FAIL / N/A | Klatrer PASS | Placering PASS | Samlet PASS |", "|---|---|---|---|---|---|---|---|", "| official_times_v3 | 7 | 1 | 1 | 1 / 0 / 0 | 1 | 1 | 1 |");
  return lines.join("\n");
}

test("judgeDescentReport: kontraktbrud i revisionen er FAIL, baseline-brud ignoreres", () => {
  const md = descentMd([["official_times_v3", 7, 1, "PASS"], ["official_times_v3", 7, 2, "FAIL"], ["official_times_v2", 7, 1, "FAIL"]]);
  const r = judgeDescentReport(md, "official_times_v3");
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0], /kontrakten brydes.*etape 7 seed 2/);
});

test("judgeDescentReport: ingen raekker for revisionen er ikke maalt (FAIL)", () => {
  assert.match(judgeDescentReport(descentMd([["official_times_v2", 7, 1, "PASS"]]), "official_times_v3").reasons[0], /ikke maalt/);
  assert.equal(judgeDescentReport("", "official_times_v3").reasons.length, 1);
});

test("runGate: descent koerer OK (exit 0, rapport findes) men kontrakten fejler -> trin 1 FAIL og RED", () => {
  const exists = new Set(["/r/backend/scripts/dev/tourDryRun.mjs", "/r/backend/scripts/dev/descentFinish6200.mjs", "/r/cache.json", "/r/balance-internals/clean-revision/run-t/descent.md"]);
  const { deps } = fakeDeps({
    existing: exists,
    texts: { "/r/balance-internals/clean-revision/run-t/descent.md": descentMd([["official_times_v3", 7, 3, "FAIL"]]) },
    jsons: { "/r/tour.json": { runs: [{ revision: "official_times_v3", summary: { counts: { PASS: 3, WARN: 0, FAIL: 0, TODO: 0 }, stages: [], classes: [], race: { verdicts: {} } } }] } },
  });
  deps.latestJson = () => "/r/tour.json";
  const r = runGate({ opts: parseArgs([]), deps });
  assert.equal(r.steps[0].status, "FAIL");
  assert.ok(r.steps[0].reasons.some((x) => /D1\/D3: kontrakten brydes/.test(x)));
  assert.equal(r.verdict, "RED");
});

test("runGate: GREEN naar alle vaerktoejer er groenne", () => {
  const exists = new Set(["/r/backend/scripts/dev/tourDryRun.mjs", "/r/backend/scripts/dev/descentFinish6200.mjs", "/r/backend/scripts/v4FlipReadiness.mjs", "/r/cache.json", "/r/balance-internals/clean-revision/run-t/descent.md", "/r/balance-internals/clean-revision/run-t/anchors-revision.json", "/r/balance-internals/clean-revision/run-t/anchors-baseline.json"]);
  for (const f of [...TRACK_TEST_FILES, ...FROZEN_TEST_FILES, "lib/engine/v4/mono.test.ts"]) exists.add(`/r/backend/${f}`);
  const good = anchors([["a", "PASS"]]);
  const { deps } = fakeDeps({
    existing: exists,
    testFiles: ["mono.test.ts"],
    texts: { "/r/backend/lib/engine/v4/mono.test.ts": "monotoni", "/r/balance-internals/clean-revision/run-t/descent.md": descentMd([["official_times_v3", 7, 1, "PASS"]]) },
    jsons: {
      "/r/tour.json": { runs: [{ revision: "official_times_v3", summary: { counts: { PASS: 3, WARN: 0, FAIL: 0, TODO: 0 }, stages: [], classes: [], race: { verdicts: {} } } }] },
      "/r/balance-internals/clean-revision/run-t/anchors-revision.json": good,
      "/r/balance-internals/clean-revision/run-t/anchors-baseline.json": good,
    },
  });
  deps.latestJson = () => "/r/tour.json";
  const r = runGate({ opts: parseArgs([]), deps });
  // #6442: trin 3 kan baere info-noter (ikke-gatende raekker), aldrig andre aarsager.
  assert.deepEqual(r.steps.map((s) => [s.id, s.status, s.reasons.filter((x) => !x.startsWith("info: "))]), [1, 2, 3, 4, 5].map((id) => [id, "PASS", []]));
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

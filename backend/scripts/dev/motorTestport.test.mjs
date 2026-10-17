// #6750: motor-testportens CLI, opgaveplan og parallelle pulje (uden motor og uden prod).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertPrivateOutDir, assertSameRaceSelection, collectCard, loadThresholds, latestDryRunJson, resolveReportThresholds, main, parseArgs, parseIdsText, planTasks, raceIdsFromDir, runPool, selectRaceIds, tourDryRunArgs } from "./motorTestport.mjs";

/** Et syntetisk tourDryRun-scorecard (ingen motor-tal). */
const scorecard = (id, revision) => JSON.stringify({
  race: { id, name: `Loeb ${id}`, stages: 1 },
  runs: [{ revision, seeds: 1, perSeed: [{ seed: 1, rows: [] }], summary: { counts: { PASS: 1, WARN: 0, FAIL: 0, TODO: 0, "N/A": 0 }, stages: [], classes: [], race: { verdicts: {} } } }],
});

const NOW = new Date("2026-10-17T10:00:00Z");

test("parseArgs: defaults (8 seeds, 4 parallelle, bench all, out = balance-internals/<issue>/<dato>)", () => {
  const o = parseArgs(["--candidate=cand"], { defaultBaseline: "base", now: NOW });
  assert.equal(o.candidate, "cand");
  assert.equal(o.baseline, "base");
  assert.equal(o.seeds, 8);
  assert.equal(o.parallel, 4);
  assert.equal(o.bench, true);
  assert.equal(o.benchScope, "all");
  assert.equal(o.out, path.join("balance-internals", "6750", "2026-10-17"));
  assert.equal(o.limit, null);
  assert.equal(o.png, true);
});

test("parseArgs: flag og fejl", () => {
  const o = parseArgs(["--candidate=c", "--baseline=b", "--seeds=3", "--parallel=6", "--limit=5", "--races=a, b,,c", "--no-bench", "--issue=6367", "--no-png", "--include-running"], { now: NOW });
  assert.deepEqual(o.raceIds, ["a", "b", "c"]);
  assert.equal(o.limit, 5);
  assert.equal(o.parallel, 6);
  assert.equal(o.bench, false);
  assert.equal(o.png, false);
  assert.equal(o.includeRunning, true);
  assert.equal(o.out, path.join("balance-internals", "6367", "2026-10-17"));
  assert.throws(() => parseArgs([], { defaultBaseline: "b" }), /--candidate/);
  assert.throws(() => parseArgs(["--candidate=c"], { defaultBaseline: null }), /--baseline/);
  assert.throws(() => parseArgs(["--candidate=c", "--seeds=0"], { defaultBaseline: "b" }), /--seeds/);
  assert.throws(() => parseArgs(["--candidate=c", "--bench-scope=x"], { defaultBaseline: "b" }), /bench-scope/);
  assert.throws(() => parseArgs(["--candidate=c", "--issue=../x"], { defaultBaseline: "b" }), /--issue/);
  assert.equal(parseArgs(["--bench-worker", "--revision=r", "--scope=gt"]).benchScope, "gt");
});

test("ids: fil-tekst, dedup og limit", () => {
  assert.deepEqual(parseIdsText("a\r\nb c # kommentar\n\n# alt\nd,e\n"), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(selectRaceIds(["a", "b", "a", " c ", ""], 2), ["a", "b"]);
  assert.deepEqual(selectRaceIds(["a", "b"]), ["a", "b"]);
});

test("tourDryRunArgs: begge revisioner, samme revision = --compare=none, eksport uden --save-cache", () => {
  const a = tourDryRunArgs({ raceId: "r", candidate: "c", baseline: "b", seeds: 8, raceDir: "D", cachePath: "C" });
  assert.ok(a.includes("--revision=c") && a.includes("--compare=b") && a.includes("--seeds=8") && a.includes("--no-legacy-ref"));
  assert.ok(a.includes("--cache=C") && a.includes("--save-cache=C") && a.includes("--out-dir=D"));
  const same = tourDryRunArgs({ raceId: "r", candidate: "s", baseline: "s", seeds: 1, raceDir: "D", cachePath: "C", saveCache: false });
  assert.ok(same.includes("--compare=none"));
  assert.ok(!same.some((x) => x.startsWith("--save-cache")));
});

test("planTasks + raceIdsFromDir + latestDryRunJson paa en midlertidig mappe", () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-"));
  try {
    const exp = path.join(root, "export");
    for (const id of ["r2", "r1"]) { mkdirSync(path.join(exp, id), { recursive: true }); writeFileSync(path.join(exp, id, "cache.json"), "{}"); }
    mkdirSync(path.join(exp, "uden-cache"), { recursive: true });
    assert.deepEqual(raceIdsFromDir(exp), ["r1", "r2"]);

    const out = path.join(root, "out");
    mkdirSync(path.join(out, "races", "r1"), { recursive: true });
    writeFileSync(path.join(out, "races", "r1", "done"), "x");
    const opts = { candidate: "c", baseline: "b", seeds: 2, bench: true, benchOnly: false, benchScope: "all" };
    const tasks = planTasks({ raceIds: ["r1", "r2", "r3"], opts, outDir: out, fromDir: exp });
    assert.deepEqual(tasks.map((t) => [t.id, t.done]), [["r1", true], ["r2", false], ["r3", false], ["bench:b", false], ["bench:c", false]]);
    assert.ok(tasks[1].args.includes(`--cache=${path.join(exp, "r2", "cache.json")}`), "eksportens cache laeses");
    assert.ok(!tasks[1].args.some((x) => x.startsWith("--save-cache")), "eksporten overskrives ikke");
    assert.ok(tasks[2].args.includes(`--save-cache=${path.join(out, "races", "r3", "cache.json")}`), "uden eksport: hent og gem i loebsmappen");
    assert.deepEqual(planTasks({ raceIds: ["r1"], opts: { ...opts, candidate: "b" }, outDir: out }).filter((t) => t.kind === "bench").map((t) => t.id), ["bench:b"]);
    assert.deepEqual(planTasks({ raceIds: ["r1"], opts: { ...opts, benchOnly: true }, outDir: out }).map((t) => t.kind), ["bench", "bench"]);

    const dir = path.join(out, "races", "r1");
    assert.equal(latestDryRunJson(path.join(out, "races", "mangler")), null);
    writeFileSync(path.join(dir, "cache.json"), "{}");
    assert.equal(latestDryRunJson(dir), null, "cache.json er ikke et scorecard");
    writeFileSync(path.join(dir, "loeb-2026-10-17-07-00.json"), "{}");
    writeFileSync(path.join(dir, "loeb-2026-10-17-08-00.json"), "{}");
    utimesSync(path.join(dir, "loeb-2026-10-17-07-00.json"), new Date(1000), new Date(1000));
    assert.equal(path.basename(latestDryRunJson(dir)), "loeb-2026-10-17-08-00.json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertPrivateOutDir: kun under en balance-internals-mappe (hard rule 17)", () => {
  assert.doesNotThrow(() => assertPrivateOutDir(path.join("x", "balance-internals", "6750", "d")));
  assert.throws(() => assertPrivateOutDir(path.join("docs", "6750")), /balance-internals/);
  assert.throws(() => assertPrivateOutDir(path.join("x", "balance-internals-kopi", "d")), /balance-internals/);
});

test("collectCard: forventet loeb uden laesbart scorecard er en fejl, bench laeses for den koerte scope", () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-"));
  try {
    const out = path.join(root, "balance-internals", "run");
    for (const id of ["ok", "broken", "empty"]) mkdirSync(path.join(out, "races", id), { recursive: true });
    writeFileSync(path.join(out, "ids.txt"), "ok\nbroken\nempty\nnever\n");
    writeFileSync(path.join(out, "races", "ok", "loeb-2026-10-17-08-00.json"), scorecard("ok", "rev"));
    writeFileSync(path.join(out, "races", "broken", "loeb-2026-10-17-08-00.json"), "{ikke json");
    writeFileSync(path.join(out, "races", "broken", "done"), "x");
    mkdirSync(path.join(out, "bench", "rev"), { recursive: true });
    writeFileSync(path.join(out, "bench", "rev", "motor-bench-gate.json"), JSON.stringify({ config: { revision: "rev" }, scope: "gate", summary: { gate: {}, all: {} } }));
    const card = collectCard({ outDir: out, baseline: "rev", candidate: "rev", meta: { benchScope: "all" } });
    assert.equal(card.races, 1);
    assert.deepEqual(card.meta.missingScorecards.map((s) => s.split(" ")[0]).sort(), ["broken", "empty", "never"]);
    assert.equal(card.bench.baseline, null, "en gate-bench vises ikke som all-scope");
    assert.equal(collectCard({ outDir: out, baseline: "rev", candidate: "rev", meta: { benchScope: "gate" } }).bench.baseline.scope, "gate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("main --report-only: bruger koerslens gemte parametre og roerer ikke meta-filen", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-"));
  const prevExit = process.exitCode;
  try {
    const out = path.join(root, "balance-internals", "run");
    mkdirSync(path.join(out, "races", "a"), { recursive: true });
    const meta = { candidate: "rev", baseline: "rev", seeds: 3, parallel: 2, source: "--races", limit: null, benchScope: "all", failedRaces: ["b"] };
    writeFileSync(path.join(out, "testport-meta.json"), JSON.stringify(meta, null, 2));
    writeFileSync(path.join(out, "races", "a", "loeb-2026-10-17-08-00.json"), scorecard("a", "rev"));
    const metaBefore = readFileSync(path.join(out, "testport-meta.json"), "utf8");
    const { card } = await main(["--report-only", `--out=${out}`, "--no-png"]);
    assert.equal(card.meta.seeds, 3);
    assert.deepEqual(card.meta.failedRaces, ["b"]);
    assert.equal(readFileSync(path.join(out, "testport-meta.json"), "utf8"), metaBefore);
    assert.match(readFileSync(path.join(out, "testport.md"), "utf8"), /3 seeds pr\. revision/);
    assert.equal(process.exitCode, 1, "en tidligere fejlet opgave giver stadig exit 1");
    await assert.rejects(() => main(["--candidate=x", "--baseline=y", `--out=${path.join(root, "offentlig")}`, "--no-png"]), /balance-internals/);
    await assert.rejects(() => main(["--candidate=rev", "--baseline=rev", "--seeds=3", "--bench-scope=gate", `--out=${out}`, "--no-png"]), /anden koersel/);
  } finally {
    process.exitCode = prevExit;
    rmSync(root, { recursive: true, force: true });
  }
});

test("runPool: hoejst `parallel` ad gangen, fejl stopper ikke de andre", async () => {
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}` }));
  const res = await runPool(tasks, 4, async (t) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    if (t.id === "t3") throw new Error("boom");
    return t.id === "t5" ? 2 : 0;
  });
  assert.equal(peak, 4);
  assert.deepEqual(res.failed.sort(), ["t3", "t5"]);
  assert.equal(res.ok.length, 7);
  assert.deepEqual(await runPool([], 4, async () => 0), { ok: [], failed: [] });
});

test("#6750: en output-mappe afviser en anden loebsudvaelgelse, men tillader genoptagelse", () => {
  assert.doesNotThrow(() => assertSameRaceSelection([], ["a"], "out"));
  assert.doesNotThrow(() => assertSameRaceSelection(["a", "b"], ["b", "a"], "out"));
  assert.throws(() => assertSameRaceSelection(["a"], ["b"], "out"), /anden loebsudvaelgelse/);
  assert.throws(() => assertSameRaceSelection(["a", "b"], ["a"], "out"), /anden loebsudvaelgelse/);
});

test("#6750: taerskler laeses fra privat fil; mangler den, er de tomme", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "testport-thr-"));
  try {
    assert.deepEqual(loadThresholds(path.join(dir, "findes-ikke.json")), {});
    const file = path.join(dir, "t.json");
    writeFileSync(file, JSON.stringify({ bigBreakawayWinSeconds: 120 }));
    assert.deepEqual(loadThresholds(file), { bigBreakawayWinSeconds: 120 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#6777: meta gemmer taerskelfil + snapshot, og --report-only genbruger snapshottet", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-thr2-"));
  const prevExit = process.exitCode;
  try {
    const out = path.join(root, "balance-internals", "run");
    const thrFile = path.join(root, "t.json");
    writeFileSync(thrFile, JSON.stringify({ bigBreakawayWinSeconds: 111 }));
    // ingen opgaver (--bench-only --no-bench): kun meta + kort
    await main(["--candidate=rev", "--baseline=rev", "--bench-only", "--no-bench", `--thresholds=${thrFile}`, `--out=${out}`, "--no-png"]);
    const meta = JSON.parse(readFileSync(path.join(out, "testport-meta.json"), "utf8"));
    assert.equal(meta.thresholdsFile, thrFile);
    assert.deepEqual(meta.thresholds, { bigBreakawayWinSeconds: 111 });
    // filen aendres/forsvinder: --report-only bruger stadig snapshottet
    writeFileSync(thrFile, JSON.stringify({ bigBreakawayWinSeconds: 999 }));
    const { card } = await main(["--report-only", `--out=${out}`, "--no-png"]);
    assert.equal(card.thresholds.bigBreakawayWinSeconds, 111);
    // genoptagelse (samme koersel) overskriver ikke snapshottet
    await main(["--candidate=rev", "--baseline=rev", "--bench-only", "--no-bench", `--out=${out}`, "--no-png"]);
    assert.deepEqual(JSON.parse(readFileSync(path.join(out, "testport-meta.json"), "utf8")).thresholds, { bigBreakawayWinSeconds: 111 });
    // eksplicit --thresholds vinder
    const again = await main(["--report-only", `--thresholds=${thrFile}`, `--out=${out}`, "--no-png"]);
    assert.equal(again.card.thresholds.bigBreakawayWinSeconds, 999);
  } finally {
    process.exitCode = prevExit;
    rmSync(root, { recursive: true, force: true });
  }
});

test("#6777: resolveReportThresholds: snapshot > gemt filsti > default", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "testport-thr3-"));
  try {
    const file = path.join(dir, "gammel.json");
    writeFileSync(file, JSON.stringify({ x: 1 }));
    const opts = { thresholds: path.join(dir, "default-findes-ikke.json"), thresholdsExplicit: false };
    assert.deepEqual(resolveReportThresholds({ thresholds: { y: 2 }, thresholdsFile: file }, opts), { y: 2 });
    assert.deepEqual(resolveReportThresholds({ thresholdsFile: file }, opts), { x: 1 }, "aeldre meta uden snapshot");
    assert.deepEqual(resolveReportThresholds({}, opts), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

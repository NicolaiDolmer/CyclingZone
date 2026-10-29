// #6750: motor-testportens CLI, opgaveplan og parallelle pulje (uden motor og uden prod).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { privateMinCellTeamStages, assertPrivateOutDir, assertSameRaceSelection, assertSameRun, budgetStop, buildReportMeta, collectCard, loadThresholds, latestDryRunJson, resolveReportThresholds, resolveThresholdsFile, main, parseArgs, parseIdsText, planTasks, raceIdsFromDir, runPool, selectRaceIds, splitByStartField, tourDryRunArgs } from "./motorTestport.mjs";

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
    const { card } = await main(["--report-only", `--out=${out}`, "--no-png"], { now: NOW });
    assert.equal(card.generatedAt, NOW.toISOString());
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

test("#6794: main stempler generatedAt fra det injicerede ur (koersel og --report-only), ikke vaeguret", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-clock-"));
  const prevExit = process.exitCode;
  try {
    const out = path.join(root, "balance-internals", "run");
    const first = await main(["--candidate=rev", "--bench-only", "--no-bench", `--out=${out}`, "--no-png"], { now: NOW, defaultBaseline: "rev" });
    assert.equal(first.card.generatedAt, NOW.toISOString());
    assert.equal(first.card.meta.generatedAt, NOW.toISOString());
    const later = new Date("2031-01-02T03:04:05Z");
    const report = await main(["--report-only", `--out=${out}`, "--no-png"], { now: later });
    assert.equal(report.card.generatedAt, later.toISOString());
    assert.equal(JSON.parse(readFileSync(path.join(out, "testport.json"), "utf8")).generatedAt, later.toISOString());
    assert.match(readFileSync(path.join(out, "testport.md"), "utf8"), /Genereret 2031-01-02T03:04:05\.000Z/);
    assert.equal(JSON.parse(readFileSync(path.join(out, "testport-meta.json"), "utf8")).generatedAt, undefined, "meta-filen indeholder intet ur");
  } finally {
    process.exitCode = prevExit;
    rmSync(root, { recursive: true, force: true });
  }
});

test("#6794: clock stempler kortet ved faerdiggoerelse, now styrer kun out-datoen", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-clock2-"));
  const prevExit = process.exitCode;
  try {
    const out = path.join(root, "balance-internals", "run");
    const done = new Date("2026-10-17T12:30:00Z");
    let calls = 0;
    const clock = () => { calls += 1; return done; };
    const { card } = await main(["--candidate=rev", "--bench-only", "--no-bench", `--out=${out}`, "--no-png"], { now: NOW, clock, defaultBaseline: "rev" });
    assert.equal(card.generatedAt, done.toISOString(), "kortet faar faerdig-tiden, ikke starttiden");
    assert.ok(calls >= 1, "uret samples naar kortet bygges");
    assert.equal(parseArgs(["--candidate=c"], { defaultBaseline: "b", now: NOW }).out, path.join("balance-internals", "6750", "2026-10-17"));
  } finally {
    process.exitCode = prevExit;
    rmSync(root, { recursive: true, force: true });
  }
});

test("#6794: --report-only --thresholds=<ny fil> faar matchende in-memory-meta uden at omskrive testport-meta.json", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-thr4-"));
  const prevExit = process.exitCode;
  try {
    const out = path.join(root, "balance-internals", "run");
    const oldFile = path.join(root, "gammel.json");
    const newFile = path.join(root, "ny.json");
    writeFileSync(oldFile, JSON.stringify({ bigBreakawayWinSeconds: 111 }));
    writeFileSync(newFile, JSON.stringify({ bigBreakawayWinSeconds: 222 }));
    await main(["--candidate=rev", "--baseline=rev", "--bench-only", "--no-bench", `--thresholds=${oldFile}`, `--out=${out}`, "--no-png"], { now: NOW });
    const metaPath = path.join(out, "testport-meta.json");
    const metaBefore = readFileSync(metaPath, "utf8");

    // uden --thresholds: kortets meta peger paa den gemte fil og det gemte snapshot
    const kept = await main(["--report-only", `--out=${out}`, "--no-png"], { now: NOW });
    assert.equal(kept.card.meta.thresholdsFile, oldFile);
    assert.deepEqual(kept.card.meta.thresholds, { bigBreakawayWinSeconds: 111 });

    // med ny fil: kortets tal OG meta foelger den nye fil
    const { card } = await main(["--report-only", `--thresholds=${newFile}`, `--out=${out}`, "--no-png"], { now: NOW });
    assert.equal(card.thresholds.bigBreakawayWinSeconds, 222);
    assert.equal(card.meta.thresholdsFile, newFile);
    assert.deepEqual(card.meta.thresholds, card.thresholds);
    const written = JSON.parse(readFileSync(path.join(out, "testport.json"), "utf8"));
    assert.equal(written.meta.thresholdsFile, newFile);
    assert.deepEqual(written.meta.thresholds, { bigBreakawayWinSeconds: 222 });

    // testport-meta.json er uroert (byte for byte)
    assert.equal(readFileSync(metaPath, "utf8"), metaBefore);
  } finally {
    process.exitCode = prevExit;
    rmSync(root, { recursive: true, force: true });
  }
});

test("#6794: buildReportMeta: rent, roerer ikke prev, eksplicit fil vinder", () => {
  const prev = { candidate: "c", thresholdsFile: "gammel.json", thresholds: { a: 1 } };
  const frozen = JSON.stringify(prev);
  const meta = buildReportMeta(prev, { thresholds: "ny.json", thresholdsExplicit: true }, { a: 2 }, NOW);
  assert.deepEqual(meta, { candidate: "c", thresholdsFile: "ny.json", thresholds: { a: 2 }, generatedAt: NOW.toISOString() });
  assert.equal(JSON.stringify(prev), frozen);
  assert.equal(buildReportMeta(prev, { thresholds: "default.json", thresholdsExplicit: false }, { a: 1 }, NOW).thresholdsFile, "gammel.json");
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
  assert.deepEqual(await runPool([], 4, async () => 0), { ok: [], failed: [], pending: [] });
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

test("#6777 (Codex): genoptagelse uden --thresholds beholder den gemte tærskelsti", () => {
  const prev = { thresholdsFile: "balance-internals/custom.json" };
  assert.equal(resolveThresholdsFile(prev, { thresholds: "balance-internals/default.json", thresholdsExplicit: false }), "balance-internals/custom.json");
  assert.equal(resolveThresholdsFile(prev, { thresholds: "balance-internals/ny.json", thresholdsExplicit: true }), "balance-internals/ny.json");
  assert.equal(resolveThresholdsFile(null, { thresholds: "balance-internals/default.json", thresholdsExplicit: false }), "balance-internals/default.json");
});

test("#6805: loeb uden startfelt springes over og taelles, raekkefoelgen bevares", () => {
  assert.deepEqual(splitByStartField(["a", "b", "c", "d"], new Set(["c", "a"])), { ids: ["a", "c"], skippedNoField: 2 });
  assert.deepEqual(splitByStartField([], new Set()), { ids: [], skippedNoField: 0 });
  assert.deepEqual(splitByStartField(["a"], new Set(["a"])), { ids: ["a"], skippedNoField: 0 });
});

test("#6909 parseArgs: --synthetic-field (default generator), --routes-from og --season", () => {
  const o = parseArgs(["--candidate=c", "--synthetic-field", "--routes-from=balance-internals/l3", "--season=5"], { defaultBaseline: "b", now: NOW });
  assert.equal(o.syntheticField, "generator");
  assert.equal(o.routesFrom, "balance-internals/l3");
  assert.equal(o.season, 5);
  assert.equal(parseArgs(["--candidate=c", "--synthetic-field=bench"], { defaultBaseline: "b", now: NOW }).syntheticField, "bench");
  const plain = parseArgs(["--candidate=c"], { defaultBaseline: "b", now: NOW });
  assert.deepEqual([plain.syntheticField, plain.routesFrom, plain.season], [null, null, null]);
  assert.throws(() => parseArgs(["--candidate=c", "--synthetic-field=giro"], { defaultBaseline: "b", now: NOW }), /--synthetic-field/);
  assert.throws(() => parseArgs(["--candidate=c", "--season=0"], { defaultBaseline: "b", now: NOW }), /--season/);
});

test("#6909 planTasks: en forbygget cache i loebsmappen laeses (aldrig eksporten, aldrig --save-cache)", () => {
  const opts = { candidate: "c", baseline: "b", seeds: 1, bench: false, benchOnly: false };
  const [t] = planTasks({ raceIds: ["r1"], opts, outDir: "OUT", fromDir: "EXP", prebuilt: new Set(["r1"]) });
  assert.ok(t.args.includes(`--cache=${path.join("OUT", "races", "r1", "cache.json")}`));
  assert.ok(!t.args.some((x) => x.startsWith("--save-cache")));
});

test("#6909 runPool: tidsbudgettet starter ingen nye opgaver, de koerende goeres faerdige, resten er pending", async () => {
  let started = 0;
  const tasks = ["a", "b", "c", "d"].map((id) => ({ id }));
  const res = await runPool(tasks, 2, async () => { started += 1; return 0; }, { shouldStop: () => started >= 2 });
  assert.deepEqual(res.ok, ["a", "b"]);
  assert.deepEqual(res.pending, ["c", "d"]);
  assert.equal(parseArgs(["--candidate=c", "--time-budget=9"], { defaultBaseline: "b", now: NOW }).timeBudgetMin, 9);
  assert.equal(parseArgs(["--candidate=c"], { defaultBaseline: "b", now: NOW }).timeBudgetMin, null);
});

test("#6909 (Codex): ventende opgaver (fx bench efter tidsbudget) gemmes i meta og goer kortet ufaerdigt, ogsaa i --report-only", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-pending-"));
  const prevExit = process.exitCode;
  try {
    const out = path.join(root, "balance-internals", "run");
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, "testport-meta.json"), JSON.stringify({ candidate: "c", baseline: "b", seeds: 1, benchScope: "all", pendingTasks: ["bench:c"] }));
    process.exitCode = 0;
    const res = await main(["--report-only", `--out=${out}`, "--no-png"], { now: NOW });
    assert.deepEqual(res.card.meta.pendingTasks, ["bench:c"]);
    assert.match(readFileSync(path.join(out, "testport.md"), "utf8"), /UFAERDIG:\*\* tidsbudgettet stoppede koerslen; 1 opgaver er ikke koert: bench:c/);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = prevExit;
    rmSync(root, { recursive: true, force: true });
  }
});

test("#6909 assertSameRun: andet syntetisk felt, rute-mappe eller saeson er en anden koersel", () => {
  const prev = { candidate: "c", baseline: "b", seeds: 2, benchScope: "all", syntheticField: "generator", routesFrom: "r", season: 5 };
  const opts = { ...prev };
  assertSameRun(null, opts, "OUT");
  assertSameRun(prev, opts, "OUT");
  assert.throws(() => assertSameRun(prev, { ...opts, syntheticField: "bench" }, "OUT"), /anden koersel.*syntetisk felt generator/);
  assert.throws(() => assertSameRun(prev, { ...opts, routesFrom: null }, "OUT"), /anden koersel/);
  assert.throws(() => assertSameRun(prev, { ...opts, season: 4 }, "OUT"), /anden koersel/);
  // #6909 (Codex P2): samme mappe, men aendret indhold = anden koersel.
  assert.throws(() => assertSameRun({ ...prev, routesSignature: "aaa" }, { ...opts, routesSignature: "bbb" }, "OUT"), /anden koersel/);
  // Aeldre meta (foer #6909) uden felterne = koersel uden syntetisk felt og ruter.
  assertSameRun({ candidate: "c", baseline: "b", seeds: 2 }, { candidate: "c", baseline: "b", seeds: 2, benchScope: "all", syntheticField: null, routesFrom: null, season: null }, "OUT");
});

test("#6938 assertSameRun: med og uden --track-fatigue er to forskellige koersler; aeldre meta = uden", () => {
  const prev = { candidate: "c", baseline: "b", seeds: 2, benchScope: "all" };
  assertSameRun(prev, { ...prev }, "OUT");
  assertSameRun(prev, { ...prev, trackFatigue: false }, "OUT");
  assert.throws(() => assertSameRun(prev, { ...prev, trackFatigue: true }, "OUT"), /anden koersel/);
  assertSameRun({ ...prev, trackFatigue: true }, { ...prev, trackFatigue: true }, "OUT");
  assert.throws(() => assertSameRun({ ...prev, trackFatigue: true }, { ...prev, trackFatigue: false }, "OUT"), /anden koersel.*med traethed/);
});

test("#6938 main: --track-fatigue gemmes i meta, og samme --out uden flaget afvises", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-fatigue-"));
  const prevExit = process.exitCode;
  try {
    const out = path.join(root, "balance-internals", "run");
    const base = ["--candidate=rev", "--baseline=rev", "--bench-only", "--no-bench", `--out=${out}`, "--no-png"];
    await main([...base, "--track-fatigue"]);
    assert.equal(JSON.parse(readFileSync(path.join(out, "testport-meta.json"), "utf8")).trackFatigue, true);
    await main([...base, "--track-fatigue"]);
    await assert.rejects(() => main(base), /anden koersel/);
  } finally {
    process.exitCode = prevExit;
    rmSync(root, { recursive: true, force: true });
  }
});

test("#6909 main: --from-dir + --routes-from + --synthetic-field=bench bygger cachen og skriver kilderne paa kortet", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-6909-"));
  const prevExit = process.exitCode;
  try {
    const exp = path.join(root, "export");
    const routesDir = path.join(root, "routes");
    const out = path.join(root, "balance-internals", "run");
    const race = (id, entries) => ({ race: { id, name: `Loeb ${id}`, stages: 1 }, profiles: [{ race_id: id, stage_number: 1, profile_type: "mountain" }], entries, orders: [], teams: [{ id: "t1", is_ai: true }], abilities: entries.map((e) => ({ rider_id: e.rider_id })) });
    mkdirSync(routesDir, { recursive: true });
    for (const [id, entries] of [["a", [{ rider_id: "x", team_id: "t1", race_role: "captain" }]], ["b", []]]) {
      mkdirSync(path.join(exp, id), { recursive: true });
      writeFileSync(path.join(exp, id, "cache.json"), JSON.stringify(race(id, entries)));
      writeFileSync(path.join(routesDir, `${id}.json`), JSON.stringify({ format: "cz-race-routes/v1", race_id: id, stages: 1, profiles: [{ stage_number: 1, profile_type: "flat", demand_vector: { sprint: 1 } }] }));
      // Loebene er allerede koert (done + scorecard), saa main starter ingen child-processer.
      mkdirSync(path.join(out, "races", id), { recursive: true });
      writeFileSync(path.join(out, "races", id, "done"), "x");
      writeFileSync(path.join(out, "races", id, `loeb-${id}-2026-10-20-10-00.json`), scorecard(id, "rev"));
    }
    const res = await main(["--candidate=rev", "--no-bench", "--no-png", `--out=${out}`, `--from-dir=${exp}`, `--routes-from=${routesDir}`, "--synthetic-field=bench", "--breakaway-intent=none"], { now: NOW, defaultBaseline: "rev" });
    assert.equal(res.card.races, 2);
    const cacheB = JSON.parse(readFileSync(path.join(out, "races", "b", "cache.json"), "utf8"));
    assert.equal(cacheB.fieldSource, "bench");
    assert.ok(cacheB.entries.length > 0, "bench-feltet");
    assert.equal(cacheB.profiles[0].profile_type, "flat", "den foreslaaede rute");
    const md = readFileSync(path.join(out, "testport.md"), "utf8");
    assert.match(md, /Startfelt: 1 loeb med prod-tilmeldinger · 1 med syntetisk felt \(bench: /);
    assert.match(md, /Ruter: foreslaaede fra routes, 2 loeb/);
    const meta = JSON.parse(readFileSync(path.join(out, "testport-meta.json"), "utf8"));
    assert.deepEqual([meta.syntheticField, meta.routes.races], ["bench", 2]);
    await assert.rejects(main(["--candidate=rev", "--no-bench", "--no-png", `--out=${out}`, `--from-dir=${exp}`, `--routes-from=${routesDir}`], { now: NOW, defaultBaseline: "rev" }), /anden koersel/);
    await assert.rejects(main(["--candidate=rev", "--no-bench", "--no-png", `--out=${path.join(root, "balance-internals", "run2")}`, "--races=a,c", `--routes-from=${routesDir}`], { now: NOW, defaultBaseline: "rev" }), /mangler rute for 1 loeb: c/);
  } finally {
    process.exitCode = prevExit;
    rmSync(root, { recursive: true, force: true });
  }
});

test("#6909 (Codex P1) budgetStop: injiceret monotont ur styrer stop-tidspunktet deterministisk", () => {
  let t = 1_000;
  const stop = budgetStop(2, () => t);
  assert.equal(stop(), false);
  t += 2 * 60_000 - 1;
  assert.equal(stop(), false, "1 ms foer budgettet");
  t += 1;
  assert.equal(stop(), true, "praecis ved budgettet");
  assert.equal(budgetStop(null, () => { throw new Error("uret bruges ikke uden budget"); })(), false);
});

test("#6804 P0 parseArgs: syntetisk felt faar prod-lignende udbrudsvilje som standard", () => {
  const p = (extra) => parseArgs(["--candidate=rev", ...extra], { defaultBaseline: "rev", now: NOW });
  assert.equal(p(["--synthetic-field"]).breakawayIntent, "prod");
  assert.equal(p(["--synthetic-field", "--breakaway-intent=none"]).breakawayIntent, "none");
  assert.equal(p([]).breakawayIntent, "none");
  assert.throws(() => p(["--breakaway-intent=prod"]), /kraever --synthetic-field/);
  assert.throws(() => p(["--synthetic-field", "--breakaway-intent=maaske"]), /prod eller none/);
  assert.equal(p(["--synthetic-field", "--intent-rates=x.json"]).intentRates, "x.json");
  assert.equal(p(["--synthetic-field", "--intent-season=4"]).intentSeason, 4);
  // Review P2: bench-feltet har kun AI-hold; udbrudsvilje er kun standard (og kun tilladt) med generatoren.
  assert.equal(p(["--synthetic-field=bench"]).breakawayIntent, "none");
  assert.throws(() => p(["--synthetic-field=bench", "--breakaway-intent=prod"]), /synthetic-field=generator/);
  assert.throws(() => p(["--synthetic-field", "--intent-season=0"]), /intent-season/);
  assert.equal(p(["--synthetic-field"]).intentSeason, null);
});

test("#6804 P0 main: --from-dir + syntetisk felt kraever satser; med --intent-rates staar de i meta og cachen", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-6804-"));
  const prevExit = process.exitCode;
  try {
    const exp = path.join(root, "export");
    const routesDir = path.join(root, "routes");
    const out = path.join(root, "balance-internals", "run");
    const ratesFile = path.join(root, "rates.json");
    writeFileSync(ratesFile, JSON.stringify({ format: "cz-breakaway-intent-rates/v2", seasonId: "s4", seasonNumber: 3, minCellTeamStages: 1, rows: [
      { division: "all", group: "one_day", humanTeamRaces: 1, humanTeamRoadStages: 1, hunters: 1, freeRoles: 0, tryBreakRiders: 0 },
    ] }));
    mkdirSync(routesDir, { recursive: true });
    const entries = [{ rider_id: "x", team_id: "h", race_role: "helper" }];
    mkdirSync(path.join(exp, "a"), { recursive: true });
    writeFileSync(path.join(exp, "a", "cache.json"), JSON.stringify({ race: { id: "a", name: "Loeb a", stages: 1 }, profiles: [{ race_id: "a", stage_number: 1, profile_type: "hilly" }],
      entries, orders: [], teams: [{ id: "h", is_ai: false }], abilities: [{ rider_id: "x" }], fieldSource: "generator" }));
    writeFileSync(path.join(routesDir, "a.json"), JSON.stringify({ format: "cz-race-routes/v1", race_id: "a", stages: 1, profiles: [{ stage_number: 1, profile_type: "hilly", demand_vector: { punch: 1 } }] }));
    mkdirSync(path.join(out, "races", "a"), { recursive: true });
    writeFileSync(path.join(out, "races", "a", "done"), "x");
    writeFileSync(path.join(out, "races", "a", "loeb-a-2026-10-21-10-00.json"), scorecard("a", "rev"));
    const args = ["--candidate=rev", "--no-bench", "--no-png", `--out=${out}`, `--from-dir=${exp}`, `--routes-from=${routesDir}`, "--synthetic-field=generator"];
    await assert.rejects(main(args, { now: NOW, defaultBaseline: "rev" }), /kraever --intent-rates/);
    await main([...args, `--intent-rates=${ratesFile}`], { now: NOW, defaultBaseline: "rev" });
    const meta = JSON.parse(readFileSync(path.join(out, "testport-meta.json"), "utf8"));
    assert.equal(meta.breakawayIntent.mode, "prod");
    assert.equal(meta.breakawayIntent.seasonId, "s4");
    assert.equal(JSON.parse(readFileSync(path.join(out, "breakaway-intent-rates.json"), "utf8")).seasonId, "s4");
    const cache = JSON.parse(readFileSync(path.join(out, "races", "a", "cache.json"), "utf8"));
    assert.equal(cache.entries[0].race_role, "hunter");
    // En genoptagelse uden satser bruger dem der staar i --out; en koersel uden udbrudsvilje er en anden koersel.
    await main(args, { now: NOW, defaultBaseline: "rev" });
    await assert.rejects(main([...args, "--breakaway-intent=none"], { now: NOW, defaultBaseline: "rev" }), /anden koersel/);
    // Codex P2: andre satser ved genoptagelse afvises, foer noget skrives (done-markoererne gaelder de gamle).
    const other = path.join(root, "rates2.json");
    writeFileSync(other, readFileSync(ratesFile, "utf8").replace('"hunters":1', '"hunters":0'));
    await assert.rejects(main([...args, `--intent-rates=${other}`], { now: NOW, defaultBaseline: "rev" }), /andre udbrudsvilje-satser/);
    // Review P2: en valgt saeson der ikke passer med satserne afvises (satsfilen er fra saeson 3).
    await assert.rejects(main([...args, "--intent-season=4"], { now: NOW, defaultBaseline: "rev" }), /passer ikke med satserne/);
    assert.equal(JSON.parse(readFileSync(path.join(out, "breakaway-intent-rates.json"), "utf8")).rows[0].hunters, 1, "de gemte satser er uroerte");
  } finally {
    process.exitCode = prevExit;
    rmSync(root, { recursive: true, force: true });
  }
});

test("#6804 P0 (Codex P1) privateMinCellTeamStages: privat graense kraeves, intet stille default", () => {
  const root = mkdtempSync(path.join(tmpdir(), "testport-6804-thr-"));
  try {
    const f = path.join(root, "thr.json");
    assert.throws(() => privateMinCellTeamStages(f), /breakawayIntentMinCellTeamStages/, "filen mangler");
    writeFileSync(f, JSON.stringify({ andet: 1 }));
    assert.throws(() => privateMinCellTeamStages(f), /breakawayIntentMinCellTeamStages/, "noeglen mangler");
    writeFileSync(f, JSON.stringify({ breakawayIntentMinCellTeamStages: -1 }));
    assert.throws(() => privateMinCellTeamStages(f), /tal >= 0/);
    writeFileSync(f, JSON.stringify({ breakawayIntentMinCellTeamStages: 12 }));
    assert.equal(privateMinCellTeamStages(f), 12);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// #6912: worktrees har ikke noedvendigvis den lokale private taerskelfil.
test("#6912: privat OneDrive-taerskelfil bruges som standard naar lokal fil mangler", async () => {
  const { defaultThresholdsPath } = await import("./motorTestport.mjs");
  const local = path.join("balance-internals", "motor-testport-thresholds.json");
  const remote = path.join("drive", "CyclingZone-context", local);
  assert.equal(defaultThresholdsPath({ oneDrive: "drive", exists: (p) => p === remote }), remote);
  assert.equal(defaultThresholdsPath({ oneDrive: "drive", repoRoot: "repo", exists: (p) => p === path.join("repo", local) || p === remote }), local);
  assert.equal(defaultThresholdsPath({ oneDrive: null, exists: () => false }), local);
});

test("#6912: lokal privat taerskelfil findes relativt til repo-root, uanset cwd", async () => {
  const { defaultThresholdsPath } = await import("./motorTestport.mjs");
  const local = path.join("balance-internals", "motor-testport-thresholds.json");
  const shared = path.join("drive", "CyclingZone-context", local);
  assert.equal(defaultThresholdsPath({ repoRoot: "repo", oneDrive: "drive", exists: p => p === path.join("repo", local) || p === shared }), local);
});

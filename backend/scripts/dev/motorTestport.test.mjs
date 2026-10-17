// #6750: motor-testportens CLI, opgaveplan og parallelle pulje (uden motor og uden prod).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { latestDryRunJson, parseArgs, parseIdsText, planTasks, raceIdsFromDir, runPool, selectRaceIds, tourDryRunArgs } from "./motorTestport.mjs";

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

// #7336: scripts/refresh-fingerprints.mjs. Rene dele: argumenter, den hårde allowlist,
// tærskel-opslag, dommene, exit-koder, git-vagten og at outputtet aldrig bærer tal.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_ONLY, FROZEN_TESTS, NEVER_WRITABLE, PATHS, REPO_ROOT, UsageError, exitCodeFor, forbiddenChanges, gitChangedPaths,
  judgeBench, judgeFlatChase, main, markWritten, muted, overallResult, parseArgs, render, resolveThresholdsPath, runGuard,
  safeWriteJson, toJson, writablePaths, writeAllOrNothing, writeAllowed,
} from "./refresh-fingerprints.mjs";

const RATING_GOLDEN = "frontend/src/lib/__fixtures__/ratingGolden.5321.json";

test("allowlisten er låst: præcis de to fingeraftryk som default, kalenderen kun med --only=calendar", () => {
  assert.deepEqual(writablePaths(), [
    "backend/lib/engine/v4/test-data/flatChase6912Digests.json",
    "backend/lib/__fixtures__/s5MotorBench.json",
  ]);
  assert.deepEqual(writablePaths(["6912", "bench", "calendar"]), [
    "backend/lib/engine/v4/test-data/flatChase6912Digests.json",
    "backend/lib/__fixtures__/s5MotorBench.json",
    "backend/lib/__fixtures__/calendarGoldenSnapshot.s3.json",
  ]);
  assert.deepEqual(writablePaths(["bench"]), [PATHS.bench]);
  assert.deepEqual([...DEFAULT_ONLY], ["6912", "bench"]);
});

test("ratingGolden og de frosne digests står aldrig i allowlisten", () => {
  const all = writablePaths(["6912", "bench", "calendar"]);
  assert.ok(NEVER_WRITABLE.includes(RATING_GOLDEN));
  for (const f of ["oldRevisionDigests6199.json", "s5UntouchedDigests6363.json", "officialTimesV2Frozen6200.json", "groupClockLegacy6199.json"]) {
    assert.ok(NEVER_WRITABLE.includes(`backend/lib/engine/v4/test-data/${f}`), f);
  }
  for (const p of NEVER_WRITABLE) assert.ok(!all.includes(p), p);
  assert.ok(!all.some((p) => p.includes("ratingGolden")));
});

test("safeWriteJson nægter alt uden for allowlisten og bevarer CRLF", () => {
  const writes = [];
  const io = { root: "/r", write: (f, body) => writes.push([f, body]), read: () => "{\r\n}\r\n", exists: () => true };
  assert.throws(() => safeWriteJson(RATING_GOLDEN, {}, [RATING_GOLDEN], io), /allowlisten/, "låst fil afvises selv hvis den smugles ind");
  assert.throws(() => safeWriteJson("backend/lib/x.json", {}, writablePaths(), io), /allowlisten/);
  safeWriteJson(PATHS.bench, { a: 1 }, writablePaths(), io);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], path.join("/r", PATHS.bench));
  assert.equal(writes[0][1], '{\r\n  "a": 1\r\n}\r\n');
  safeWriteJson(PATHS.bench, { a: 1 }, writablePaths(), { ...io, read: () => "{\n}\n" });
  assert.equal(writes[1][1], '{\n  "a": 1\n}\n');
});

test("parseArgs: check er default; write, accept, only, thresholds, json", () => {
  assert.deepEqual(parseArgs([]), { mode: "check", only: ["6912", "bench"], acceptVerdictChange: false, thresholds: null, json: false, debug: false });
  const o = parseArgs(["--write", "--accept-verdict-change", "--only=bench,6912,bench", "--thresholds=/t.json", "--json"], { exists: (p) => p === "/t.json" });
  assert.equal(o.mode, "write");
  assert.equal(o.acceptVerdictChange, true);
  assert.deepEqual(o.only, ["bench", "6912"]);
  assert.equal(o.thresholds, "/t.json");
  assert.equal(o.json, true);
  assert.throws(() => parseArgs(["--check", "--write"]), UsageError);
  assert.throws(() => parseArgs(["--accept-verdict-change"]), UsageError, "accept kun med --write");
  assert.throws(() => parseArgs(["--only=rating"]), UsageError);
  assert.throws(() => parseArgs(["--only="]), UsageError);
  assert.throws(() => parseArgs(["--frobnicate"]), UsageError);
  assert.throws(() => parseArgs(["--thresholds=/nope.json"], { exists: () => false }), /findes ikke/, "tærskelfil valideres allerede i parseArgs");
});

test("tærskel-opslag: --thresholds, env, worktree, OneDrive; null når ingen findes", () => {
  const rel = path.join("balance-internals", "6362", "winner-thresholds.json");
  const env = { CZ_6362_WINNER_THRESHOLDS: "/env.json", OneDrive: "/od" };
  const has = (...ps) => (p) => ps.includes(p);
  assert.equal(resolveThresholdsPath({ explicit: "/x.json", env, exists: has("/x.json", "/env.json") }), "/x.json");
  assert.throws(() => resolveThresholdsPath({ explicit: "/nope.json", env, exists: has() }), UsageError);
  assert.equal(resolveThresholdsPath({ env, repoRoot: "/repo", exists: has("/env.json", path.join("/repo", rel)) }), "/env.json");
  assert.equal(resolveThresholdsPath({ env: { OneDrive: "/od" }, repoRoot: "/repo", exists: has(path.join("/repo", rel), path.join("/od", "CyclingZone-context", rel)) }), path.join("/repo", rel));
  assert.equal(resolveThresholdsPath({ env: { OneDrive: "/od" }, repoRoot: "/repo", exists: has(path.join("/od", "CyclingZone-context", rel)) }), path.join("/od", "CyclingZone-context", rel));
  assert.equal(resolveThresholdsPath({ env: { USERPROFILE: "/u" }, repoRoot: "/repo", exists: has(path.join("/u", "OneDrive", "CyclingZone-context", rel)) }), path.join("/u", "OneDrive", "CyclingZone-context", rel));
  assert.equal(resolveThresholdsPath({ env: {}, repoRoot: "/repo", exists: has() }), null);
});

const EXPECTED_6912 = { oldRevisions: { a: "1" }, otherTerrain: { t: "2" }, oldStageRaces: { s: "3" }, otherOneDay: { o: "4" } };
const FROZEN = ["oldRevisions", "oldStageRaces"];
const RECOMP = ["otherTerrain", "otherOneDay"];

test("6912: frosne nøgler der flytter sig er en regression og blokerer al skrivning", () => {
  const j = judgeFlatChase({ expected: EXPECTED_6912, actual: { oldRevisions: { a: "x" }, oldStageRaces: { s: "3" } }, frozenKeys: FROZEN, recomputableKeys: [] });
  assert.equal(j.results[0].status, "regression");
  assert.equal(j.next, null);
  assert.equal(writeAllowed(j.results), false);
  assert.equal(exitCodeFor(j.results), 1);
});

test("6912: v3-drift er skrivbar og bevarer nøglernes rækkefølge og de frosne værdier", () => {
  const j = judgeFlatChase({ expected: EXPECTED_6912, actual: { otherTerrain: { t: "new" }, otherOneDay: { o: "4" } }, frozenKeys: [], recomputableKeys: RECOMP });
  assert.deepEqual(j.results.map((x) => [x.part, x.status]), [["6912-otherTerrain", "drifted"], ["6912-otherOneDay", "unchanged"]]);
  assert.deepEqual(Object.keys(j.next), Object.keys(EXPECTED_6912));
  assert.deepEqual(j.next, { ...EXPECTED_6912, otherTerrain: { t: "new" } });
  assert.equal(writeAllowed(j.results), true);
  assert.deepEqual(markWritten(j.results).map((x) => x.status), ["written", "unchanged"]);
  assert.equal(exitCodeFor(markWritten(j.results)), 0);
});

const CONFIG = { revision: "v3" };
const FIXTURE = {
  stub: false, config: CONFIG,
  verdicts: { flat_sprint: "inside", long_climb: "inside" }, sources: { flat_sprint: "grand_tours", long_climb: "grand_tours" },
  winners: { long_climb: { expected: "climber", verdict: "pass" } }, winnerDigests: { long_climb: "sha256:aaaa" },
};
const same = () => ({ measured: { verdicts: { ...FIXTURE.verdicts }, sources: { ...FIXTURE.sources } }, winnerDigests: { ...FIXTURE.winnerDigests }, winners: { long_climb: { expected: "climber", verdict: "pass" } }, config: CONFIG });

test("bench: alt ens = uændret, ingen skrivning", () => {
  const j = judgeBench({ fixture: FIXTURE, ...same() });
  assert.equal(j.anyChange, false);
  assert.ok(j.results.every((x) => x.status === "unchanged"));
  assert.equal(exitCodeFor(j.results), 0);
});

test("bench: kun winnerDigests flyttet = teknisk drift, skrivbar uden ejer-go", () => {
  const j = judgeBench({ fixture: FIXTURE, ...same(), winnerDigests: { long_climb: "sha256:bbbb" } });
  assert.equal(j.anyChange, true);
  assert.equal(j.results.find((x) => x.part === "bench-digests").status, "drifted");
  assert.equal(writeAllowed(j.results), true);
  assert.equal(overallResult(markWritten(j.results), "write"), "fingeraftryk genberegnet, ingen dom ændret");
});

test("bench: ændret dom kræver --accept-verdict-change", () => {
  const changed = { ...same(), measured: { verdicts: { ...FIXTURE.verdicts, long_climb: "above" }, sources: { ...FIXTURE.sources } } };
  const blocked = judgeBench({ fixture: FIXTURE, ...changed });
  assert.equal(blocked.results.find((x) => x.part === "bench-gap").status, "verdict_changed");
  assert.equal(writeAllowed(blocked.results), false);
  assert.match(overallResult(blocked.results, "write"), /ejer-go/);
  const accepted = judgeBench({ fixture: FIXTURE, ...changed, accept: true });
  assert.equal(writeAllowed(accepted.results), true);
  const written = markWritten(accepted.results);
  assert.equal(written.find((x) => x.part === "bench-gap").status, "written");
  assert.match(overallResult(written, "write"), /dom ændret og accepteret/);

  const winnerFlip = judgeBench({ fixture: FIXTURE, ...same(), winners: { long_climb: { expected: "climber", verdict: "fail" } } });
  assert.equal(winnerFlip.results.find((x) => x.part === "bench-winners").status, "verdict_changed");
  assert.equal(writeAllowed(winnerFlip.results), false);
});

test("bench uden tærskel: tjekker hvad den kan og siger at vindertypen ikke er genberegnet", () => {
  const ok = judgeBench({ fixture: FIXTURE, ...same(), winners: null });
  const w = ok.results.find((x) => x.part === "bench-winners");
  assert.equal(w.status, "skipped");
  assert.equal(w.verdict, "tærskel mangler, vindertype ikke genberegnet");
  assert.equal(exitCodeFor(ok.results), 0, "uændrede digests binder stadig dommen");
  assert.deepEqual(ok.winnersForWrite, FIXTURE.winners);

  const moved = judgeBench({ fixture: FIXTURE, ...same(), winners: null, winnerDigests: { long_climb: "sha256:cccc" } });
  const d = moved.results.find((x) => x.part === "bench-digests");
  assert.equal(d.status, "drifted");
  assert.equal(d.writable, false, "flyttede digests kan ikke skrives uden tærskel");
  assert.equal(writeAllowed(moved.results), false);
  assert.equal(exitCodeFor(moved.results), 1);
});

test("output bærer kun domme: ingen tal, digests eller tærskler", () => {
  const all = [
    ...judgeFlatChase({ expected: EXPECTED_6912, actual: { oldRevisions: { a: "1" }, oldStageRaces: { s: "3" } }, frozenKeys: FROZEN, recomputableKeys: [] }).results,
    ...judgeFlatChase({ expected: EXPECTED_6912, actual: { otherTerrain: { t: "deadbeef1234" }, otherOneDay: { o: "4" } }, frozenKeys: [], recomputableKeys: RECOMP }).results,
    ...judgeBench({ fixture: FIXTURE, ...same(), winners: null, winnerDigests: { long_climb: "sha256:9999" }, measured: { verdicts: { flat_sprint: "below", long_climb: "inside" }, sources: FIXTURE.sources } }).results,
  ];
  for (const mode of ["check", "write"]) {
    for (const text of [render(all, mode), render(markWritten(all), mode), JSON.stringify(toJson(all, mode))]) {
      assert.ok(!text.includes("sha256"), "ingen digests");
      assert.ok(!text.includes("deadbeef"), "ingen digests");
      const stripped = text.replace(/6912|6199\/6200\/6363|5321|v1\/v2|v3|"exitCode":\s*\d/g, "");
      assert.doesNotMatch(stripped, /\d/, `ingen tal i outputtet:\n${stripped}`);
    }
  }
  assert.match(render(all, "check"), /ratingGolden\.5321\s+ikke rørt/);
});

test("git-vagten: kun nye ændringer uden for allowlisten fanges", () => {
  const allow = writablePaths();
  const before = new Set(["docs/NOW.md"]);
  const after = new Set(["docs/NOW.md", PATHS.flatChase, PATHS.bench, RATING_GOLDEN, "backend/lib/engine/v4/test-data/oldRevisionDigests6199.json"]);
  assert.deepEqual(forbiddenChanges(before, after, allow), ["backend/lib/engine/v4/test-data/oldRevisionDigests6199.json", RATING_GOLDEN]);
  assert.deepEqual(forbiddenChanges(before, new Set([...before, PATHS.bench]), allow), []);
});

test("gitChangedPaths samler ændrede og nye filer og fejler højt", () => {
  const run = (args) => ({ status: 0, stdout: args[0] === "diff" ? "a.json\r\nb.json\n" : "c.json\n" });
  assert.deepEqual([...gitChangedPaths(run)].sort(), ["a.json", "b.json", "c.json"]);
  assert.throws(() => gitChangedPaths(() => ({ status: 128, stdout: "" })), /git/);
});

// ---------- main()-forløbet med injicerede afhængigheder (ingen motor, ingen git, ingen disk) ----------

const FP_FROZEN = ["oldRevisions", "oldStageRaces"];
const FP_RECOMP = ["otherTerrain", "otherOneDay"];
const isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fakeDeps({
  frozenTestsOk = true, frozenKeyMoved = false, v3Moved = false, benchDigestsMoved = false,
  benchFixture = FIXTURE, thresholds = "/t.json", calendar = "same", failWriteOn = null,
  extraChanged = [], tracked = [], before = [],
} = {}) {
  const calls = [];
  const writes = [];
  const files = {
    [PATHS.flatChase]: `${JSON.stringify(EXPECTED_6912, null, 2)}\n`,
    [PATHS.bench]: `${JSON.stringify(benchFixture, null, 2)}\n`,
    [PATHS.calendar]: `${JSON.stringify({ s: "old" }, null, 2)}\n`,
  };
  const fp = {
    FLAT_CHASE_6912_FROZEN_KEYS: FP_FROZEN,
    FLAT_CHASE_6912_RECOMPUTABLE_KEYS: FP_RECOMP,
    computeFlatChase6912: (k) => {
      calls.push(`compute:${k}`);
      if (k === "oldRevisions" && frozenKeyMoved) return { a: "moved" };
      if (k === "otherTerrain" && v3Moved) return { t: "moved" };
      return EXPECTED_6912[k];
    },
  };
  const bench = {
    S5_MOTOR_BENCH_CONFIG: CONFIG,
    loadWinnerThresholds: () => ({}),
    runS5MotorBench: async () => { calls.push("bench:run"); return []; },
    gateMeasurement: () => ({ verdicts: { ...FIXTURE.verdicts }, sources: { ...FIXTURE.sources } }),
    winnerRowsDigests: () => (benchDigestsMoved ? { long_climb: "sha256:moved" } : { ...FIXTURE.winnerDigests }),
    winnerVerdicts: () => ({ long_climb: { expected: "climber", verdict: "pass" } }),
    fixtureFromSummary: (summary, winners, winnerDigests) => {
      if (!winners) throw new Error("vindertype-dommen mangler");
      return { ...FIXTURE, verdicts: summary.gate.verdicts, winners, winnerDigests };
    },
  };
  const cal = {
    buildCalendarGoldenSnapshot: () => {
      calls.push("calendar:build");
      if (calendar === "crash") throw new Error("boom");
      return calendar === "moved" ? { s: "new" } : { s: "old" };
    },
    diffCalendarGoldenSnapshots: (a, b) => (isEqual(a, b) ? [] : ["diff"]),
  };
  const modules = {
    "lib/engine/v4/testUtils/flatChase6912Fingerprints.ts": fp,
    "scripts/dev/s5MotorBench.mjs": bench,
    "lib/s5BenchmarkGate.js": { loadS5Benchmark: () => ({}) },
    "scripts/dev/lib/calendarGoldenSnapshotBuilder.mjs": cal,
  };
  const out = [];
  const err = [];
  let gitCalls = 0;
  let failedOnce = false;
  const deps = {
    runFrozenTests: () => { calls.push("frozen-tests"); return frozenTestsOk; },
    importBackend: async (rel) => { calls.push(`import:${rel}`); return modules[rel]; },
    readJson: (rel) => JSON.parse(files[rel]),
    readText: (rel) => files[rel] ?? null,
    writeText: (rel, body) => {
      if (rel === failWriteOn && !failedOnce) { failedOnce = true; throw new Error("disk fuld"); }
      writes.push({ rel, body });
      files[rel] = body;
    },
    removeFile: (rel) => { calls.push(`remove:${rel}`); delete files[rel]; },
    gitChangedPaths: () => {
      gitCalls += 1;
      calls.push("git-changed");
      if (gitCalls === 1) return new Set(before);
      return new Set([...before, ...writes.map((w) => w.rel), ...extraChanged]);
    },
    isTracked: (rel) => tracked.includes(rel),
    restoreTracked: (rels) => calls.push(`restore:${rels.join(",")}`),
    resolveThresholds: () => thresholds,
    exists: () => true,
    mute: (fn) => fn(),
    out: (t) => out.push(t),
    err: (t) => err.push(String(t)),
  };
  return { deps, calls, writes, files, out, err };
}

test("main --check skriver aldrig og kører ikke git-vagten, heller ikke ved drift", async () => {
  const f = fakeDeps({ v3Moved: true, benchDigestsMoved: true });
  const code = await main(["--check"], f.deps);
  assert.equal(code, 1);
  assert.deepEqual(f.writes, []);
  assert.ok(!f.calls.includes("git-changed"));
  assert.match(f.out.join("\n"), /DREVET/);
  assert.match(f.out.join("\n"), /kør --write/);
});

test("main: de frosne kører uanset --only", async () => {
  const f = fakeDeps();
  const code = await main(["--only=calendar"], f.deps);
  assert.equal(code, 0);
  assert.ok(f.calls.includes("frozen-tests"));
  for (const k of FP_FROZEN) assert.ok(f.calls.includes(`compute:${k}`), k);
  for (const k of FP_RECOMP) assert.ok(!f.calls.includes(`compute:${k}`), `${k} kører kun med --only=6912`);
  assert.ok(!f.calls.includes("bench:run"));
  assert.ok(f.calls.includes("calendar:build"));
});

test("main: en regression i de frosne stopper alt, også under --write", async () => {
  for (const variant of [{ frozenTestsOk: false }, { frozenKeyMoved: true }]) {
    const f = fakeDeps({ ...variant, v3Moved: true, benchDigestsMoved: true });
    const code = await main(["--write", "--only=6912,bench,calendar"], f.deps);
    assert.equal(code, 1);
    assert.deepEqual(f.writes, [], "intet skrevet");
    assert.ok(!f.calls.includes("bench:run"), "benchen kører ikke");
    assert.ok(!f.calls.includes("calendar:build"), "kalenderen kører ikke");
    for (const k of FP_RECOMP) assert.ok(!f.calls.includes(`compute:${k}`));
    assert.match(f.out.join("\n"), /REGRESSION/);
  }
});

test("main --write: skriver allowlisten, kører vagten bagefter og giver exit 0", async () => {
  const f = fakeDeps({ v3Moved: true, benchDigestsMoved: true });
  const code = await main(["--write"], f.deps);
  assert.equal(code, 0);
  assert.deepEqual(f.writes.map((w) => w.rel), [PATHS.flatChase, PATHS.bench]);
  assert.equal(f.calls.filter((c) => c === "git-changed").length, 2, "før og efter");
  assert.equal(JSON.parse(f.files[PATHS.flatChase]).otherTerrain.t, "moved");
  assert.match(f.out.join("\n"), /skrevet/);
});

test("main --write er alt-eller-intet: fejler anden skrivning, gendannes den første og vagten kører", async () => {
  const f = fakeDeps({ v3Moved: true, benchDigestsMoved: true, failWriteOn: PATHS.bench });
  const original = f.files[PATHS.flatChase];
  const code = await main(["--write"], f.deps);
  assert.equal(code, 2);
  assert.equal(f.files[PATHS.flatChase], original, "første fil er gendannet byte-identisk");
  assert.equal(f.calls.filter((c) => c === "git-changed").length, 2, "vagten kørte i finally");
  assert.match(f.err.join("\n"), /gendannet/);
});

test("writeAllOrNothing tjekker allowlisten før den første skrivning og fjerner nye filer ved fejl", () => {
  const files = { a: "{}\n" };
  const io = {
    readText: (rel) => files[rel] ?? null,
    writeText: (rel, b) => { if (rel === "boom") throw new Error("x"); files[rel] = b; },
    removeFile: (rel) => { delete files[rel]; },
  };
  assert.throws(() => writeAllOrNothing([{ rel: "a", value: 1 }, { rel: RATING_GOLDEN, value: 1 }], ["a", RATING_GOLDEN], io), /allowlisten/);
  assert.equal(files.a, "{}\n", "intet skrevet når en sti er låst");
  assert.throws(() => writeAllOrNothing([{ rel: "a", value: 1 }, { rel: "new", value: 2 }, { rel: "boom", value: 3 }], ["a", "new", "boom"], io), /x/);
  assert.deepEqual(files, { a: "{}\n" }, "den ændrede er gendannet og den nye fjernet");
});

test("main: vagten gendanner trackede filer og nævner nye utrackede ærligt", async () => {
  const stray = "backend/lib/engine/v4/test-data/oldRevisionDigests6199.json";
  const f = fakeDeps({ v3Moved: true, extraChanged: [stray, "tmp/new-file.json"], tracked: [stray], before: ["docs/NOW.md"] });
  const code = await main(["--write", "--only=6912"], f.deps);
  assert.equal(code, 2);
  assert.ok(f.calls.includes(`restore:${stray}`));
  assert.ok(!f.calls.some((c) => c.startsWith("restore:") && c.includes("tmp/new-file.json")));
  const msg = f.err.join("\n");
  assert.match(msg, /gendannet: backend\/lib\/engine\/v4\/test-data\/oldRevisionDigests6199\.json/);
  assert.match(msg, /IKKE fjernet.*tmp\/new-file\.json/);
});

test("runGuard: rent = null, og kun nye ændringer tæller", () => {
  const deps = { gitChangedPaths: () => new Set(["docs/NOW.md", PATHS.bench]), isTracked: () => true, restoreTracked: () => { throw new Error("må ikke kaldes"); } };
  assert.equal(runGuard(new Set(["docs/NOW.md"]), writablePaths(), deps), null);
});

test("main: kalenderen er kun drift ved en reel diff; et nedbrud er FEJL og stopper skrivning", async () => {
  const moved = fakeDeps({ calendar: "moved" });
  assert.equal(await main(["--write", "--only=calendar"], moved.deps), 0);
  assert.deepEqual(moved.writes.map((w) => w.rel), [PATHS.calendar]);

  const crash = fakeDeps({ calendar: "crash", v3Moved: true });
  const code = await main(["--write", "--only=6912,calendar"], crash.deps);
  assert.equal(code, 1);
  assert.deepEqual(crash.writes, [], "intet skrevet når en del fejler");
  const text = crash.out.join("\n");
  assert.match(text, /kalender S3\s+FEJL/);
  assert.doesNotMatch(text, /kalender S3\s+DREVET/);
  assert.doesNotMatch(text, /boom/, "fejlens tekst vises ikke uden --debug");
});

test("bench: stub-fixture uden tærskel stoppes i dommen, ikke i skrivetrinnet", async () => {
  const stub = { stub: true, config: {} };
  const j = judgeBench({ fixture: stub, ...same(), winners: null });
  const c = j.results.find((x) => x.part === "bench-config");
  assert.equal(c.status, "drifted");
  assert.equal(c.writable, false);
  assert.equal(writeAllowed(j.results), false);

  const f = fakeDeps({ benchFixture: stub, thresholds: null });
  const code = await main(["--write", "--only=bench"], f.deps);
  assert.equal(code, 1);
  assert.deepEqual(f.writes, []);
});

test("main: --thresholds til en fil der ikke findes giver brugsbesked og exit 2 før noget kører", async () => {
  const f = fakeDeps();
  const code = await main(["--thresholds=/nope.json"], { ...f.deps, exists: () => false });
  assert.equal(code, 2);
  assert.match(f.err.join("\n"), /findes ikke[\s\S]*brug:/);
  assert.ok(!f.calls.includes("frozen-tests"));
});

test("muted dæmper console.* og stream.write, og gendanner dem bagefter", async () => {
  const seen = [];
  const con = { log: (s) => seen.push(`log:${s}`), info() {}, warn() {}, debug() {}, error: (s) => seen.push(`error:${s}`) };
  const stream = { write: (s) => { seen.push(`write:${s}`); return true; } };
  const value = await muted(async () => {
    con.log("motor"); con.error("motor"); stream.write("motor");
    let cbCalled = false;
    stream.write("x", () => { cbCalled = true; });
    assert.ok(cbCalled, "callback kaldes stadig");
    return "v";
  }, false, { con, streams: [stream] });
  assert.equal(value, "v");
  assert.deepEqual(seen, []);
  con.log("dom"); stream.write("dom");
  assert.deepEqual(seen, ["log:dom", "write:dom"], "scriptets egne domme er synlige bagefter");
  await assert.rejects(muted(async () => { throw new Error("x"); }, false, { con, streams: [stream] }));
  stream.write("efter fejl");
  assert.equal(seen.at(-1), "write:efter fejl", "gendannet selv når fn kaster");
});

test("FROZEN_TESTS peger på filer der findes", () => {
  for (const t of FROZEN_TESTS) assert.ok(existsSync(path.join(REPO_ROOT, "backend", t)), t);
});

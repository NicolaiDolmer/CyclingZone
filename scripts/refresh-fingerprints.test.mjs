// #7336: scripts/refresh-fingerprints.mjs. Rene dele: argumenter, den hårde allowlist,
// tærskel-opslag, dommene, exit-koder, git-vagten og at outputtet aldrig bærer tal.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  DEFAULT_ONLY, NEVER_WRITABLE, PATHS, UsageError, exitCodeFor, forbiddenChanges, gitChangedPaths, judgeBench,
  judgeFlatChase, markWritten, overallResult, parseArgs, render, resolveThresholdsPath, safeWriteJson, toJson,
  writablePaths, writeAllowed,
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
  const o = parseArgs(["--write", "--accept-verdict-change", "--only=bench,6912,bench", "--thresholds=/t.json", "--json"]);
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

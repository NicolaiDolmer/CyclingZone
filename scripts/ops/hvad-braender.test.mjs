import test from "node:test";
import assert from "node:assert/strict";
import { classifySentry, classifyCi, classifyDb, classifyTraining, classifyDeploy, classifyWaveTokens, classifyTracks, parseState, parseWaveTokenComments, renderReport, alreadyReported } from "./hvad-braender.mjs";

const NOW = Date.parse("2026-10-13T06:00:00Z");
const h = (n) => new Date(NOW - n * 3600000).toISOString();

test("Sentry: new issue with a player is red; regressed is amber; old quiet issue is green", () => {
  const base = { stats: { "24h": [[0, 2], [1, 2]] }, userCount: 0, firstSeen: h(500), substatus: "ongoing" };
  assert.equal(classifySentry([{ ...base, shortId: "A" }], NOW).level, "GRØN");
  assert.equal(classifySentry([{ ...base, shortId: "B", substatus: "regressed" }], NOW).level, "GUL");
  const red = classifySentry([{ ...base, shortId: "C", firstSeen: h(2), userCount: 1 }], NOW);
  assert.equal(red.level, "RØD");
  assert.match(red.summary, /C: nyt, 4 hændelser, 1 spiller/);
  assert.equal(classifySentry([{ ...base, shortId: "D", firstSeen: h(2), stats: { "24h": [[0, 10]] } }], NOW).level, "RØD");
});

test("CI: red only when the same workflow failed on two days and the latest run is red", () => {
  const run = (name, conclusion, hoursAgo) => ({ name, conclusion, status: "completed", head_branch: "main", created_at: h(hoursAgo) });
  assert.equal(classifyCi([run("CI", "failure", 1), run("CI", "failure", 30)]).level, "RØD");
  assert.equal(classifyCi([run("CI", "failure", 1), run("CI", "success", 30)]).level, "GUL");
  assert.equal(classifyCi([run("CI", "success", 1), run("CI", "failure", 30), run("CI", "failure", 55)]).level, "GRØN");
  assert.equal(classifyCi([{ ...run("CI", "failure", 1), head_branch: "feat/x" }]).level, "GRØN");
});

test("DB: growth vs the oldest snapshot at least 7 days back; WAL over 2 GB is red", () => {
  const GB = 1024 ** 3;
  assert.match(classifyDb({ dbBytes: 5 * GB, walBytes: GB }, {}, "2026-10-13").summary, /ingen historik/);
  assert.equal(classifyDb({ dbBytes: 5.6 * GB, walBytes: GB }, { "2026-10-05": 5 * GB }, "2026-10-13").level, "RØD");
  assert.equal(classifyDb({ dbBytes: 5.3 * GB, walBytes: GB }, { "2026-10-05": 5 * GB }, "2026-10-13").level, "GUL");
  assert.equal(classifyDb({ dbBytes: 5.1 * GB, walBytes: GB }, { "2026-10-05": 5 * GB }, "2026-10-13").level, "GRØN");
  assert.equal(classifyDb({ dbBytes: 5 * GB, walBytes: 2.5 * GB }, {}, "2026-10-13").level, "RØD");
});

test("Training: >2 min or >3 open teams is red, 1-3 open is amber", () => {
  assert.equal(classifyTraining({ tickDate: "d", total: 263, complete: 262, durationSeconds: 60 }).level, "GUL");
  assert.equal(classifyTraining({ tickDate: "d", total: 263, complete: 263, durationSeconds: 130 }).level, "RØD");
  assert.equal(classifyTraining({ tickDate: "d", total: 263, complete: 259, durationSeconds: 60 }).level, "RØD");
  assert.equal(classifyTraining({ tickDate: "d", total: 263, complete: 263, durationSeconds: 60 }).level, "GRØN");
  assert.equal(classifyTraining({ tickDate: "d", total: 0, complete: 0, durationSeconds: null }).level, "INGEN DATA");
});

test("Deploy verify: latest completed main run decides", () => {
  const r = (conclusion, hoursAgo) => ({ conclusion, status: "completed", head_branch: "main", head_sha: "abcdef1234567", created_at: h(hoursAgo) });
  assert.equal(classifyDeploy([r("success", 1), r("failure", 2)]).level, "GRØN");
  assert.equal(classifyDeploy([r("failure", 1), r("success", 2)]).level, "RØD");
  // merge-køens batch: overhalet deploy fejler, mens det nyere kører -> gul, ikke rød
  assert.equal(classifyDeploy([{ ...r(null, 0.5), status: "in_progress" }, r("failure", 1)]).level, "GUL");
});

test("Wave tokens: parsed from marker comments within 24 h; agent >100k or prompt >50 KB is red", () => {
  const comments = [
    { created_at: h(2), body: 'done\n<!-- wave-tokens: {"wave":"W1","total":300000,"estimate":100000,"agents":[{"label":"a","tokens":120000,"promptKb":2}]} -->' },
    { created_at: h(30), body: '<!-- wave-tokens: {"wave":"old","agents":[]} -->' },
    { created_at: h(1), body: "<!-- wave-tokens: {broken -->" },
  ];
  const reports = parseWaveTokenComments(comments, NOW);
  assert.equal(reports.length, 1);
  assert.equal(classifyWaveTokens(reports).level, "RØD");
  assert.equal(classifyWaveTokens([{ wave: "W2", total: 300, estimate: 100, agents: [{ label: "a", tokens: 10, promptKb: 1 }] }]).level, "GUL");
  assert.equal(classifyWaveTokens([]).level, "INGEN DATA");
});

test("Tracks: active draft older than 4 h is red, silent draft amber, ready PRs ignored", () => {
  assert.equal(classifyTracks([{ number: 1, draft: true, created_at: h(6), pushed_at: h(1) }], NOW).level, "RØD");
  assert.equal(classifyTracks([{ number: 2, draft: true, created_at: h(60), pushed_at: h(30) }], NOW).level, "GUL");
  assert.equal(classifyTracks([{ number: 3, draft: false, created_at: h(60), pushed_at: h(1) }], NOW).level, "GRØN");
});

test("Report: reds first, state round-trips, pipes cannot break the table", () => {
  const body = renderReport([
    { name: "A", level: "GRØN", summary: "ok" },
    { name: "B", level: "RØD", summary: "x | y" },
  ], { stamp: "13/10", state: { db: { "2026-10-13": 1 } } });
  assert.ok(body.indexOf("| RØD | B") < body.indexOf("| GRØN | A"));
  assert.match(body, /\*\*1 rød\(e\)\*\*: B/);
  assert.match(body, /x \/ y/);
  assert.deepEqual(parseState(body), { db: { "2026-10-13": 1 } });
  assert.deepEqual(parseState("no state"), {});
});

test("Late cron: scheduled run skips when today is already reported; manual run never skips", () => {
  assert.equal(alreadyReported({ reportedOn: "2026-10-14" }, "2026-10-14", true), true);
  assert.equal(alreadyReported({ reportedOn: "2026-10-13" }, "2026-10-14", true), false);
  assert.equal(alreadyReported({}, "2026-10-14", true), false);
  assert.equal(alreadyReported({ reportedOn: "2026-10-14" }, "2026-10-14", false), false);
});

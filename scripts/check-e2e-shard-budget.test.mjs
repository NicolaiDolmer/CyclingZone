// scripts/check-e2e-shard-budget.test.mjs
// Unit-test for tidsbudget-gaten (#4647). Ingen vaegur-tid: alle tal injiceres.

import test from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs, evaluateShards, formatDuration, renderSummary, readShardMetrics, coerceSeconds } from "./check-e2e-shard-budget.mjs";

const PROJECTS = ["desktop-chromium", "mobile-chromium", "mobile-webkit"];

const shard = (project, seconds, exitCode = 0) => ({ project, seconds, exitCode });

const allShards = (seconds = 300) => PROJECTS.map((p) => shard(p, seconds));

test("parseArgs laeser flag med og uden vaerdi", () => {
  const args = parseArgs(["--dir", "metrics", "--budget-minutes", "12", "--verbose"]);
  assert.equal(args.dir, "metrics");
  assert.equal(args["budget-minutes"], "12");
  assert.equal(args.verbose, "true");
});

test("groent naar alle shards er under budget", () => {
  const res = evaluateShards({ shards: allShards(300), budgetMinutes: 12, shardsResult: "success", projects: PROJECTS });
  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 3);
  assert.ok(res.rows.every((r) => r.over === false));
});

test("roedt naar en enkelt shard er over budget", () => {
  const shards = [shard("desktop-chromium", 300), shard("mobile-chromium", 800), shard("mobile-webkit", 310)];
  const res = evaluateShards({ shards, budgetMinutes: 12, shardsResult: "success", projects: PROJECTS });
  assert.equal(res.ok, false);
  assert.ok(res.lines.some((l) => l.includes("mobile-chromium") && l.includes("tidsbudgettet")));
});

test("praecis paa budgettet er groent, et sekund over er roedt", () => {
  const onBudget = evaluateShards({
    shards: [shard("desktop-chromium", 720), shard("mobile-chromium", 720), shard("mobile-webkit", 720)],
    budgetMinutes: 12,
    shardsResult: "success",
    projects: PROJECTS,
  });
  assert.equal(onBudget.ok, true);

  const overBudget = evaluateShards({
    shards: [shard("desktop-chromium", 721), shard("mobile-chromium", 10), shard("mobile-webkit", 10)],
    budgetMinutes: 12,
    shardsResult: "success",
    projects: PROJECTS,
  });
  assert.equal(overBudget.ok, false);
});

test("roedt naar matrixen selv fejlede, uanset tider", () => {
  const res = evaluateShards({ shards: allShards(60), budgetMinutes: 12, shardsResult: "failure", projects: PROJECTS });
  assert.equal(res.ok, false);
  assert.ok(res.lines.some((l) => l.includes("fejlede")));
});

test("skipped matrix er groent (docs-/backend-PR og merge-koe)", () => {
  const res = evaluateShards({ shards: [], budgetMinutes: 12, shardsResult: "skipped", projects: PROJECTS });
  assert.equal(res.ok, true);
  assert.ok(res.lines.some((l) => l.includes("sprunget over")));
});

test("cancelled matrix er roedt", () => {
  const res = evaluateShards({ shards: [], budgetMinutes: 12, shardsResult: "cancelled", projects: PROJECTS });
  assert.equal(res.ok, false);
});

test("manglende maaling for en shard er roedt - gaten maa ikke tabe sin maaling", () => {
  const res = evaluateShards({
    shards: [shard("desktop-chromium", 100), shard("mobile-chromium", 100)],
    budgetMinutes: 12,
    shardsResult: "success",
    projects: PROJECTS,
  });
  assert.equal(res.ok, false);
  assert.ok(res.lines.some((l) => l.includes("mobile-webkit") && l.includes("Ingen tidsmaaling")));
});

test("ikke-numerisk maaling er roedt", () => {
  const shards = [shard("desktop-chromium", Number.NaN), shard("mobile-chromium", 10), shard("mobile-webkit", 10)];
  const res = evaluateShards({ shards, budgetMinutes: 12, shardsResult: "success", projects: PROJECTS });
  assert.equal(res.ok, false);
  assert.ok(res.lines.some((l) => l.includes("ikke et tal")));
});

test("ukendt shard i maalingerne er roedt (matrix og --projects ude af sync)", () => {
  const res = evaluateShards({
    shards: [...allShards(60), shard("desktop-firefox", 60)],
    budgetMinutes: 12,
    shardsResult: "success",
    projects: PROJECTS,
  });
  assert.equal(res.ok, false);
  assert.ok(res.lines.some((l) => l.includes("desktop-firefox")));
});

// #4711 (CodeRabbit-fund paa #4665): en manglende/null tidsmaaling maa ALDRIG
// tolkes som 0 sekunder - det ville passere budgettet stille.
test("coerceSeconds: null/undefined/NaN/ikke-tal bliver NaN, ikke 0", () => {
  assert.equal(coerceSeconds(null), Number.NaN);
  assert.equal(coerceSeconds(undefined), Number.NaN);
  assert.equal(coerceSeconds("abc"), Number.NaN);
  assert.equal(coerceSeconds(Number.NaN), Number.NaN);
  assert.equal(coerceSeconds(false), Number.NaN, "Number(false)=0 maa ikke smutte igennem");
  assert.equal(coerceSeconds([]), Number.NaN, "Number([])=0 maa ikke smutte igennem");
  assert.equal(coerceSeconds({}), Number.NaN);
});

test("coerceSeconds: gyldige tal (og tal-strenge) bevares", () => {
  assert.equal(coerceSeconds(0), 0);
  assert.equal(coerceSeconds(312), 312);
  assert.equal(coerceSeconds("312"), 312);
});

test("readShardMetrics: en shard-fil med \"seconds\":null tolkes IKKE som 0s - gaten skal kunne fange den", () => {
  const dir = mkdtempSync(join(tmpdir(), "shard-budget-null-"));
  try {
    writeFileSync(join(dir, "desktop-chromium.json"), JSON.stringify({ project: "desktop-chromium", seconds: 300, exitCode: 0 }));
    // Simulerer en shard hvis maaling gik tabt/blev afbrudt: feltet er til
    // stede, men null - IKKE fravaerende (det praecise CodeRabbit-scenarie).
    writeFileSync(join(dir, "mobile-chromium.json"), JSON.stringify({ project: "mobile-chromium", seconds: null, exitCode: 0 }));
    writeFileSync(join(dir, "mobile-webkit.json"), JSON.stringify({ project: "mobile-webkit", seconds: 300, exitCode: 0 }));

    const metrics = readShardMetrics(dir);
    const mobile = metrics.find((m) => m.project === "mobile-chromium");
    assert.ok(mobile, "mobile-chromium maaling skal stadig laeses (filen findes)");
    assert.equal(Number.isNaN(mobile.seconds), true, "null-seconds maa ALDRIG blive til 0");

    // Og samle-dommen: en NaN-maaling skal faelde gaten, praecis som en
    // helt manglende maaling gjorde foer #4711.
    const res = evaluateShards({ shards: metrics, budgetMinutes: 12, shardsResult: "success", projects: PROJECTS });
    assert.equal(res.ok, false);
    assert.ok(res.lines.some((l) => l.includes("mobile-chromium") && l.includes("ikke et tal")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("formatDuration er laesbar", () => {
  assert.equal(formatDuration(45), "45 s");
  assert.equal(formatDuration(432), "7 min 12 s");
  assert.equal(formatDuration(Number.NaN), "ukendt");
});

test("renderSummary indeholder en raekke pr. shard og markerer overskridelse", () => {
  const { rows } = evaluateShards({
    shards: [shard("desktop-chromium", 800), shard("mobile-chromium", 60), shard("mobile-webkit", 60)],
    budgetMinutes: 12,
    shardsResult: "success",
    projects: PROJECTS,
  });
  const md = renderSummary(rows, 12);
  assert.ok(md.includes("| desktop-chromium |"));
  assert.ok(md.includes("OVER BUDGET"));
  assert.equal(md.split("\n").filter((l) => l.startsWith("| ")).length, 4); // header + 3 shards
});

// scripts/check-e2e-shard-budget.test.mjs
// Unit-test for tidsbudget-gaten (#4647). Ingen vaegur-tid: alle tal injiceres.

import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, evaluateShards, formatDuration, renderSummary } from "./check-e2e-shard-budget.mjs";

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

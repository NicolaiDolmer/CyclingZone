// scripts/check-e2e-shard-budget.test.mjs
// Unit-test for shard-plan + tidsgate (#4647, omlagt #5309). Ingen vaegur-tid:
// alle tal injiceres.
//
// #5309 aendrede ordlyden i to beskeder ("tidsbudgettet" -> "loftet pr. lane",
// "OVER BUDGET" -> "OVER LOFT") fordi tallet skiftede betydning: det er nu et
// sikkerhedsnet pr. lane, ikke suitens budget. Assertions herunder er rettet
// tilsvarende - adfaerden de daekker er uaendret.

import test from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseArgs,
  evaluateShards,
  formatDuration,
  renderSummary,
  readShardMetrics,
  coerceSeconds,
  parsePlan,
  expandPlan,
  planRecommendations,
  renderGithubOutput,
} from "./check-e2e-shard-budget.mjs";

const PROJECTS = ["desktop-chromium", "mobile-chromium", "mobile-webkit"];

const shard = (project, seconds, exitCode = 0) => ({ project, seconds, exitCode });

const allShards = (seconds = 300) => PROJECTS.map((p) => shard(p, seconds));

// Samme form som frontend/tests/e2e/shard-plan.json, men med tal der er lette
// at regne i hovedet.
const planFixture = (overrides = {}) =>
  parsePlan({
    targetSecondsPerShard: 300,
    ceilingSecondsPerShard: 600,
    projects: [
      { project: "desktop-chromium", browser: "chromium", shards: 2 },
      { project: "mobile-webkit", browser: "webkit", shards: 3 },
    ],
    ...overrides,
  });

const lane = (project, group, seconds) => ({ project, group, seconds, exitCode: 0 });

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
  assert.ok(res.lines.some((l) => l.includes("mobile-chromium") && l.includes("over loftet")));
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

// #5309: metrics-filerne baerer nu baade lanens identitet (`project`) og
// projektet den hoerer til (`group`). En artifact fra FOER #5309 har ingen
// `group` - den skal stadig kunne laeses, ellers bliver gaten roed paa en
// genkoersel af en aeldre PR.
test("readShardMetrics: group laeses, og falder tilbage til project naar den mangler", () => {
  const dir = mkdtempSync(join(tmpdir(), "shard-budget-group-"));
  try {
    writeFileSync(join(dir, "a.json"), JSON.stringify({ project: "mobile-webkit-1of3", group: "mobile-webkit", seconds: 200, exitCode: 0 }));
    writeFileSync(join(dir, "b.json"), JSON.stringify({ project: "mobile-webkit", seconds: 700, exitCode: 0 }));

    const metrics = readShardMetrics(dir);
    assert.equal(metrics.find((m) => m.project === "mobile-webkit-1of3").group, "mobile-webkit");
    assert.equal(metrics.find((m) => m.project === "mobile-webkit").group, "mobile-webkit", "gammel artifact uden group: lanen ER projektet");
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
  assert.ok(md.includes("OVER LOFT"));
  assert.equal(md.split("\n").filter((l) => l.startsWith("| ")).length, 4); // header + 3 laner
});

// ── #5309 · shard-planen ────────────────────────────────────────────────────

test("parsePlan afviser en plan der ikke entydigt kan koeres", () => {
  const base = {
    targetSecondsPerShard: 300,
    ceilingSecondsPerShard: 600,
    projects: [{ project: "a", browser: "chromium", shards: 1 }],
  };
  assert.throws(() => parsePlan({ ...base, targetSecondsPerShard: 0 }), /targetSecondsPerShard/);
  assert.throws(() => parsePlan({ ...base, targetSecondsPerShard: "mange" }), /targetSecondsPerShard/);
  assert.throws(() => parsePlan({ ...base, ceilingSecondsPerShard: -1 }), /ceilingSecondsPerShard/);
  assert.throws(() => parsePlan({ ...base, ceilingSecondsPerShard: 120 }), /maa ikke vaere mindre/);
  assert.throws(() => parsePlan({ ...base, projects: [] }), /ikke-tom/);
  assert.throws(() => parsePlan({ ...base, projects: [{ browser: "chromium", shards: 1 }] }), /project-navn/);
  assert.throws(() => parsePlan({ ...base, projects: [{ project: "a", shards: 1 }] }), /mangler browser/);
  assert.throws(() => parsePlan({ ...base, projects: [{ project: "a", browser: "chromium", shards: 0 }] }), /helt tal/);
  assert.throws(() => parsePlan({ ...base, projects: [{ project: "a", browser: "chromium", shards: 1.5 }] }), /helt tal/);
  assert.throws(
    () => parsePlan({ ...base, projects: [{ project: "a", browser: "chromium", shards: 1 }, { project: "a", browser: "webkit", shards: 1 }] }),
    /to gange/,
  );
});

// CodeRabbit-fund paa #5311: lane-navnet bliver til et filnavn, et artifact-navn
// og et job-navn, og `browser` gaar ubehandlet videre til `npx playwright
// install`. Uden denne validering doer lanen foerst midt i en Windows-koersel
// med en kryptisk redirect-fejl - plan-jobbet skal fange det paa ti sekunder.
test("parsePlan afviser navne der ikke kan bruges som filnavn eller i en kommando", () => {
  const withProject = (project) => ({
    targetSecondsPerShard: 300,
    ceilingSecondsPerShard: 600,
    projects: [{ project, browser: "chromium", shards: 1 }],
  });
  const withBrowser = (browser) => ({
    targetSecondsPerShard: 300,
    ceilingSecondsPerShard: 600,
    projects: [{ project: "ok-navn", browser, shards: 1 }],
  });

  for (const bad of ["mobile/webkit", "mobile\\webkit", "mobile webkit", "mobile:webkit", "-leading-dash", "..", "web*kit", "web?kit"]) {
    assert.throws(() => parsePlan(withProject(bad)), /maa kun indeholde/, `project "${bad}" skulle vaere afvist`);
  }
  for (const bad of ["chromium; rm -rf /", "chromium && echo", "$(whoami)", "chro mium", "chromium|cat", "`id`"]) {
    assert.throws(() => parsePlan(withBrowser(bad)), /maa kun indeholde/, `browser "${bad}" skulle vaere afvist`);
  }

  // De gyldige former skal fortsat passere - reglen maa ikke vaere saa stram at
  // den committede plan eller en fremtidig browser-variant falder igennem.
  for (const good of ["desktop-chromium", "mobile_webkit", "chromium-headless-shell", "webkit2.0"]) {
    assert.doesNotThrow(() => parsePlan(withProject(good)), `project "${good}" skulle vaere accepteret`);
    assert.doesNotThrow(() => parsePlan(withBrowser(good)), `browser "${good}" skulle vaere accepteret`);
  }
});

test("expandPlan giver een lane pr. shard med stabile, artifact-sikre navne", () => {
  const lanes = expandPlan(planFixture());
  assert.deepEqual(
    lanes.map((l) => l.key),
    ["desktop-chromium-1of2", "desktop-chromium-2of2", "mobile-webkit-1of3", "mobile-webkit-2of3", "mobile-webkit-3of3"],
  );
  assert.deepEqual(lanes[0], { key: "desktop-chromium-1of2", project: "desktop-chromium", browser: "chromium", shard: "1/2" });
  assert.ok(lanes.every((l) => !l.key.includes("/")), "lane-navnet bliver et artifact-navn - ingen skraastreger");
});

test("renderGithubOutput giver matrix, keys og loft i minutter", () => {
  const out = renderGithubOutput(planFixture());
  const lines = out.split("\n");
  assert.equal(lines.length, 3);
  const matrix = JSON.parse(lines[0].replace(/^matrix=/, ""));
  assert.equal(matrix.length, 5);
  assert.equal(lines[1], "keys=desktop-chromium-1of2,desktop-chromium-2of2,mobile-webkit-1of3,mobile-webkit-2of3,mobile-webkit-3of3");
  assert.equal(lines[2], "ceiling-minutes=10");
});

test("planRecommendations regner laneantal ud af maalt tid pr. projekt", () => {
  const plan = planFixture();
  const shards = [
    lane("desktop-chromium-1of2", "desktop-chromium", 250),
    lane("desktop-chromium-2of2", "desktop-chromium", 250), // 500 / 300 -> 2 laner, praecis planen
    lane("mobile-webkit-1of3", "mobile-webkit", 400),
    lane("mobile-webkit-2of3", "mobile-webkit", 400),
    lane("mobile-webkit-3of3", "mobile-webkit", 400), // 1200 / 300 -> 4 laner, planen har 3
  ];
  const groups = planRecommendations({ shards, plan });
  const desktop = groups.find((g) => g.project === "desktop-chromium");
  const webkit = groups.find((g) => g.project === "mobile-webkit");
  assert.deepEqual(desktop, { project: "desktop-chromium", seconds: 500, planned: 2, recommended: 2, under: false });
  assert.equal(webkit.recommended, 4);
  assert.equal(webkit.under, true, "underforsynet plan skal kunne ses");
});

test("planRecommendations: overforsyning er tilladt og tavs", () => {
  const plan = planFixture();
  const shards = [
    lane("desktop-chromium-1of2", "desktop-chromium", 10),
    lane("desktop-chromium-2of2", "desktop-chromium", 10),
    lane("mobile-webkit-1of3", "mobile-webkit", 10),
    lane("mobile-webkit-2of3", "mobile-webkit", 10),
    lane("mobile-webkit-3of3", "mobile-webkit", 10),
  ];
  for (const g of planRecommendations({ shards, plan })) {
    assert.equal(g.recommended, 1);
    assert.equal(g.under, false, "faerre laner end planlagt maa aldrig faelde noget");
  }
});

test("planRecommendations: en manglende maaling giver INGEN anbefaling for det projekt", () => {
  const plan = planFixture();
  const shards = [
    lane("desktop-chromium-1of2", "desktop-chromium", 250),
    lane("desktop-chromium-2of2", "desktop-chromium", Number.NaN),
    lane("mobile-webkit-1of3", "mobile-webkit", 100),
    lane("mobile-webkit-2of3", "mobile-webkit", 100),
    lane("mobile-webkit-3of3", "mobile-webkit", 100),
  ];
  const desktop = planRecommendations({ shards, plan }).find((g) => g.project === "desktop-chromium");
  assert.equal(desktop.recommended, desktop.planned, "et halvt regnestykke maa ikke kunne saenke et laneantal");
  assert.equal(desktop.under, false);
});

test("underforsynet plan er KUN raadgivende paa en PR, og roed med --enforce-plan", () => {
  const plan = planFixture();
  const shards = [
    lane("desktop-chromium-1of2", "desktop-chromium", 100),
    lane("desktop-chromium-2of2", "desktop-chromium", 100),
    lane("mobile-webkit-1of3", "mobile-webkit", 400),
    lane("mobile-webkit-2of3", "mobile-webkit", 400),
    lane("mobile-webkit-3of3", "mobile-webkit", 400),
  ];
  const projects = expandPlan(plan).map((l) => l.key);

  const onPr = evaluateShards({ shards, budgetMinutes: 10, shardsResult: "success", projects, plan });
  assert.equal(onPr.ok, true, "vaekst maa ALDRIG faelde en tilfaeldig PR - det var praecis #5308's fejlklasse");
  assert.ok(onPr.lines.some((l) => l.startsWith("[info]") && l.includes("mobile-webkit")));

  const nightly = evaluateShards({ shards, budgetMinutes: 10, shardsResult: "success", projects, plan, enforcePlan: true });
  assert.equal(nightly.ok, false, "paa main skal vaeksten meldes");
  assert.ok(nightly.lines.some((l) => l.includes("shard-plan.json") && !l.startsWith("[info]")));
});

test("loftet pr. lane faelder stadig en enkelt loebsk lane, ogsaa med en sund plan", () => {
  const plan = planFixture();
  const projects = expandPlan(plan).map((l) => l.key);
  const shards = [
    lane("desktop-chromium-1of2", "desktop-chromium", 10),
    lane("desktop-chromium-2of2", "desktop-chromium", 10),
    lane("mobile-webkit-1of3", "mobile-webkit", 601),
    lane("mobile-webkit-2of3", "mobile-webkit", 10),
    lane("mobile-webkit-3of3", "mobile-webkit", 10),
  ];
  const res = evaluateShards({ shards, budgetMinutes: 10, shardsResult: "success", projects, plan });
  assert.equal(res.ok, false);
  assert.ok(res.lines.some((l) => l.includes("mobile-webkit-1of3") && l.includes("over loftet")));
});

test("renderSummary viser plan-tabellen naar der er en plan", () => {
  const plan = planFixture();
  const shards = [
    lane("desktop-chromium-1of2", "desktop-chromium", 250),
    lane("desktop-chromium-2of2", "desktop-chromium", 250),
    lane("mobile-webkit-1of3", "mobile-webkit", 400),
    lane("mobile-webkit-2of3", "mobile-webkit", 400),
    lane("mobile-webkit-3of3", "mobile-webkit", 400),
  ];
  const { rows, groups } = evaluateShards({
    shards,
    budgetMinutes: 10,
    shardsResult: "success",
    projects: expandPlan(plan).map((l) => l.key),
    plan,
  });
  const md = renderSummary(rows, 10, groups);
  assert.ok(md.includes("Shard-plan"));
  assert.ok(md.includes("UNDERFORSYNET"));
  assert.ok(md.includes("| mobile-webkit | 20 min 0 s | 3 | 4 | UNDERFORSYNET |"));
});

test("den committede shard-plan er gyldig og daekker de tre Playwright-projekter", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const planPath = join(fileURLToPath(new URL(".", import.meta.url)), "..", "frontend", "tests", "e2e", "shard-plan.json");
  const plan = parsePlan(JSON.parse(readFileSync(planPath, "utf8")));
  assert.deepEqual(
    plan.projects.map((p) => p.project).sort(),
    ["desktop-chromium", "mobile-chromium", "mobile-webkit"],
    "planen skal daekke praecis de projekter playwright.config.js definerer",
  );
  assert.ok(plan.ceilingSeconds >= plan.targetSeconds, "loftet skal ligge over planlaegnings-tallet");
});

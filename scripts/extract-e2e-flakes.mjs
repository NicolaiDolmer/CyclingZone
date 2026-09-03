#!/usr/bin/env node
// scripts/extract-e2e-flakes.mjs
// ============================================================
// Flake-karantaene, del 1: SPORING (#4647, refs #4292).
//
// FEJLKLASSEN: #4292 dokumenterede at Playwright Smoke fejlede praecis 1 test
// af 560 - men en NY test hver gang. `retries: 1` skjuler det: en test der
// fejler foerste gang og bestaar ved retry ender som groen, og ingen ser
// noget. Resultatet er en required check som ingen laengere tror paa.
//
// Dette script goer flaket SYNLIGT uden at goere det blokerende: Playwrights
// JSON-rapport markerer netop den klasse med status "flaky", og her hoestes den
// til `e2e-flakes.json` (CI-artifact). Ingen automatisk issue-oprettelse -
// rapporten er inputtet til en menneskelig/agent-beslutning om karantaene.
//
// Del 2 (selve karantaenen) ligger i workflowet: en test der taggs `@flaky`
// koeres i et separat, ikke-blokerende step (`--grep @flaky`), mens den
// blokerende koersel ekskluderer den (`--grep-invert @flaky`). Karantaene-
// listen er dermed synlig i selve spec-filerne, ikke i en sidekanal.
//
// Brug:
//   node scripts/extract-e2e-flakes.mjs --report frontend/playwright-report/results.json \
//     --project desktop-chromium --out e2e-shard-metrics/flakes-desktop-chromium.json
//   node scripts/extract-e2e-flakes.mjs --merge e2e-shard-metrics --out e2e-flakes.json
//
// Exit 0 uanset fund: rapporten maa aldrig gaette paa at vaere en gate.
//
// Refs #4647 #4292.

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./check-e2e-shard-budget.mjs";

/**
 * Foerste linje af en fejlbesked, trimmet. ANSI-farvekoder fjernes - de goer
 * JSON-rapporten ulaeselig uden at tilfoeje information.
 *
 * @param {unknown} error Playwright-resultatets `error`
 * @returns {string}
 */
export function firstErrorLine(error) {
  const raw = typeof error === "string" ? error : (error && typeof error === "object" && "message" in error ? String(error.message) : "");
  // ANSI-escapes staves med charCode 27 i stedet for et raat ESC-tegn i kilden:
  // et literalt kontroltegn i en .mjs-fil overlever ikke en editor-runde uskadt.
  const clean = raw.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "").trim();
  const line = clean.split(/\r?\n/).find((l) => l.trim().length) || "";
  return line.trim().slice(0, 240);
}

/**
 * Gaar Playwrights JSON-rapport igennem og hoester de tests der bestod ved
 * retry efter en foerste fejl (status "flaky").
 *
 * Formen er rekursiv: `suites[]` kan indeholde baade `suites[]` og `specs[]`,
 * og hver `spec` har en `tests[]` pr. Playwright-projekt.
 *
 * @param {object} report parset results.json
 * @returns {{project: string, file: string, line: number, title: string, attempts: number, error: string}[]}
 */
export function collectFlakes(report) {
  const found = [];
  const walk = (suite) => {
    if (!suite || typeof suite !== "object") return;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        if (test.status !== "flaky") continue;
        const failed = (test.results || []).find((r) => r.status !== "passed");
        found.push({
          project: test.projectName || "",
          file: spec.file || suite.file || "",
          line: Number(spec.line || 0),
          title: spec.title || "",
          attempts: (test.results || []).length,
          error: firstErrorLine(failed?.error),
        });
      }
    }
    for (const child of suite.suites || []) walk(child);
  };
  for (const suite of report?.suites || []) walk(suite);
  return found;
}

/**
 * Bygger rapport-objektet for EN shard.
 *
 * @param {object} report parset results.json
 * @param {string} project
 * @returns {{project: string, generatedAt: string, flakes: ReturnType<typeof collectFlakes>}}
 */
export function buildShardReport(report, project, now = new Date()) {
  const flakes = collectFlakes(report).filter((f) => !project || !f.project || f.project === project);
  return { project, generatedAt: now.toISOString(), flakes };
}

/**
 * Fletter shard-rapporter til EN samlet rapport.
 *
 * @param {{project: string, flakes: object[]}[]} reports
 * @returns {{generatedAt: string, total: number, byProject: Record<string, number>, flakes: object[]}}
 */
export function mergeShardReports(reports, now = new Date()) {
  const flakes = [];
  const byProject = {};
  for (const report of reports) {
    for (const flake of report?.flakes || []) {
      flakes.push(flake);
      const key = flake.project || report.project || "ukendt";
      byProject[key] = (byProject[key] || 0) + 1;
    }
  }
  flakes.sort((a, b) => `${a.project}${a.file}${a.line}`.localeCompare(`${b.project}${b.file}${b.line}`));
  return { generatedAt: now.toISOString(), total: flakes.length, byProject, flakes };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path) || ".", { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main(argv) {
  const args = parseArgs(argv);
  const out = args.out || "e2e-flakes.json";

  if (args.merge) {
    const dir = args.merge;
    const reports = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.startsWith("flakes-") && f.endsWith(".json"))
          .sort()
          .map((f) => readJson(join(dir, f)))
          .filter(Boolean)
      : [];
    const merged = mergeShardReports(reports);
    writeJson(out, merged);
    console.log(`e2e-flakes: ${merged.total} flaky test(s) paa tvaers af ${reports.length} shard(s) -> ${out}`);
    for (const flake of merged.flakes) {
      console.log(`   ${flake.project} ${flake.file}:${flake.line} "${flake.title}" (${flake.attempts} forsoeg) ${flake.error}`);
    }
    return 0;
  }

  const reportPath = args.report || "frontend/playwright-report/results.json";
  const project = args.project || "";
  const report = readJson(reportPath);
  if (!report) {
    // Ingen rapport = suiten naaede aldrig at skrive en (build-fejl, haeng).
    // Skriv en tom rapport, saa samle-jobbets fletning ikke mangler en fil.
    writeJson(out, { project, generatedAt: new Date().toISOString(), flakes: [], note: `ingen JSON-rapport paa ${reportPath}` });
    console.log(`e2e-flakes: ingen JSON-rapport paa ${reportPath}; skrev tom rapport til ${out}`);
    return 0;
  }
  const shardReport = buildShardReport(report, project);
  writeJson(out, shardReport);
  console.log(`e2e-flakes: ${shardReport.flakes.length} flaky test(s) i shard "${project}" -> ${out}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}

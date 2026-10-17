#!/usr/bin/env node
// #6750 Motor-testport: én kommando der tester en kandidat-revision af motoren
// mod den aktuelle paa ALLE kommende loeb og laver ét samlet kort.
//
//   1. Finder de kommende loeb (read-only SELECT i prod, eller en eksisterende
//      eksport: en mappe med <race_id>/cache.json som tourDryRun --save-cache skriver).
//   2. Koerer tourDryRun.mjs pr. loeb (baseline OG kandidat, --seeds seeds) som
//      child-processer, --parallel ad gangen. Genoptagelig: et loeb med `done` springes over.
//   3. Koerer S5-motor-benchen (s5MotorBench, --scope=all) under begge revisioner.
//   4. Samler ét kort (testport.md + testport.json + testport.png) med
//      lib/motorTestportReport.mjs.
//
// HARD RULE 17: kortet indeholder maalte tal og loebsnavne og skrives KUN til
// balance-internals/ (gitignoreret). Scriptet aendrer intet i motoren og skriver
// aldrig til prod (kun SELECT).
//
// Koer:
//   infisical run --env=prod --silent -- node backend/scripts/dev/motorTestport.mjs --candidate=<revision>
//   node backend/scripts/dev/motorTestport.mjs --candidate=<rev> --from-dir=<mappe med <id>/cache.json> --limit=5
//   node backend/scripts/dev/motorTestport.mjs --candidate=<rev> --report-only --out=<tidligere out>
//
// Flag:
//   --candidate=<rev>        revisionen der testes (kraeves)
//   --baseline=<rev>         default: den aktuelle (CURRENT_RACE_RULES_REVISION)
//   --seeds=<n>              seeds pr. revision pr. loeb (default 8)
//   --parallel=<n>           child-processer ad gangen (default 4)
//   --out=<dir>              default balance-internals/<issue>/<dato>/ (dansk dato)
//   --issue=<n>              mappe-navnet i default --out (default 6750)
//   --limit=<n>              kun de foerste n loeb (roegtest)
//   --races=<id,id>          kun disse loeb · --ids-file=<fil> ét id pr. linje
//   --from-dir=<dir>         eksisterende eksport i stedet for prod
//   --include-running        ogsaa loeb hvor foerste etape er koert (default: kun ikke-startede)
//   --no-bench               spring S5-benchen over · --bench-only kun benchen
//   --bench-scope=<s>        default all (gate, gt, all)
//   --report-only            koer intet, saml kortet fra --out
//   --no-png                 spring PNG-kortet over
//
// Refs #6750
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { benchView, buildTestportCard, copenhagenDate, raceResultFromDryRun, renderTestportHtml, renderTestportMarkdown } from "./lib/motorTestportReport.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
const SELF = fileURLToPath(import.meta.url);
const TOUR_DRY_RUN = path.join(here, "tourDryRun.mjs");
const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));

/** Parse CLI-argumenterne (rent, testbart). `defaultBaseline` injiceres (den aktuelle revision). */
export function parseArgs(argv, { defaultBaseline = null, now = new Date() } = {}) {
  const get = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const flag = (name) => argv.includes(`--${name}`);
  const int = (name, fallback, min = 1) => {
    const v = Number(get(name, String(fallback)));
    if (!Number.isInteger(v) || v < min) throw new Error(`--${name} skal vaere et heltal >= ${min}`);
    return v;
  };
  const benchWorker = flag("bench-worker");
  const candidate = get("candidate");
  if (!benchWorker && !candidate && !flag("report-only")) throw new Error("--candidate=<revision> kraeves");
  const baseline = get("baseline", defaultBaseline);
  if (!benchWorker && !baseline && !flag("report-only")) throw new Error("--baseline=<revision> kraeves (den aktuelle revision kunne ikke laeses)");
  const issue = get("issue", "6750");
  if (!/^[\w-]+$/.test(issue)) throw new Error("--issue maa kun indeholde bogstaver, tal, - og _");
  const benchScope = get("bench-scope", get("scope", "all"));
  if (!["gate", "gt", "all"].includes(benchScope)) throw new Error("--bench-scope skal vaere gate, gt eller all");
  const limit = get("limit") === null ? null : int("limit", 1);
  return {
    candidate, baseline,
    seeds: int("seeds", 8),
    parallel: int("parallel", 4),
    issue,
    out: get("out", path.join("balance-internals", issue, copenhagenDate(now))),
    limit,
    raceIds: get("races") ? get("races").split(",").map((s) => s.trim()).filter(Boolean) : null,
    idsFile: get("ids-file"),
    fromDir: get("from-dir"),
    includeRunning: flag("include-running"),
    bench: !flag("no-bench"),
    benchOnly: flag("bench-only"),
    benchScope,
    reportOnly: flag("report-only"),
    png: !flag("no-png"),
    benchWorker,
    revision: get("revision"),
  };
}

/** Unikke, ikke-tomme id'er i raekkefoelge, evt. begraenset til `limit`. */
export function selectRaceIds(ids, limit = null) {
  const seen = [...new Set(ids.map((s) => String(s).trim()).filter(Boolean))];
  return limit ? seen.slice(0, limit) : seen;
}

/** En ids-fil: ét id pr. linje (eller adskilt af mellemrum/komma); # er kommentar. */
export function parseIdsText(text) {
  return String(text).split(/\r?\n/).map((l) => l.replace(/#.*/, "")).flatMap((l) => l.split(/[\s,]+/)).filter(Boolean);
}

/** Loeb i en eksisterende eksport: undermapper med cache.json. */
export function raceIdsFromDir(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, "cache.json")))
    .map((d) => d.name)
    .sort();
}

/**
 * De kommende loeb i prod (READ-ONLY: kun SELECT). Default: ikke afsluttede og
 * ikke startede (ingen etape koert), dvs. de loeb en ny revision binder til.
 */
export async function listUpcomingRaceIds({ includeRunning = false } = {}) {
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (infisical run --env=prod), eller brug --from-dir/--races/--ids-file");
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const ids = [];
  const PAGE = 1000;
  // pagination-safe: .range() i sider af PAGE til en kort side
  for (let from = 0; ; from += PAGE) {
    let q = db.from("races").select("id, scheduled_for, stages_completed").neq("status", "completed");
    if (!includeRunning) q = q.or("stages_completed.is.null,stages_completed.eq.0");
    const { data, error } = await q.order("scheduled_for", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`races: ${error.message}`);
    ids.push(...(data ?? []).map((r) => r.id));
    if (!data || data.length < PAGE) break;
  }
  return ids;
}

/**
 * Argumenterne til tourDryRun.mjs for ét loeb. Samme revision = én koersel
 * (--compare=none). En eksisterende eksport laeses kun (ingen --save-cache);
 * ellers hentes loebet én gang og gemmes i loebsmappen til genkoersler.
 */
export function tourDryRunArgs({ raceId, candidate, baseline, seeds, raceDir, cachePath, saveCache = true }) {
  return [
    TOUR_DRY_RUN, `--race=${raceId}`, `--revision=${candidate}`, `--compare=${candidate === baseline ? "none" : baseline}`,
    `--seeds=${seeds}`, "--no-legacy-ref", `--cache=${cachePath}`, ...(saveCache ? [`--save-cache=${cachePath}`] : []), `--out-dir=${raceDir}`,
  ];
}

/** Opgaverne (loeb + bench) for en koersel. Opgaver med `done` er sprunget over (genoptagelse). */
export function planTasks({ raceIds, opts, outDir, fromDir = null }) {
  const tasks = [];
  if (!opts.benchOnly) {
    for (const raceId of raceIds) {
      const dir = path.join(outDir, "races", raceId);
      const exported = fromDir ? path.join(fromDir, raceId, "cache.json") : null;
      const fromExport = Boolean(exported && existsSync(exported));
      const cachePath = fromExport ? exported : path.join(dir, "cache.json");
      tasks.push({ kind: "race", id: raceId, dir, args: tourDryRunArgs({ raceId, candidate: opts.candidate, baseline: opts.baseline, seeds: opts.seeds, raceDir: dir, cachePath, saveCache: !fromExport }) });
    }
  }
  if (opts.bench) {
    for (const revision of [...new Set([opts.baseline, opts.candidate])]) {
      const dir = path.join(outDir, "bench", revision);
      tasks.push({ kind: "bench", id: `bench:${revision}`, dir, args: [SELF, "--bench-worker", `--revision=${revision}`, `--scope=${opts.benchScope}`, `--out=${dir}`] });
    }
  }
  return tasks.map((t) => ({ ...t, done: existsSync(path.join(t.dir, "done")) }));
}

/**
 * Koerer `tasks` med hoejst `parallel` ad gangen. `run(task)` -> Promise<exitkode>.
 * Returnerer {ok, failed} (id'er). En fejl stopper ikke de andre.
 */
export async function runPool(tasks, parallel, run, { onDone = null } = {}) {
  const queue = tasks.slice();
  const ok = [];
  const failed = [];
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      let code;
      try { code = await run(t); } catch (err) { code = 1; t.error = String(err?.message ?? err); }
      (code === 0 ? ok : failed).push(t.id);
      onDone?.(t, code, { ok: ok.length, failed: failed.length, total: tasks.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, tasks.length)) }, worker));
  return { ok, failed };
}

/** Child-proces med log til <dir>/log.txt og `done` ved exit 0. */
function runChild(task) {
  mkdirSync(task.dir, { recursive: true });
  const fd = openSync(path.join(task.dir, "log.txt"), "w");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, task.args, { cwd: REPO_ROOT, env: process.env, stdio: ["ignore", fd, fd] });
    child.on("error", () => { closeSync(fd); resolve(1); });
    child.on("close", (code) => {
      closeSync(fd);
      if (code === 0) writeFileSync(path.join(task.dir, "done"), `${new Date().toISOString()}\n`);
      resolve(code ?? 1);
    });
  });
}

/** Den nyeste tourDryRun-JSON i en loebsmappe (navnene ender paa -YYYY-MM-DD-HH-MM.json). */
export function latestDryRunJson(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "cache.json");
  if (!files.length) return null;
  files.sort((a, b) => statSync(path.join(dir, a)).mtimeMs - statSync(path.join(dir, b)).mtimeMs || a.localeCompare(b));
  return path.join(dir, files[files.length - 1]);
}

/**
 * Hard rule 17: maalte tal og loebsdata maa kun skrives under en mappe der
 * hedder balance-internals (gitignoreret i repoet, privat i OneDrive-context).
 */
export function assertPrivateOutDir(dir) {
  const segments = path.resolve(dir).split(/[\\/]+/);
  if (!segments.includes("balance-internals")) throw new Error(`--out skal ligge under en balance-internals/-mappe (hard rule 17): ${dir}`);
  return dir;
}

/**
 * Saml kortet fra en out-mappe. De forventede loeb er ids.txt (hvis den findes);
 * et forventet loeb uden et laesbart scorecard er en FEJL paa kortet
 * (`missingScorecards`), aldrig et stille mindre datasaet.
 */
export function collectCard({ outDir, baseline, candidate, meta, benchScope = meta?.benchScope ?? "all" }) {
  const racesDir = path.join(outDir, "races");
  const idsFile = path.join(outDir, "ids.txt");
  const expected = existsSync(idsFile) ? parseIdsText(readFileSync(idsFile, "utf8")) : [];
  const present = existsSync(racesDir) ? readdirSync(racesDir).sort() : [];
  const raceResults = [];
  const missingScorecards = [];
  for (const id of [...new Set([...expected, ...present])]) {
    const file = latestDryRunJson(path.join(racesDir, id));
    if (!file) { missingScorecards.push(`${id} (intet scorecard)`); continue; }
    try {
      const rr = raceResultFromDryRun(JSON.parse(readFileSync(file, "utf8")));
      if (rr) raceResults.push(rr);
      else missingScorecards.push(`${id} (tomt scorecard)`);
    } catch (err) {
      missingScorecards.push(`${id} (${err.message})`);
    }
  }
  const benchByRevision = {};
  for (const revision of [...new Set([baseline, candidate])]) {
    const file = path.join(outDir, "bench", revision, `motor-bench-${benchScope}.json`);
    if (existsSync(file)) benchByRevision[revision] = benchView(JSON.parse(readFileSync(file, "utf8")));
  }
  return buildTestportCard({ raceResults, baseline, candidate, benchByRevision, meta: { ...meta, missingScorecards } });
}

/** PNG af kortets overblik via Playwright fra frontend/node_modules. Best-effort. */
async function renderPng(html, file) {
  const pw = path.join(REPO_ROOT, "frontend", "node_modules", "@playwright", "test", "index.mjs");
  if (!existsSync(pw)) return "Playwright findes ikke i frontend/node_modules";
  const { chromium } = await import(pathToFileURL(pw).href);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
    await page.setContent(html);
    await page.screenshot({ path: file, fullPage: true });
  } finally {
    await browser.close();
  }
  return null;
}

/** --bench-worker: S5-motor-benchen under én revision (child-proces). */
async function benchWorker(opts) {
  if (!opts.revision) throw new Error("--bench-worker kraever --revision");
  const { buildS5BenchRaces, runS5MotorBench, summarizeS5MotorBench, renderS5MotorBenchMarkdown, loadWinnerThresholds, S5_MOTOR_BENCH_CONFIG } = await import("./s5MotorBench.mjs");
  const { loadS5Benchmark } = await import("../../lib/s5BenchmarkGate.js");
  const config = { ...S5_MOTOR_BENCH_CONFIG, revision: opts.revision };
  const dir = assertPrivateOutDir(abs(opts.out));
  const t0 = performance.now();
  const rows = await runS5MotorBench({ races: buildS5BenchRaces({ scope: opts.benchScope }), revision: opts.revision });
  const summary = summarizeS5MotorBench(rows, loadS5Benchmark());
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `motor-bench-${opts.benchScope}.json`), JSON.stringify({ config, scope: opts.benchScope, summary, rows }, null, 2));
  writeFileSync(path.join(dir, `motor-bench-${opts.benchScope}.md`), renderS5MotorBenchMarkdown(summary, { scope: opts.benchScope, config, thresholds: loadWinnerThresholds() }));
  console.log(`${rows.length} etape-koersler paa ${((performance.now() - t0) / 1000).toFixed(1)} s (${opts.revision})`);
}

async function defaultBaseline() {
  try {
    const { CURRENT_RACE_RULES_REVISION } = await import("../../lib/raceEngineRulesRevision.ts");
    return CURRENT_RACE_RULES_REVISION;
  } catch {
    return null;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv, { defaultBaseline: await defaultBaseline() });
  if (opts.benchWorker) return benchWorker(opts);
  const outDir = assertPrivateOutDir(abs(opts.out));
  const metaFile = path.join(outDir, "testport-meta.json");
  const prev = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : null;
  if (opts.reportOnly) {
    // Kortet samles igen med koerslens EGNE parametre; meta-filen roeres ikke.
    if (!prev) throw new Error(`--report-only: ${metaFile} findes ikke`);
    const card = collectCard({ outDir, baseline: prev.baseline, candidate: prev.candidate, meta: { ...prev, generatedAt: new Date().toISOString() } });
    return writeCard({ card, outDir, png: opts.png, failed: prev.failedRaces ?? [] });
  }
  if (prev && (prev.candidate !== opts.candidate || prev.baseline !== opts.baseline || prev.seeds !== opts.seeds || (prev.benchScope ?? "all") !== opts.benchScope)) {
    throw new Error(`${outDir} er en anden koersel (${prev.baseline} -> ${prev.candidate}, ${prev.seeds} seeds, bench ${prev.benchScope}). Brug en ny --out.`);
  }
  mkdirSync(outDir, { recursive: true });

  let source = prev?.source ?? null;
  let raceIds = [];
  const fromDir = opts.fromDir ? abs(opts.fromDir) : null;
  if (!opts.benchOnly) {
    if (opts.raceIds) { raceIds = opts.raceIds; source = "--races"; }
    else if (opts.idsFile) { raceIds = parseIdsText(readFileSync(abs(opts.idsFile), "utf8")); source = `--ids-file ${path.basename(opts.idsFile)}`; }
    else if (fromDir) { raceIds = raceIdsFromDir(fromDir); source = `--from-dir ${path.basename(fromDir)}`; }
    else { raceIds = await listUpcomingRaceIds({ includeRunning: opts.includeRunning }); source = opts.includeRunning ? "prod (ikke afsluttede)" : "prod (ikke startede)"; }
    raceIds = selectRaceIds(raceIds, opts.limit);
    writeFileSync(path.join(outDir, "ids.txt"), `${raceIds.join("\n")}\n`);
  }
  const meta = { candidate: opts.candidate, baseline: opts.baseline, seeds: opts.seeds, parallel: opts.parallel, source, limit: opts.limit ?? prev?.limit ?? null, benchScope: opts.benchScope };
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  const tasks = planTasks({ raceIds, opts, outDir, fromDir });
  const todo = tasks.filter((t) => !t.done);
  console.log(`${tasks.length} opgaver (${tasks.length - todo.length} allerede faerdige), ${opts.parallel} ad gangen: ${opts.baseline} -> ${opts.candidate}, ${opts.seeds} seeds`);
  const res = await runPool(todo, opts.parallel, runChild, {
    onDone: (t, code, p) => console.log(`[${p.ok + p.failed}/${p.total}] ${t.id}: ${code === 0 ? "ok" : `FEJL (exit ${code}, se ${path.relative(REPO_ROOT, path.join(t.dir, "log.txt"))})`}`),
  });
  meta.failedRaces = res.failed;
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  const card = collectCard({ outDir, baseline: opts.baseline, candidate: opts.candidate, meta: { ...meta, generatedAt: new Date().toISOString() } });
  return writeCard({ card, outDir, png: opts.png, failed: res.failed });
}

/** Skriv kortet (md + json + evt. png). Fejlede opgaver eller manglende scorecards = exit 1. */
async function writeCard({ card, outDir, png, failed }) {
  writeFileSync(path.join(outDir, "testport.json"), JSON.stringify(card, null, 2));
  writeFileSync(path.join(outDir, "testport.md"), renderTestportMarkdown(card));
  if (png) {
    try {
      const why = await renderPng(renderTestportHtml(card), path.join(outDir, "testport.png"));
      if (why) console.warn(`PNG sprunget over: ${why}`);
    } catch (err) {
      console.warn(`PNG sprunget over: ${err.message}`);
    }
  }
  const missing = card.meta?.missingScorecards ?? [];
  console.log(`Kort: ${path.join(outDir, "testport.md")} (+ .json${png ? ", .png" : ""}) · ${card.races} loeb${failed.length ? ` · ${failed.length} opgaver FEJLEDE` : ""}${missing.length ? ` · ${missing.length} scorecards mangler` : ""}`);
  if (failed.length || missing.length) process.exitCode = 1;
  return { card, outDir, failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => { console.error(err?.stack ?? err); process.exit(1); });
}

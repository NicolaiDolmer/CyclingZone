// #6285 spor 5: gate-scriptet for den rene motor-revision (spec §4, trin 1-5).
//
// ETT svar, GREEN eller RED, med aarsag pr. trin. Scriptet orkestrerer
// EKSISTERENDE vaerktoejer og har ingen egen maale-logik i motoren:
//   1. Laaste regler paa hver simulering: tourDryRun.mjs (Tour-cache + Giro-
//      fixture, udbrudsmaal, tidsregler, trappen) og descentFinish6200.mjs (D1/D3).
//   2. Hver meldt fejl har en test: spor-testfilerne koeres med node --test.
//   3. Rigtig cykelsport og den tidligere motor: ankre (headToHeadAnchors via
//      v4FlipReadiness.mjs) for revisionen og for --baseline, med regressionstjek.
//   4. Styrke straffes aldrig: monotoni-testene i motoren.
//   5. Loeb der koerer roeres ikke: frosne digests for aeldre revisioner.
// Trin 6 (uafhaengig dommer) og 7 (ejer siger "taend") er menneskelige og ligger
// uden for scriptet; GREEN her er en forudsaetning for dem, ikke en tilladelse.
//
// Princip: "ikke maalt" er aldrig groent. Et vaerktoej der mangler, fejler,
// ikke findes, eller en testfil der ikke findes, giver FAIL for trinnet.
//
// READ-ONLY: ingen DB, ingen prod. Tal og rapporter skrives KUN til
// balance-internals/clean-revision/ (gitignoreret; hard rule 17). Stdout er det
// rene JSON-svar.
//
// Koer (fra repo-roden):
//   node backend/scripts/dev/cleanRevisionGate.mjs --revision=official_times_v3 --baseline=official_times_v2 --seeds=12 [--cache=balance-internals/tour-11-10/cache.json]
// Exit 0 kun ved GREEN.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
const BACKEND = path.join(REPO_ROOT, "backend");

export const DEFAULT_REVISION = "official_times_v3";
export const DEFAULT_BASELINE = "official_times_v2";
export const DEFAULT_SEEDS = 12;
export const DEFAULT_CACHE = "balance-internals/tour-11-10/cache.json";
export const OUT_DIR = "balance-internals/clean-revision";

/** Trinnene i raekkefoelge (spec §4, de fem automatiserbare). */
export const STEP_NAMES = Object.freeze({
  1: "Laaste regler paa hver simulering (Tour-cache, Giro, D1/D3, udbrud)",
  2: "Hver meldt fejl har en test",
  3: "Ankre mod virkelig cykelsport og mod den tidligere motor",
  4: "Styrke straffes aldrig (monotoni)",
  5: "Loeb der koerer roeres ikke (frosne digests)",
});

/** Spor-testfilerne (relativt til backend/). Mangler en, fejler trin 2. */
export const TRACK_TEST_FILES = Object.freeze([
  "lib/engine/v4/cleanRevisionClimb.test.ts",
  "lib/engine/v4/mechanics/breakawaySize6201.test.ts",
  "lib/engine/v4/mechanics/breakawayMargin6428.test.ts",
  "lib/engine/v4/mechanics/breakawayDropped6185.test.ts",
  "lib/engine/v4/formCleanRevision.test.ts",
  "lib/raceEngineV4Bridge.formCleanRevision.test.js",
  "lib/engine/v4/mechanics/individualTimeTrial.test.ts",
  "lib/engine/v4/mechanics/leadout.test.ts",
  "lib/raceClassifications.test.js",
]);

/** Frosne digests for aeldre revisioner (relativt til backend/). */
export const FROZEN_TEST_FILES = Object.freeze([
  "lib/engine/v4/officialTimesV2Frozen6200.test.ts",
  "lib/engine/v4/oldRevisionDigests6199.test.ts",
]);

export const DESCENT_SCRIPT = "scripts/dev/descentFinish6200.mjs";
export const TOUR_SCRIPT = "scripts/dev/tourDryRun.mjs";
export const FLIP_SCRIPT = "scripts/v4FlipReadiness.mjs";
export const MONOTONY_DIR = "lib/engine/v4";

export function parseArgs(argv) {
  const get = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(`--${name}=`.length) : fallback;
  };
  const seeds = Number(get("seeds", String(DEFAULT_SEEDS)));
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error("--seeds skal vaere et positivt heltal");
  return {
    revision: get("revision", DEFAULT_REVISION),
    baseline: get("baseline", DEFAULT_BASELINE),
    seeds,
    cache: get("cache", DEFAULT_CACHE),
    outDir: get("out-dir", OUT_DIR),
  };
}

// ---------------------------------------------------------------------------
// Ren logik: samling af trin til ét svar
// ---------------------------------------------------------------------------

/** Et trin i den form svaret har. Alt der ikke er et eksplicit PASS er FAIL. */
export function makeStep(id, result) {
  const name = STEP_NAMES[id];
  if (!result || typeof result !== "object") return { id, name, status: "FAIL", reasons: ["ikke maalt: trinnet gav ingen data"] };
  const reasons = Array.isArray(result.reasons) ? result.reasons.map(String) : [];
  if (result.status === "PASS") return { id, name, status: "PASS", reasons };
  if (result.status === "FAIL") return { id, name, status: "FAIL", reasons: reasons.length ? reasons : ["fejlet uden aarsag"] };
  return { id, name, status: "FAIL", reasons: [`ikke maalt: ugyldig status ${JSON.stringify(result.status)}`, ...reasons] };
}

/**
 * GREEN kun hvis ALLE fem trin findes og er PASS. Et manglende trin, et ekstra
 * ukendt trin eller et tomt resultat er RED. `results` er {id: {status, reasons}}.
 */
export function assembleVerdict(results) {
  const steps = [1, 2, 3, 4, 5].map((id) => makeStep(id, results?.[id]));
  const verdict = steps.every((s) => s.status === "PASS") ? "GREEN" : "RED";
  return { verdict, steps };
}

export function exitCodeFor(report) {
  return report.verdict === "GREEN" ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Ren logik: dom over de eksisterende vaerktoejers output
// ---------------------------------------------------------------------------

/**
 * Dom over tourDryRun-JSON for ét felt. Alle domme i scorecardet for den
 * maalte revision skal vaere groenne: ingen FAIL, ingen aabne gates (TODO).
 * WARN er inden for tolerancen i scorecardets egne baand og fejler ikke, men
 * rapporteres. Intet ny taerskel opfindes her.
 */
export function judgeTourJson(json, revision, label) {
  const run = json?.runs?.find((r) => r.revision === revision);
  if (!run?.summary) return { status: "FAIL", reasons: [`${label}: ingen kørsel for ${revision} i scorecardet (ikke maalt)`] };
  const s = run.summary;
  const reasons = [];
  const fails = [];
  for (const st of s.stages ?? []) for (const [k, v] of Object.entries(st.verdicts ?? {})) if (v === "FAIL") fails.push(`etape ${st.stage} ${k}`);
  for (const c of s.classes ?? []) for (const [k, v] of Object.entries(c.verdicts ?? {})) if (v === "FAIL") fails.push(`klasse ${c.profile_type} ${k}`);
  for (const [k, v] of Object.entries(s.race?.verdicts ?? {})) if (v === "FAIL") fails.push(`loeb ${k}`);
  const counts = s.counts ?? {};
  if (!s.counts) reasons.push(`${label}: scorecardet har ingen domme (ikke maalt)`);
  if ((counts.FAIL ?? 0) > 0) reasons.push(`${label}: ${counts.FAIL} FAIL (${fails.slice(0, 12).join("; ")}${fails.length > 12 ? "; ..." : ""})`);
  if ((counts.TODO ?? 0) > 0) reasons.push(`${label}: ${counts.TODO} aabne gates (TODO) er ikke groenne`);
  const total = (counts.PASS ?? 0) + (counts.WARN ?? 0) + (counts.FAIL ?? 0);
  if (s.counts && total === 0) reasons.push(`${label}: ingen maalte domme (ikke maalt)`);
  return { status: reasons.length ? "FAIL" : "PASS", reasons, warn: counts.WARN ?? 0 };
}

/**
 * Dom over v4FlipReadiness-JSON: alle ankre groenne og maalt, realistisk felt
 * uden FAIL, hale-gaten PASS. Med baseline: ingen anker der bestod for baseline
 * er faldet fra PASS i den nye revision.
 */
export function judgeAnchorsJson(json, baselineJson, revision, baseline) {
  if (!json?.anchors?.rows) return { status: "FAIL", reasons: [`ankre for ${revision}: ingen data (ikke maalt)`] };
  const reasons = [];
  const a = json.anchors;
  if (a.v4Fail?.length) reasons.push(`ankre FAIL for ${revision}: ${a.v4Fail.join(", ")}`);
  if (a.v4NotMeasured?.length) reasons.push(`ankre ikke maalt for ${revision}: ${a.v4NotMeasured.join(", ")}`);
  const rf = json.realisticField?.anchors;
  if (!rf) reasons.push(`realistisk felt: ingen data for ${revision} (ikke maalt)`);
  else {
    const bad = rf.filter((x) => x.verdict !== "PASS").map((x) => `${x.id ?? x.label}=${x.verdict}`);
    if (bad.length) reasons.push(`realistisk felt ikke groent for ${revision}: ${bad.join(", ")}`);
  }
  if (json.tailGate?.allPass !== true) reasons.push(`hale-gaten er ikke PASS for ${revision}`);
  if (!baselineJson?.anchors?.rows) reasons.push(`før/efter: ingen data for baseline ${baseline} (ikke maalt)`);
  else {
    const was = new Map(baselineJson.anchors.rows.map((r) => [r.id, r.v4.verdict]));
    const regress = a.rows.filter((r) => was.get(r.id) === "PASS" && r.v4.verdict !== "PASS").map((r) => r.id);
    if (regress.length) reasons.push(`regression mod ${baseline} (PASS -> ikke PASS): ${regress.join(", ")}`);
  }
  return { status: reasons.length ? "FAIL" : "PASS", reasons };
}

// ---------------------------------------------------------------------------
// Orkestrering (afhaengigheder injiceres, saa den kan testes uden motor)
// ---------------------------------------------------------------------------

function tail(text, n = 400) {
  const t = String(text ?? "").trim();
  return t.length > n ? `...${t.slice(-n)}` : t;
}

/** Koer node-testfiler (relativt til backend/). Mangler filer: FAIL, men de der findes koeres alligevel. */
function runTestFiles({ files, deps, label }) {
  const missing = files.filter((f) => !deps.exists(path.join(deps.backend, f)));
  const present = files.filter((f) => !missing.includes(f));
  const reasons = missing.map((f) => `${label}: testfilen findes ikke (${f}), ikke maalt`);
  if (!present.length) return { status: "FAIL", reasons: reasons.length ? reasons : [`${label}: ingen testfiler (ikke maalt)`] };
  const r = deps.runNode(["--test", ...present], { cwd: deps.backend });
  if (r.status !== 0) reasons.push(`${label}: node --test fejlede (exit ${r.status}${r.error ? `, ${r.error}` : ""}): ${tail(r.stderr || r.stdout)}`);
  return { status: reasons.length ? "FAIL" : "PASS", reasons };
}

function runJsonTool({ script, args, jsonPath, deps, label }) {
  if (!deps.exists(path.join(deps.backend, script))) return { error: `${label}: ${script} findes ikke (ikke maalt)` };
  const r = deps.runNode([path.join(deps.backend, script), ...args], { cwd: deps.root });
  if (r.status !== 0) return { error: `${label}: ${script} fejlede (exit ${r.status}${r.error ? `, ${r.error}` : ""}): ${tail(r.stderr || r.stdout)}` };
  const found = jsonPath();
  if (!found) return { error: `${label}: ${script} skrev ingen JSON (ikke maalt)` };
  try {
    return { json: deps.readJson(found) };
  } catch (e) {
    return { error: `${label}: kunne ikke laese ${found}: ${e.message}` };
  }
}

/**
 * D1/D3: bedoemmer descentFinish6200.mjs' markdown-rapport. Scriptet regner
 * kontrakten (loft/nr10/klatrer/placering, "Samlet" = PASS|FAIL) pr. etape og
 * seed, men afslutter med exit 0 uanset udfaldet, saa gaten laeser tabellen
 * "Kontrakten pr. seed" (10 kolonner: revision, etape, seed, ..., Samlet).
 * Kun revisionen under test bedoemmes (baseline maa gerne bryde kontrakten).
 * Ingen raekker for revisionen, eller en ulaeselig "Samlet", er ikke maalt = FAIL.
 */
export function judgeDescentReport(md, revision) {
  const reasons = [];
  let inSeedTable = false;
  let rows = 0;
  for (const line of String(md ?? "").split(/\r?\n/)) {
    if (/^##\s/.test(line)) inSeedTable = /Kontrakten pr\. seed/.test(line);
    if (!inSeedTable || !line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 10 || cells[0] !== revision) continue;
    rows++;
    const samlet = cells[cells.length - 1];
    if (samlet === "FAIL") reasons.push(`D1/D3: kontrakten brydes i ${revision} etape ${cells[1]} seed ${cells[2]} (loft ${cells[5]}; nr. 10 ${cells[6]}; klatrer ${cells[7]}; placering ${cells[8]})`);
    else if (samlet !== "PASS") reasons.push(`D1/D3: ulaeselig Samlet "${samlet}" i ${revision} etape ${cells[1]} seed ${cells[2]} (ikke maalt)`);
  }
  if (!rows) reasons.push(`D1/D3: rapporten har ingen kontrakt-raekker for ${revision} (ikke maalt)`);
  return { reasons };
}

export function step1({ opts, deps, outBase, revisionKnown }) {
  if (!revisionKnown) return { status: "FAIL", reasons: [`revisionen ${opts.revision} findes ikke i RACE_RULES_REVISIONS; intet kan maales (ikke maalt)`] };
  const reasons = [];
  const fields = [
    { label: "Tour-cache", args: [`--cache=${deps.cachePath ?? opts.cache}`], dir: `${outBase}/tour-cache` },
    { label: "Giro-fixture", args: ["--fixture=giro"], dir: `${outBase}/tour-giro` },
  ];
  for (const f of fields) {
    if (f.label === "Tour-cache" && !deps.exists(deps.cachePath ?? deps.abs(opts.cache))) {
      reasons.push(`Tour-cache: ${opts.cache} findes ikke (ikke maalt)`);
      continue;
    }
    const out = runJsonTool({
      script: TOUR_SCRIPT,
      args: [...f.args, `--revision=${opts.revision}`, `--compare=${opts.baseline}`, `--seeds=${opts.seeds}`, `--out-dir=${f.dir}`],
      jsonPath: () => deps.latestJson(deps.abs(f.dir)),
      deps,
      label: f.label,
    });
    if (out.error) reasons.push(out.error);
    else reasons.push(...judgeTourJson(out.json, opts.revision, f.label).reasons);
  }
  // D1/D3 (nedkoersel/klatring). Findes vaerktoejet ikke, er D1/D3 ikke maalt.
  const descentOut = `${outBase}/descent.md`;
  if (!deps.exists(path.join(deps.backend, DESCENT_SCRIPT))) {
    reasons.push(`D1/D3: ${DESCENT_SCRIPT} findes ikke (ikke maalt)`);
  } else {
    const r = deps.runNode([path.join(deps.backend, DESCENT_SCRIPT), "--fixture=giro", `--revision=${opts.revision},${opts.baseline}`, `--seeds=${opts.seeds}`, `--out=${descentOut}`], { cwd: deps.root });
    if (r.status !== 0) reasons.push(`D1/D3: ${DESCENT_SCRIPT} fejlede (exit ${r.status}): ${tail(r.stderr || r.stdout)}`);
    else if (!deps.exists(deps.abs(descentOut))) reasons.push(`D1/D3: ${DESCENT_SCRIPT} skrev ingen rapport (ikke maalt)`);
    else reasons.push(...judgeDescentReport(deps.readText(deps.abs(descentOut)), opts.revision).reasons);
  }
  return { status: reasons.length ? "FAIL" : "PASS", reasons };
}

export function step2({ deps }) {
  return runTestFiles({ files: [...TRACK_TEST_FILES], deps, label: "spor-test" });
}

export function step3({ opts, deps, outBase, revisionKnown }) {
  if (!revisionKnown) return { status: "FAIL", reasons: [`revisionen ${opts.revision} findes ikke i RACE_RULES_REVISIONS; ankre kan ikke maales (ikke maalt)`] };
  const run = (rev, tag) => runJsonTool({
    script: FLIP_SCRIPT,
    args: [`--rules=${rev}`, "--skip-tests", `--json=${outBase}/anchors-${tag}.json`, `--private-out=${outBase}/anchors-${tag}.md`],
    jsonPath: () => (deps.exists(deps.abs(`${outBase}/anchors-${tag}.json`)) ? deps.abs(`${outBase}/anchors-${tag}.json`) : null),
    deps,
    label: `ankre ${rev}`,
  });
  const cur = run(opts.revision, "revision");
  if (cur.error) return { status: "FAIL", reasons: [cur.error] };
  const base = run(opts.baseline, "baseline");
  const r = judgeAnchorsJson(cur.json, base.error ? null : base.json, opts.revision, opts.baseline);
  if (base.error) r.reasons.unshift(base.error);
  return { status: r.reasons.length ? "FAIL" : "PASS", reasons: r.reasons };
}

export function step4({ deps }) {
  const dir = path.join(deps.backend, MONOTONY_DIR);
  const files = deps.listTestFiles(dir)
    .filter((f) => /monoton/i.test(deps.readText(path.join(dir, f))))
    .map((f) => `${MONOTONY_DIR}/${f}`);
  if (!files.length) return { status: "FAIL", reasons: ["ingen monotoni-tests fundet i motoren (ikke maalt)"] };
  return runTestFiles({ files, deps, label: "monotoni" });
}

export function step5({ deps }) {
  return runTestFiles({ files: [...FROZEN_TEST_FILES], deps, label: "frosne digests" });
}

/** Koer alle fem trin. Et trin der kaster, er FAIL, aldrig et crash af hele svaret. */
export function runGate({ opts, deps }) {
  const outBase = `${opts.outDir}/run-${deps.stamp()}`;
  const revisionKnown = deps.revisionKnown(opts.revision);
  const results = {};
  const fns = { 1: step1, 2: step2, 3: step3, 4: step4, 5: step5 };
  for (const id of [1, 2, 3, 4, 5]) {
    try {
      results[id] = fns[id]({ opts, deps, outBase, revisionKnown });
    } catch (e) {
      results[id] = { status: "FAIL", reasons: [`trinnet kastede: ${e.message}`] };
    }
  }
  return { revision: opts.revision, baseline: opts.baseline, seeds: opts.seeds, ...assembleVerdict(results) };
}

export function renderMarkdown(report, generatedAt) {
  const lines = [`# Ren motor-revision: gate ${report.verdict}`, "", `Revision \`${report.revision}\` mod \`${report.baseline}\`, ${report.seeds} seeds. ${generatedAt}.`, "", "| Trin | Navn | Status |", "|---|---|---|"];
  for (const s of report.steps) lines.push(`| ${s.id} | ${s.name} | ${s.status} |`);
  lines.push("", "Trin 6 (uafhaengig dommer) og 7 (ejerens \"taend\") ligger uden for scriptet.", "");
  for (const s of report.steps.filter((x) => x.reasons.length)) {
    lines.push(`## Trin ${s.id}: ${s.name} (${s.status})`, "", ...s.reasons.map((r) => `- ${r}`), "");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Rigtige afhaengigheder
// ---------------------------------------------------------------------------

/** Balance-internals kan ligge i hoved-checkoutet, naar vi koerer i et worktree. */
export function resolveCache(cache, root = REPO_ROOT) {
  if (path.isAbsolute(cache)) return cache;
  const local = path.join(root, cache);
  if (existsSync(local)) return local;
  const g = spawnSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  if (g.status === 0) {
    const main = path.join(path.dirname(g.stdout.trim()), cache);
    if (existsSync(main)) return main;
  }
  return local;
}

export function realDeps(opts) {
  const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));
  return {
    root: REPO_ROOT,
    backend: BACKEND,
    abs,
    cachePath: resolveCache(opts.cache),
    exists: (p) => existsSync(p),
    readJson: (p) => JSON.parse(readFileSync(p, "utf8")),
    readText: (p) => readFileSync(p, "utf8"),
    // Unik pr. koersel (sekund, ms, pid): to koersler maa aldrig dele en run-mappe og laese hinandens JSON.
    stamp: () => `${new Date().toISOString().replace(/[:.T]/g, "-")}-${process.pid}`,
    runNode: (args, { cwd }) => {
      const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error?.message ?? null };
    },
    listTestFiles: (dir) => {
      if (!existsSync(dir)) return [];
      const out = [];
      const walk = (d, rel) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(d, e.name), path.posix.join(rel, e.name));
          else if (e.isFile() && e.name.endsWith(".test.ts")) out.push(path.posix.join(rel, e.name));
        }
      };
      walk(dir, "");
      return out;
    },
    latestJson: (dir) => {
      if (!existsSync(dir)) return null;
      const js = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f));
      js.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      return js[0] ?? null;
    },
    revisionKnown: (rev) => {
      const src = readFileSync(path.join(BACKEND, "lib", "raceEngineRulesRevision.ts"), "utf8");
      const m = src.match(/RACE_RULES_REVISIONS\s*=\s*\[([^\]]*)\]/);
      return !!m && m[1].split(",").map((s) => s.trim().replace(/["']/g, "")).includes(rev);
    },
  };
}

export function main(argv = process.argv.slice(2), deps = null) {
  const opts = parseArgs(argv);
  const d = deps ?? realDeps(opts);
  const report = runGate({ opts, deps: d });
  const generatedAt = new Date().toISOString();
  const outDir = d.abs(opts.outDir);
  mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `gate-${generatedAt.slice(0, 16).replace(/[:T]/g, "-")}`);
  writeFileSync(`${base}.json`, JSON.stringify({ ...report, generatedAt }, null, 2));
  writeFileSync(`${base}.md`, renderMarkdown(report, generatedAt));
  console.error(`Gate-rapport: ${base}.md (+ .json)`);
  console.log(JSON.stringify(report, null, 2));
  return { report, exitCode: exitCodeFor(report) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main().exitCode;
}

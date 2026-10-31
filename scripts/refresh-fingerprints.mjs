#!/usr/bin/env node
// #7336 punkt 4: genberegn de låste motor-fingeraftryk i ét trin og vis kun dommene.
//
//   node scripts/refresh-fingerprints.mjs                 (= --check: skriver intet, exit 1 ved drift)
//   node scripts/refresh-fingerprints.mjs --write         (skriver kun allowlisten)
//   node scripts/refresh-fingerprints.mjs --write --accept-verdict-change   (kun med ejer-go)
//   node scripts/refresh-fingerprints.mjs --only=6912,bench,calendar --thresholds=<fil> --json
//
// Dele:
//   frosne    6199/6200/6363-digests og #6912 v1/v2. Altid kun tjek; rød = REGRESSION, intet skrives.
//   6912      v3-nøglerne i flatChase6912Digests.json (otherTerrain, otherOneDay).
//   bench     s5MotorBench.json: gab-dom, vindertype-dom og winnerDigests. Én bench-kørsel.
//   calendar  calendarGoldenSnapshot.s3.json, kun med --only=calendar.
//
// Output er KUN domme (uændret/drevet/skrevet/dom ændret/regression). Scriptet printer
// aldrig målte tal, medianer, tærskler eller tærskelfilens indhold (hard rule 17); motorens
// egen konsol-output dæmpes under kørslen. Det skriver aldrig andre filer end allowlisten,
// og en git-vagt gendanner enhver anden ændret fil og giver exit 2.
//
// Exit: 0 alt uændret eller skrevet · 1 drift/dom ændret/regression · 2 vagt eller brugsfejl.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..");

export const PATHS = Object.freeze({
  flatChase: "backend/lib/engine/v4/test-data/flatChase6912Digests.json",
  bench: "backend/lib/__fixtures__/s5MotorBench.json",
  calendar: "backend/lib/__fixtures__/calendarGoldenSnapshot.s3.json",
});

/** Filer scriptet aldrig må skrive. ratingGolden kræver ejer-go; de frosne er regressionsvagter. */
export const NEVER_WRITABLE = Object.freeze([
  "frontend/src/lib/__fixtures__/ratingGolden.5321.json",
  "backend/lib/engine/v4/test-data/oldRevisionDigests6199.json",
  "backend/lib/engine/v4/test-data/s5UntouchedDigests6363.json",
  "backend/lib/engine/v4/test-data/officialTimesV2Frozen6200.json",
  "backend/lib/engine/v4/test-data/groupClockLegacy6199.json",
]);

/** Testene der vogter de frosne digests (kører fra backend/). */
export const FROZEN_TESTS = Object.freeze([
  "lib/engine/v4/oldRevisionDigests6199.test.ts",
  "lib/engine/v4/s5Profiles6363.test.ts",
  "lib/engine/v4/officialTimesV2Frozen6200.test.ts",
  "lib/officialStageTimesIntegration6284.test.ts",
  "lib/engine/v4/cleanRevisionClimb.test.ts",
  "lib/engine/v4/mountainGaps6440.test.ts",
]);

export const PARTS = Object.freeze(["6912", "bench", "calendar"]);
export const DEFAULT_ONLY = Object.freeze(["6912", "bench"]);

/** Hård allowlist: de eneste stier en --write-kørsel må ændre. */
export function writablePaths(only = DEFAULT_ONLY) {
  const out = [];
  if (only.includes("6912")) out.push(PATHS.flatChase);
  if (only.includes("bench")) out.push(PATHS.bench);
  if (only.includes("calendar")) out.push(PATHS.calendar);
  for (const p of out) if (NEVER_WRITABLE.includes(p)) throw new Error(`allowlisten indeholder en låst fil: ${p}`);
  return out;
}

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { mode: "check", only: [...DEFAULT_ONLY], acceptVerdictChange: false, thresholds: null, json: false, debug: false };
  let sawCheck = false;
  let sawWrite = false;
  for (const a of argv) {
    if (a === "--check") sawCheck = true;
    else if (a === "--write") sawWrite = true;
    else if (a === "--accept-verdict-change") opts.acceptVerdictChange = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--debug") opts.debug = true;
    else if (a.startsWith("--only=")) {
      const parts = a.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean);
      const bad = parts.filter((p) => !PARTS.includes(p));
      if (bad.length || !parts.length) throw new UsageError(`--only kender kun ${PARTS.join(",")}`);
      opts.only = [...new Set(parts)];
    } else if (a.startsWith("--thresholds=")) {
      opts.thresholds = a.slice("--thresholds=".length);
      if (!opts.thresholds) throw new UsageError("--thresholds kræver en sti");
    } else throw new UsageError(`ukendt argument: ${a}`);
  }
  if (sawCheck && sawWrite) throw new UsageError("--check og --write kan ikke kombineres");
  if (sawWrite) opts.mode = "write";
  if (opts.acceptVerdictChange && opts.mode !== "write") throw new UsageError("--accept-verdict-change giver kun mening med --write");
  return opts;
}

/**
 * Den private vinder-tærskel (#6362). Rækkefølge: --thresholds, CZ_6362_WINNER_THRESHOLDS,
 * <repo>/balance-internals/6362/winner-thresholds.json, OneDrive-context. null = mangler.
 */
export function resolveThresholdsPath({ explicit = null, env = process.env, repoRoot = REPO_ROOT, exists = existsSync } = {}) {
  if (explicit) {
    if (!exists(explicit)) throw new UsageError("--thresholds: filen findes ikke");
    return explicit;
  }
  const rel = path.join("balance-internals", "6362", "winner-thresholds.json");
  const oneDrive = env.OneDrive || (env.USERPROFILE ? path.join(env.USERPROFILE, "OneDrive") : null);
  const candidates = [
    env.CZ_6362_WINNER_THRESHOLDS || null,
    path.join(repoRoot, rel),
    oneDrive ? path.join(oneDrive, "CyclingZone-context", rel) : null,
  ].filter(Boolean);
  return candidates.find((c) => exists(c)) ?? null;
}

const r = (part, label, status, verdict = null, extra = {}) => ({ part, label, status, verdict, ...extra });

/**
 * #6912: `actual` har de nøgler der blev regnet. Frosne nøgler der flytter sig er en
 * regression; v3-nøgler der flytter sig er drift, som må skrives.
 */
export function judgeFlatChase({ expected, actual, frozenKeys, recomputableKeys }) {
  const results = [];
  if (frozenKeys.length) {
    const frozenMoved = frozenKeys.filter((k) => !isDeepStrictEqual(actual[k], expected[k]));
    results.push(r("6912-frozen", "6912 v1/v2 (frosset)", frozenMoved.length ? "regression" : "unchanged"));
  }
  const labels = { otherTerrain: "6912 v3 bakket/bjerg", otherOneDay: "6912 v3 endagsløb" };
  let next = null;
  for (const k of recomputableKeys) {
    if (!(k in actual)) continue;
    const moved = !isDeepStrictEqual(actual[k], expected[k]);
    results.push(r(`6912-${k}`, labels[k] ?? `6912 ${k}`, moved ? "drifted" : "unchanged", null, { writable: moved }));
    if (moved) next = { ...(next ?? expected), [k]: actual[k] };
  }
  return { results, next };
}

const allInside = (verdicts) => Object.values(verdicts ?? {}).every((v) => v === "inside");
const allPass = (winners) => Object.values(winners ?? {}).every((w) => w?.verdict === "pass");

/**
 * Bench-dommen mod fixturen. `winners` er null uden tærskel: så kan vindertype-dommen ikke
 * genberegnes, og flyttede winnerDigests kan ikke skrives. En ændret dom (gab eller
 * vindertype) skrives kun med `accept` (ejer-go).
 */
export function judgeBench({ fixture, measured, winnerDigests, winners, config, accept = false }) {
  const gapChanged = !isDeepStrictEqual(measured.verdicts, fixture.verdicts) || !isDeepStrictEqual(measured.sources, fixture.sources);
  const digestsChanged = !isDeepStrictEqual(winnerDigests, fixture.winnerDigests);
  const configChanged = !isDeepStrictEqual(config, fixture.config) || fixture.stub !== false;
  const winnersKnown = winners != null;
  const winnersChanged = winnersKnown && !isDeepStrictEqual(winners, fixture.winners);
  const thresholdBlocks = digestsChanged && !winnersKnown;
  const results = [];

  results.push(r("bench-gap", "bench gab", gapChanged ? "verdict_changed" : "unchanged",
    `${gapChanged ? "ny dom" : "uændret dom"} (${allInside(measured.verdicts) ? "alle inside" : "ikke alle inside"})`,
    { writable: gapChanged && accept && !thresholdBlocks }));

  if (!winnersKnown) {
    results.push(r("bench-winners", "bench vindertype", "skipped", "tærskel mangler, vindertype ikke genberegnet"));
  } else {
    results.push(r("bench-winners", "bench vindertype", winnersChanged ? "verdict_changed" : "unchanged",
      `${winnersChanged ? "ny dom" : "uændret dom"} (${allPass(winners) ? "pass" : "ikke alle pass"})`,
      { writable: winnersChanged && accept }));
  }

  results.push(r("bench-digests", "bench winnerDigests", digestsChanged ? "drifted" : "unchanged",
    thresholdBlocks ? "tærskel mangler, kan ikke skrives" : null, { writable: digestsChanged && !thresholdBlocks }));
  if (configChanged) results.push(r("bench-config", "bench konfiguration", "drifted", null, { writable: true }));

  const anyChange = gapChanged || digestsChanged || winnersChanged || configChanged;
  return { results, anyChange, winnersForWrite: winnersKnown ? winners : fixture.winners };
}

const BLOCKING = new Set(["regression", "verdict_changed", "drifted"]);

/** Må --write skrive? Kun når ingen del er en regression, og alt drevet faktisk er skrivbart. */
export function writeAllowed(results) {
  if (results.some((x) => x.status === "regression")) return false;
  return results.filter((x) => BLOCKING.has(x.status)).every((x) => x.writable === true);
}

/** Efter skrivning: skrivbare dele bliver "written". */
export function markWritten(results) {
  return results.map((x) => (BLOCKING.has(x.status) && x.writable
    ? { ...x, status: "written", verdict: x.status === "verdict_changed" ? "dom ændret, accepteret" : x.verdict }
    : x));
}

export function exitCodeFor(results) {
  return results.some((x) => BLOCKING.has(x.status)) ? 1 : 0;
}

export function overallResult(results, mode) {
  const has = (s) => results.some((x) => x.status === s);
  if (has("regression")) return "REGRESSION, ret motoren (intet skrevet)";
  if (has("verdict_changed")) return "dom ændret, kræver ejer-go (--write --accept-verdict-change), intet skrevet";
  if (has("drifted")) return mode === "write" ? "drevet, men ikke skrevet" : "fingeraftryk drevet, kør --write";
  if (has("written")) return results.some((x) => x.status === "written" && x.verdict === "dom ændret, accepteret")
    ? "fingeraftryk genberegnet, dom ændret og accepteret"
    : "fingeraftryk genberegnet, ingen dom ændret";
  return "alt uændret";
}

const STATUS_TEXT = {
  unchanged: "uændret",
  drifted: "DREVET",
  written: "DREVET -> skrevet",
  verdict_changed: "DOM ÆNDRET",
  regression: "REGRESSION",
  skipped: "ikke kørt",
};

/** Menneske-output: kun domme. Ingen tal fra målingerne indgår nogensinde. */
export function render(results, mode) {
  const width = Math.max(24, ...results.map((x) => x.label.length + 2));
  const lines = results.map((x) => {
    const status = x.status === "unchanged" && x.verdict ? "" : STATUS_TEXT[x.status] ?? x.status;
    const text = [status, x.verdict].filter(Boolean).join(x.status === "unchanged" ? "" : ": ");
    return `${x.label.padEnd(width)}${text}`;
  });
  lines.push(`${"ratingGolden.5321".padEnd(width)}ikke rørt (låst, ejer-go)`);
  lines.push(`RESULTAT: ${overallResult(results, mode)}`);
  return lines.join("\n");
}

export function toJson(results, mode) {
  return {
    mode,
    results: results.map(({ part, status, verdict }) => ({ part, status, verdict })),
    result: overallResult(results, mode),
    exitCode: exitCodeFor(results),
  };
}

/** Stier git ser som ændrede eller nye (repo-relative, posix). */
export function gitChangedPaths(run = (args) => spawnSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" })) {
  const out = new Set();
  for (const args of [["diff", "--name-only", "HEAD"], ["ls-files", "--others", "--exclude-standard"]]) {
    const res = run(args);
    if (res.status !== 0) throw new Error(`git ${args[0]} fejlede`);
    for (const line of res.stdout.split(/\r?\n/)) if (line.trim()) out.add(line.trim());
  }
  return out;
}

/** Filer der er blevet ændret under kørslen og ikke står i allowlisten. */
export function forbiddenChanges(before, after, allow) {
  return [...after].filter((p) => !before.has(p) && !allow.includes(p)).sort();
}

/** Skriver JSON til en allowlistet sti og bevarer filens linjeskift. */
export function safeWriteJson(rel, value, allow, { root = REPO_ROOT, write = writeFileSync, read = readFileSync, exists = existsSync } = {}) {
  if (!allow.includes(rel) || NEVER_WRITABLE.includes(rel)) throw new Error(`nægter at skrive uden for allowlisten: ${rel}`);
  const abs = path.join(root, rel);
  const crlf = exists(abs) && read(abs, "utf8").includes("\r\n");
  const body = `${JSON.stringify(value, null, 2)}\n`;
  write(abs, crlf ? body.replace(/\n/g, "\r\n") : body);
}

/** Dæmper motorens/benchens konsol-output (kan indeholde tal) mens `fn` kører. */
async function muted(fn, debug) {
  if (debug) return fn();
  const saved = { log: console.log, info: console.info, warn: console.warn, debug: console.debug, error: console.error };
  console.log = console.info = console.warn = console.debug = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}

const readJson = (rel) => JSON.parse(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const backendNode = (args) => spawnSync(process.execPath, args, { cwd: path.join(REPO_ROOT, "backend"), stdio: "ignore" });
const backendUrl = (rel) => pathToFileURL(path.join(REPO_ROOT, "backend", rel)).href;

async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (err) {
    if (err instanceof UsageError) { console.error(`refresh-fingerprints: ${err.message}`); return 2; }
    throw err;
  }
  const allow = writablePaths(opts.only);
  const before = opts.mode === "write" ? gitChangedPaths() : null;
  let results = [];
  const writes = [];

  // 1. Frosne (altid kun tjek).
  const frozenRun = backendNode(["--test", ...FROZEN_TESTS]);
  results.push(r("frozen", "frosne 6199/6200/6363", frozenRun.status === 0 ? "unchanged" : "regression"));

  const fp = await import(backendUrl("lib/engine/v4/testUtils/flatChase6912Fingerprints.ts"));
  const expected6912 = readJson(PATHS.flatChase);
  const frozenFirst = await muted(() => Object.fromEntries(fp.FLAT_CHASE_6912_FROZEN_KEYS.map((k) => [k, fp.computeFlatChase6912(k)])), opts.debug);
  const frozenJudge = judgeFlatChase({ expected: expected6912, actual: frozenFirst, frozenKeys: fp.FLAT_CHASE_6912_FROZEN_KEYS, recomputableKeys: [] });
  results.push(...frozenJudge.results);

  const stopped = results.some((x) => x.status === "regression");
  if (stopped) {
    for (const part of opts.only) results.push(r(part, part, "skipped", "regression i de frosne"));
  } else {
    // 2. #6912 v3.
    if (opts.only.includes("6912")) {
      const actual = await muted(() => Object.fromEntries(fp.FLAT_CHASE_6912_RECOMPUTABLE_KEYS.map((k) => [k, fp.computeFlatChase6912(k)])), opts.debug);
      const j = judgeFlatChase({ expected: expected6912, actual, frozenKeys: [], recomputableKeys: fp.FLAT_CHASE_6912_RECOMPUTABLE_KEYS });
      results.push(...j.results);
      if (j.next) writes.push(() => safeWriteJson(PATHS.flatChase, j.next, allow));
    }

    // 3. Bench, én kørsel.
    if (opts.only.includes("bench")) {
      const bench = await import(backendUrl("scripts/dev/s5MotorBench.mjs"));
      const gate = await import(backendUrl("lib/s5BenchmarkGate.js"));
      const thresholdsPath = resolveThresholdsPath({ explicit: opts.thresholds });
      const thresholds = thresholdsPath ? bench.loadWinnerThresholds(thresholdsPath) : null;
      const fixture = readJson(PATHS.bench);
      const { measured, winnerDigests, winners } = await muted(async () => {
        const rows = await bench.runS5MotorBench();
        const m = bench.gateMeasurement(rows, gate.loadS5Benchmark());
        return {
          measured: { verdicts: m.verdicts, sources: m.sources },
          winnerDigests: bench.winnerRowsDigests(rows),
          winners: thresholds ? bench.winnerVerdicts(rows, thresholds) : null,
        };
      }, opts.debug);
      const j = judgeBench({ fixture, measured, winnerDigests, winners, config: { ...bench.S5_MOTOR_BENCH_CONFIG }, accept: opts.acceptVerdictChange });
      results.push(...j.results);
      if (j.anyChange) {
        writes.push(() => safeWriteJson(PATHS.bench, bench.fixtureFromSummary({ gate: measured }, j.winnersForWrite, winnerDigests), allow));
      }
    }

    // 4. Kalender, kun med --only=calendar.
    if (opts.only.includes("calendar")) {
      const check = backendNode(["scripts/dev/refreshCalendarGoldenSnapshot.mjs", "--check"]);
      const moved = check.status !== 0;
      results.push(r("calendar", "kalender S3", moved ? "drifted" : "unchanged", null, { writable: moved }));
      if (moved) {
        writes.push(() => {
          if (!allow.includes(PATHS.calendar)) throw new Error("kalenderen er ikke i allowlisten");
          if (backendNode(["scripts/dev/refreshCalendarGoldenSnapshot.mjs"]).status !== 0) throw new Error("kalender-skrivning fejlede");
        });
      }
    }
  }

  if (opts.mode === "write" && writes.length && writeAllowed(results)) {
    for (const w of writes) w();
    const bad = forbiddenChanges(before, gitChangedPaths(), allow);
    if (bad.length) {
      const tracked = bad.filter((p) => spawnSync("git", ["-C", REPO_ROOT, "ls-files", "--error-unmatch", p], { stdio: "ignore" }).status === 0);
      if (tracked.length) spawnSync("git", ["-C", REPO_ROOT, "checkout", "--", ...tracked], { stdio: "ignore" });
      console.error(`VAGT: filer uden for allowlisten blev ændret og er gendannet: ${bad.join(", ")}`);
      return 2;
    }
    results = markWritten(results);
  }

  if (opts.json) console.log(JSON.stringify(toJson(results, opts.mode), null, 2));
  else console.log(render(results, opts.mode));
  return exitCodeFor(results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const debug = process.argv.includes("--debug");
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((err) => {
    // Fejlbeskeden kan komme fra motoren; uden --debug vises kun typen.
    console.error(debug ? err : `refresh-fingerprints: fejl (${err?.name ?? "Error"}); kør med --debug for detaljer`);
    process.exitCode = 2;
  });
}

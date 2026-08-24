#!/usr/bin/env node
// Seed-varians-harness for race:gate (#4180).
//
// race:gate koerte tre hardcodede seeds (2026, 7, 42) og doemte pr. seed. Det
// gjorde gaten til et lotteri: fejlede den, vidste vi ikke om koden var brudt
// eller om seedet bare var uheldigt. Dette script MAALER fordelingen i stedet
// for at gaette den: det koerer simulateSeasonDryRun.js paa N seeds parallelt,
// samler de MAALTE vaerdier (--metrics-json) og rapporterer middelvaerdi,
// spredning, kvantiler og bestaa-rate pr. baand.
//
//   node scripts/raceSeedVariance.js --n=60 [--start=1] [--jobs=8] \
//        [--out=out/variance] [--label=main] [-- <passthrough til dry-run>]
//
// Read-only: roerer intet i prod/DB. Alt output ligger under --out.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "simulateSeasonDryRun.js");

const argv = process.argv.slice(2);
const dashdash = argv.indexOf("--");
const own = dashdash === -1 ? argv : argv.slice(0, dashdash);
const passthrough = dashdash === -1 ? [] : argv.slice(dashdash + 1);
function arg(name, def) {
  const hit = own.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (own.includes(`--${name}`)) return true;
  return def;
}

const N = parseInt(arg("n", "30"), 10);
const START = parseInt(arg("start", "1"), 10);
const JOBS = Math.max(1, parseInt(arg("jobs", String(Math.max(1, cpus().length - 1))), 10));
const OUT = arg("out", join(__dirname, "out", "variance"));
const LABEL = arg("label", "run");
const EXPLICIT = arg("seeds", null);

const seeds = EXPLICIT
  ? String(EXPLICIT).split(",").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite)
  : Array.from({ length: N }, (_, i) => START + i);

const RUN_DIR = join(OUT, LABEL);
mkdirSync(RUN_DIR, { recursive: true });

const baseFlags = ["--enforce-targets", "--enforce-liveness", "--no-html"];
console.log(`seed-varians: ${seeds.length} seeds (${seeds[0]}..${seeds[seeds.length - 1]}) - ${JOBS} parallelle - label=${LABEL}`);
console.log(`flags: ${[...baseFlags, ...passthrough].join(" ")}\n`);

const results = [];
let done = 0;
const t0 = Date.now();

function runSeed(seed) {
  return new Promise((resolve) => {
    const jsonPath = join(RUN_DIR, `seed-${seed}.json`);
    const child = spawn(process.execPath, [SCRIPT, `--seed=${seed}`, ...baseFlags, `--metrics-json=${jsonPath}`, ...passthrough], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      let metrics = null;
      try { metrics = JSON.parse(readFileSync(jsonPath, "utf8")); } catch { metrics = null; }
      done += 1;
      const elapsed = (Date.now() - t0) / 1000;
      const eta = done ? (elapsed / done) * (seeds.length - done) : 0;
      process.stdout.write(`  [${String(done).padStart(3)}/${seeds.length}] seed ${String(seed).padStart(5)} exit ${code}  (${elapsed.toFixed(0)}s brugt, ~${eta.toFixed(0)}s tilbage)\n`);
      resolve({ seed, exitCode: code, metrics, stderr: stderr.slice(0, 500) });
    });
  });
}

const queue = [...seeds];
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (queue.length) results.push(await runSeed(queue.shift()));
}));
results.sort((a, b) => a.seed - b.seed);

// -- Aggregering --------------------------------------------------------------
const ok = results.filter((r) => r.metrics);
const crashed = results.filter((r) => !r.metrics);
const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

function summarise(pick, bandOf) {
  const keys = [...new Set(ok.flatMap((r) => Object.keys(pick(r.metrics) || {})))];
  return keys.map((key) => {
    const vals = ok
      .map((r) => pick(r.metrics)?.[key])
      .map((v) => (v && typeof v === "object" ? (v.value ?? v.bornPct) : v))
      .filter((v) => typeof v === "number" && Number.isFinite(v));
    const sample = ok.map((r) => pick(r.metrics)?.[key]).find((v) => v != null);
    const band = bandOf(sample);
    const fails = band ? vals.filter((v) => (band.min != null && v < band.min) || (band.max != null && v > band.max)).length : 0;
    return {
      key, n: vals.length, mean: mean(vals), sd: sd(vals),
      min: vals.length ? Math.min(...vals) : null,
      p05: q(vals, 0.05), p50: q(vals, 0.5), p95: q(vals, 0.95),
      max: vals.length ? Math.max(...vals) : null,
      band, fails,
    };
  });
}

const targetRows = summarise((m) => m.targets, (t) => (t ? { min: t.targetPct } : null));
const livenessRows = summarise((m) => m.liveness, (t) => (t ? { min: t.floor } : null));
const dominanceRows = summarise((m) => m.dominance, (t) => (t ? { min: t.min, max: t.max } : null));

const failedSeeds = ok.filter((r) => r.exitCode !== 0);
const causeCount = {};
for (const r of failedSeeds) {
  for (const [kind, list] of Object.entries(r.metrics.failures)) {
    if (kind === "breakaway" || kind === "dominance") continue; // rapport-only i gaten i dag
    for (const f of list) causeCount[`${kind}:${f}`] = (causeCount[`${kind}:${f}`] || 0) + 1;
  }
}

const pad = (s, n) => String(s).padEnd(n);

function table(title, rows, scale, dec, unit) {
  console.log(`\n${title}`);
  console.log(`  ${pad("metrik", 30)}${pad("middel", 10)}${pad("sd", 9)}${pad("min", 9)}${pad("p05", 9)}${pad("median", 9)}${pad("max", 9)}${pad("baand", 16)}fejl`);
  console.log(`  ${"-".repeat(112)}`);
  for (const r of rows) {
    const f = (v) => (v == null || !Number.isFinite(v) ? "n/a" : `${(v * scale).toFixed(dec)}${unit}`);
    const bandStr = !r.band ? "-" :
      `[${r.band.min != null ? (r.band.min * scale).toFixed(dec) : "-"}, ${r.band.max != null ? (r.band.max * scale).toFixed(dec) : "-"}]`;
    console.log(`  ${pad(r.key, 30)}${pad(f(r.mean), 10)}${pad(f(r.sd), 9)}${pad(f(r.min), 9)}${pad(f(r.p05), 9)}${pad(f(r.p50), 9)}${pad(f(r.max), 9)}${pad(bandStr, 16)}${r.fails}/${r.n}`);
  }
}

console.log(`\n${"=".repeat(118)}`);
console.log(`RESULTAT - ${ok.length} gennemfoerte seeds${crashed.length ? ` (${crashed.length} crashede: ${crashed.map((c) => c.seed).join(", ")})` : ""}`);
console.log(`Gate-bestaa-rate (samme dom som race:gate i dag, pr. seed): ${ok.length - failedSeeds.length}/${ok.length} = ${((100 * (ok.length - failedSeeds.length)) / (ok.length || 1)).toFixed(1)} %`);
console.log(`Fejlende seeds: ${failedSeeds.map((r) => r.seed).join(", ") || "ingen"}`);

table("A. MAAL-SCORECARD (B) - foedt-som-andel pr. terraen (baand = gulv)", targetRows, 100, 1, "%");
table("B. EVNE-LIVENESS (E) - rank-gevinst (baand = gulv)", livenessRows, 1, 3, "");
table("C. DOMINANS (F) - rapport-only i gaten i dag", dominanceRows, 1, 3, "");

console.log(`\nD. FEJL-AARSAGER (kun haandhaevede klasser)`);
const causes = Object.entries(causeCount).sort((a, b) => b[1] - a[1]);
if (!causes.length) console.log("  ingen");
for (const [c, n] of causes) console.log(`  ${String(n).padStart(3)} seeds  ${c}`);

const summaryPath = join(OUT, `${LABEL}-summary.json`);
writeFileSync(summaryPath, JSON.stringify({
  label: LABEL, seeds: seeds.length, jobs: JOBS, passthrough,
  wallClockSeconds: (Date.now() - t0) / 1000,
  perSeed: results.map((r) => ({ seed: r.seed, exitCode: r.exitCode, failures: r.metrics?.failures ?? null })),
  targets: targetRows, liveness: livenessRows, dominance: dominanceRows, causeCount,
}, null, 2), "utf8");
console.log(`\nSummary: ${summaryPath}`);
console.log(`Vaegur: ${((Date.now() - t0) / 1000).toFixed(0)}s for ${seeds.length} seeds paa ${JOBS} parallelle.`);

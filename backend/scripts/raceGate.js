#!/usr/bin/env node
// Multi-seed launch-gate wrapper for race-motoren (#1102, ombygget i #4180).
//
// ── HVORFOR GATEN SER SAADAN UD (#4180, 2026-08-24) ──────────────────────────
// Frem til #4180 koerte gaten TRE hardcodede seeds (2026, 7, 42) og kraevede at
// HVER seed bestod alle baand. Maalt paa 400 tilfaeldige seeds fejlede den
// dommen paa 168 af dem (42 %) med uaendret kode paa main. Gaten fangede altsaa
// held, ikke regressioner: den kunne hverken frikende eller doemme en aendring.
//
// Maalingen (scripts/raceSeedVariance.js, 400 seeds i to uafhaengige intervaller):
//
//   baand           middel    sd     maal   andel seeds under maal
//   flat             99.4    0.95     90            0.3 %
//   itt              65.5   11.64     60           30.0 %   <- driver 2/3 af stoejen
//   itt_tempo        98.1    2.67     95            9.5 %
//   cobbles          90.6    4.56     80            3.5 %
//   hilly            57.9   10.34     35            1.3 %
//   mountain         89.4    4.05     82            5.5 %
//   high_mountain    95.9    3.61     85            2.0 %
//
// Variansen er POPULATIONS-bunden, ikke loebs-stoej: 83-93 % af variansen paa
// hvert baand overlever at man firedobler antallet af loeb pr. seed (sd paa itt
// gaar 10,18 -> 10,28 pp ved --races=1200). Hvert seed bygger sit EGET felt paa
// 800 ryttere, og felterne er reelt forskellige. Flere loeb pr. seed koster
// derfor 4x CPU uden at fjerne stoej; kun FLERE SEEDS goer.
//
// ── DOMMEN (ejer-godkendt 2026-08-24) ────────────────────────────────────────
// 50 seeds, og maal-scorecardet (sektion B) doemmes paa GENNEMSNITTET over
// seedsne i stedet for pr. seed. Ejerens maaltal er UAENDREDE (90/60/95/80/35/
// 82/85) — kun dommen aendrer sig. Verificeret paa 8 uafhaengige 50-seed-blokke:
// alle 8 groenne (blok-gennemsnit paa itt: 63,5-68,3 mod maal 60).
// Falsk-alarms-rate ved 50 seeds: 0,04 % (1 ud af 2.500 koersler) mod 42 % foer.
//
// PER-SEED forbliver haardt for de baand der IKKE stoejer: strukturelle orakler
// (sektion D), evne-liveness (sektion E) og roles-baandene fejlede 0 ud af 400
// seeds — de kan derfor blive ved med at falde paa en enkelt seed uden at give
// falske alarmer, og én roed seed dér er et aegte signal.
//
// Selve dommen ligger i lib/raceDryRunOracles.js (evaluateSeedAggregateGate) og
// er unit-testet — en gate man ikke kan teste er den samme faelde igen.
//
//   node scripts/raceGate.js [--seeds=1-50] [--jobs=N] [--condition] [--roles]
//   node scripts/raceGate.js --routes [--seeds=1-50]
//
// --enforce-liveness/--no-html saettes altid. --enforce-targets saettes IKKE
// laengere paa barnet: sektion B doemmes af denne wrapper paa aggregatet.
// Oevrige flag (condition/roles/enforce-breakaway) sendes uaendret videre.
//
// Sub-3 (#2771) Task 7: --routes goer denne wrapper til en DUAL-koersel pr. seed
// — BAADE standard-varianten OG en routes-variant (--routes --enforce-breakaway
// --enforce-route-bands). Rute-baandene (sektion G) doemmes ogsaa paa aggregatet.
// npm-scriptet "race:gate" er bart (ingen --routes); "race:gate:routes" saetter det.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateSeedAggregateGate } from "../lib/raceDryRunOracles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "simulateSeasonDryRun.js");
const RULE = "-".repeat(80);

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

// --seeds accepterer baade "1-50" (interval) og "2026,7,42" (eksplicit liste).
function parseSeeds(spec) {
  const range = /^(\d+)-(\d+)$/.exec(String(spec).trim());
  if (range) {
    const from = parseInt(range[1], 10), to = parseInt(range[2], 10);
    if (!(to >= from)) throw new Error(`Ugyldigt seed-interval: ${spec}`);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  return String(spec).split(",").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
}

const seeds = parseSeeds(arg("seeds", "1-50"));
const JOBS = Math.max(1, parseInt(arg("jobs", String(Math.max(1, cpus().length - 1))), 10));
const ROUTES_DUAL = !!arg("routes", false);
const passthrough = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--seeds") && !a.startsWith("--jobs") && a !== "--routes");
const baseFlags = ["--enforce-liveness", "--no-html"];
const routeFlags = ["--routes", "--enforce-breakaway", "--enforce-route-bands"];

// Under denne graense giver et gennemsnit ikke mening som dom — saa rapporteres
// baandene uden dom i stedet for at lade som om et 3-seed-snit betyder noget.
const AGGREGATE_MIN_SEEDS = 10;

const TMP = mkdtempSync(join(tmpdir(), "race-gate-"));

console.log(
  `race:gate — ${seeds.length} seeds (${seeds[0]}..${seeds[seeds.length - 1]}), ${JOBS} parallelle` +
    (passthrough.length ? `  (${passthrough.join(" ")})` : "") +
    (ROUTES_DUAL ? "  [dual: standard + routes-variant]" : "") +
    "\n   Sektion B doemmes paa GENNEMSNITTET over seeds (#4180). Orakler/liveness/roles doemmes pr. seed.\n",
);

function runOne(seed, variant) {
  return new Promise((resolve) => {
    const jsonPath = join(TMP, `${variant.label}-${seed}.json`);
    const child = spawn(
      process.execPath,
      [SCRIPT, `--seed=${seed}`, ...variant.flags, `--metrics-json=${jsonPath}`, ...passthrough],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => {
      let metrics = null;
      try { metrics = JSON.parse(readFileSync(jsonPath, "utf8")); } catch { metrics = null; }
      resolve({ seed, variant: variant.label, exitCode: code, metrics, out });
    });
  });
}

const variants = ROUTES_DUAL
  ? [{ label: "standard", flags: baseFlags }, { label: "routes", flags: [...baseFlags, ...routeFlags] }]
  : [{ label: "standard", flags: baseFlags }];

const queue = [];
for (const seed of seeds) for (const variant of variants) queue.push({ seed, variant });
const total = queue.length;

const results = [];
let done = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (queue.length) {
    const job = queue.shift();
    results.push(await runOne(job.seed, job.variant));
    done += 1;
    if (done % 10 === 0 || done === total) {
      process.stdout.write(`   ... ${done}/${total} koersler (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
    }
  }
}));
rmSync(TMP, { recursive: true, force: true });

const pad = (s, n) => String(s).padEnd(n);
const padS = (s, n) => String(s).padStart(n);
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const allFailures = [];
let anyJudged = false;

for (const variant of variants) {
  const runs = results.filter((r) => r.variant === variant.label).sort((a, b) => a.seed - b.seed);
  const verdict = evaluateSeedAggregateGate(runs, { minSeeds: AGGREGATE_MIN_SEEDS });
  const n = runs.length - verdict.crashed.length;
  for (const f of verdict.failures) allFailures.push(`${variant.label}: ${f}`);
  if (verdict.judged) anyJudged = true;

  console.log(`\n${RULE}`);
  console.log(`VARIANT: ${variant.label} — ${n} gennemfoerte seeds\n`);

  // 1. Per-seed-haarde klasser (orakler + liveness + roles).
  if (verdict.crashed.length) {
    console.log(`   FEJL: ${verdict.crashed.length} seeds crashede: ${verdict.crashed.join(", ")}`);
    for (const c of runs.filter((r) => !r.metrics).slice(0, 2)) {
      for (const line of c.out.split("\n").filter((l) => /Error|✗/.test(l)).slice(-5)) console.log(`      ${line.trim()}`);
    }
  }
  if (verdict.hardSeeds.length) {
    console.log(`   FEJL: per-seed-haarde baand brudt paa ${verdict.hardSeeds.length}/${n} seeds:`);
    for (const r of verdict.hardSeeds) console.log(`      seed ${r.seed} — ${r.messages.join(" · ")}`);
  } else if (!verdict.crashed.length) {
    console.log(`   OK: strukturelle orakler + evne-liveness + roles groenne paa alle ${n} seeds`);
  }
  if (!n) continue;

  // 2. Aggregat-dom paa maal-scorecardet (sektion B).
  if (!verdict.judged) {
    console.log(`\n   ADVARSEL: kun ${n} seeds — for faa til en aggregat-dom (kraever ${AGGREGATE_MIN_SEEDS}). Baandene rapporteres uden dom.`);
  }
  console.log(`\n   MAAL-SCORECARD (gennemsnit over ${n} seeds — dommen, #4180):`);
  console.log(`   ${pad("terraen", 16)}${padS("middel", 9)}${padS("maal", 8)}${padS("margin", 9)}${padS("spredning", 11)}${padS("vaerste seed", 14)}  status`);
  console.log(`   ${"-".repeat(78)}`);
  for (const r of verdict.targetRows) {
    console.log(
      `   ${pad(r.key, 16)}${padS(pct(r.mean), 9)}${padS(`${(r.target * 100).toFixed(0)}%`, 8)}` +
      `${padS(`${r.mean >= r.target ? "+" : ""}${((r.mean - r.target) * 100).toFixed(1)}pp`, 9)}` +
      `${padS(`${(r.sd * 100).toFixed(1)}pp`, 11)}${padS(pct(r.worst), 14)}  ${r.pass == null ? "-" : r.pass ? "OK" : "FEJL"}`,
    );
  }

  // 3. Aggregat-dom paa rute-baandene (sektion G) — kun routes-varianten.
  if (verdict.routeRows.length) {
    console.log(`\n   RUTE-BAAND (gennemsnit over ${n} seeds):`);
    console.log(`   ${pad("metrik", 24)}${padS("middel", 10)}${padS("baand", 10)}${padS("spredning", 11)}  status`);
    console.log(`   ${"-".repeat(60)}`);
    for (const r of verdict.routeRows) {
      console.log(`   ${pad(r.key, 24)}${padS(r.mean.toFixed(2), 10)}${padS(r.band, 10)}${padS(r.sd.toFixed(2), 11)}  ${r.pass == null ? "-" : r.pass ? "OK" : "FEJL"}`);
    }
  }
}

console.log(`\n${RULE}`);
console.log(`Vaegur: ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
if (allFailures.length) {
  console.log("race:gate FEJLEDE:");
  for (const f of allFailures) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(
  anyJudged
    ? `race:gate GROEN — ${seeds.length} seeds, aggregat-dom paa maal-scorecardet, per-seed-dom paa orakler/liveness.`
    : `race:gate: ingen haarde brud paa ${seeds.length} seeds, men FOR FAA seeds til en aggregat-dom (kraever ${AGGREGATE_MIN_SEEDS}) — dette er IKKE en godkendelse.`,
);

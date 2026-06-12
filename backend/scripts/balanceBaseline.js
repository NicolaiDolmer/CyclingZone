#!/usr/bin/env node
// Balance-baseline-runner (#1197) — skriv/tjek deterministiske balance-snapshots.
//
// Samme idé som core-smoke-screenshots, bare for tal (jf. #1144-harness-standard):
//   input  = fast seed + seeded fiktiv population (ingen DB, ingen netværk)
//   runner = denne CLI (kører motor-funktionerne UÆNDREDE via lib/balanceSnapshot.js)
//   orakel = diff mod committet baseline — tom diff = grøn
//   rapport = markdown-diff (stdout + scripts/out/ + $GITHUB_STEP_SUMMARY i CI)
//
//   node scripts/balanceBaseline.js --check              # diff mod baseline, exit 1 ved diff
//   node scripts/balanceBaseline.js --check --advisory   # som --check, men exit 0 ved diff (CI-advisory)
//   node scripts/balanceBaseline.js --write              # regenerér + commit-klar baseline-bump
//
// npm-genveje (i backend/): `npm run balance:check` · `npm run balance:baseline`

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BALANCE_SNAPSHOT_DEFAULTS,
  buildBalanceSnapshot,
  diffSnapshots,
  renderDiffMarkdown,
  renderSnapshotMarkdown,
} from "../lib/balanceSnapshot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(__dirname, "baselines");
const BASELINE_JSON = join(BASELINE_DIR, "balance-baseline.json");
const BASELINE_MD = join(BASELINE_DIR, "balance-baseline.md");
const OUT_DIR = join(__dirname, "out");

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const WRITE = !!arg("write", false);
const ADVISORY = !!arg("advisory", false);
const options = {};
for (const key of ["seed", "count", "races", "fieldSize", "gtField", "seasons"]) {
  const v = arg(key, null);
  if (v != null && v !== true) options[key] = parseInt(v, 10);
}

const t0 = Date.now();
console.log(`⚖️  Balance-snapshot (#1197) — ${WRITE ? "WRITE baseline" : "CHECK mod baseline"} · seed=${options.seed ?? BALANCE_SNAPSHOT_DEFAULTS.seed} (in-memory, rører ikke prod/DB)`);
const snapshot = buildBalanceSnapshot(options);
const json = JSON.stringify(snapshot, null, 2) + "\n";
const md = renderSnapshotMarkdown(snapshot);
console.log(`   Snapshot bygget på ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

if (WRITE) {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(BASELINE_JSON, json);
  writeFileSync(BASELINE_MD, md);
  console.log(`✅ Skrev baseline:\n   ${BASELINE_JSON}\n   ${BASELINE_MD}`);
  console.log("   Commit begge filer i samme PR som balance-ændringen — diffen er reviewet.");
  process.exit(0);
}

// --check
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "balance-snapshot.json"), json);
writeFileSync(join(OUT_DIR, "balance-snapshot.md"), md);

if (!existsSync(BASELINE_JSON)) {
  console.error(`❌ Ingen committet baseline fundet: ${BASELINE_JSON}`);
  console.error("   Kør 'node scripts/balanceBaseline.js --write' og commit backend/scripts/baselines/.");
  process.exit(1);
}

const baselineSnap = JSON.parse(readFileSync(BASELINE_JSON, "utf8"));
const diffs = diffSnapshots(baselineSnap, snapshot);
const diffMd = renderDiffMarkdown(diffs);
writeFileSync(join(OUT_DIR, "balance-diff.md"), diffMd);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, diffMd + "\n");
}

if (!diffs.length) {
  console.log("✅ Tom diff — balance-snapshottet matcher den committede baseline.");
  process.exit(0);
}

console.log(`\n${diffMd}`);
console.log(`Fuld rapport: ${join(OUT_DIR, "balance-diff.md")} · nyt snapshot: ${join(OUT_DIR, "balance-snapshot.md")}`);
if (ADVISORY) {
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::warning title=Balance-baseline-diff (#1197)::${diffs.length} balance-afvigelse(r) fra committet baseline — se job summary. Tilsigtet? Bump baselinen: npm run balance:baseline (i backend/) + commit.`);
  }
  console.log(`⚠️  ADVISORY: ${diffs.length} afvigelse(r) — exit 0 (gate slås til ved at fjerne --advisory).`);
  process.exit(0);
}
console.error(`❌ ${diffs.length} balance-afvigelse(r) fra baseline. Tilsigtet? Bump baselinen i samme PR: npm run balance:baseline (i backend/) + commit.`);
process.exit(1);

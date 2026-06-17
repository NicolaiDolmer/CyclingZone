#!/usr/bin/env node
// Multi-seed launch-gate wrapper for race-motoren (#1102).
//
// Kører simulateSeasonDryRun.js på FLERE seeds og fælder (exit 1) hvis NOGEN
// seed fejler de launch-kritiske gates (win-rate-scorecard + strukturelle
// oracles + evne-liveness + roles-metrikker). Lukker CI-hullet hvor ét enkelt
// seed (2026) kunne maskere drift der brød andre kalibrerings-seeds: udbruds-
// drift 2026-06-17 brød seed 7 OG 42 mens 2026 tilfældigvis blev grøn, fordi CI
// kun kørte seed 2026 (#1102-verifikation).
//
// Seed-sættet er de tre seeds gaten er kalibreret imod (kalibrerings-loggen i
// simulateSeasonDryRun.js). Bredere seeds + condition/roles-modes er marginale
// pga. ufærdige post-launch-seams (#1021 durability/udbrud, #1122 itt) og er
// derfor IKKE en del af denne hard gate — de re-kalibreres post-launch.
//
//   node scripts/raceGate.js [--seeds=2026,7,42] [--condition] [--roles] [--enforce-breakaway]
//
// --enforce-targets/--enforce-liveness/--no-html sættes altid. Øvrige flag
// (condition/roles/enforce-breakaway) sendes uændret videre til hver kørsel.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "simulateSeasonDryRun.js");

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const seeds = String(arg("seeds", "2026,7,42"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Mode-flag (condition/roles/enforce-breakaway) sendes uændret videre; --seeds er
// wrapper-only og filtreres fra.
const passthrough = process.argv.slice(2).filter((a) => !a.startsWith("--seeds"));
const baseFlags = ["--enforce-targets", "--enforce-liveness", "--no-html"];

console.log(
  `🚦 race:gate — ${seeds.length} seeds: ${seeds.join(", ")}` +
    (passthrough.length ? `  (${passthrough.join(" ")})` : "") +
    "\n",
);

const failed = [];
for (const seed of seeds) {
  const res = spawnSync(process.execPath, [SCRIPT, `--seed=${seed}`, ...baseFlags, ...passthrough], {
    encoding: "utf8",
  });
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  if (res.status === 0) {
    console.log(`  seed ${seed}  ✓ pass`);
    continue;
  }
  failed.push(seed);
  console.log(`  seed ${seed}  ❌ FAIL`);
  for (const line of out.split("\n").filter((l) => /❌|✗/.test(l))) {
    console.log(`      ${line.trim()}`);
  }
}

console.log("");
if (failed.length) {
  console.log(`❌ race:gate FEJLEDE på ${failed.length}/${seeds.length} seeds: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`✅ race:gate grøn på alle ${seeds.length} seeds.`);

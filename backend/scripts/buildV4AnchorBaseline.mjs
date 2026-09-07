#!/usr/bin/env node
// backend/scripts/buildV4AnchorBaseline.mjs
// #4911: refresh-kommando for den PINNEDE v4-ankertabel. Kører
// headToHeadV4.js på de to committede baseline-filer (population + proxy-
// etaper) over de tre laaste seeds, og skriver resultatet + provenance
// (main_sha, fil-hashes) til backend/scripts/baselines/v4-anchor-baseline.json.
// Efter denne: node backend/scripts/renderV4AnchorTable.mjs --write.
//
// Ét-kommando-refresh (begge trin):
//   node backend/scripts/buildV4AnchorBaseline.mjs && \
//   node backend/scripts/renderV4AnchorTable.mjs --write
//
// 100% READ-ONLY mod git/DB — laeser kun committede JSON-filer og HEAD's sha,
// skriver kun til de to filer nævnt ovenfor.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

// Gaten er PINNET her (#4911, audit-modsigelse "Gaten er ikke pinnet nogen
// steder"): population, etaper og seeds er faste — et fremtidigt
// kalibrerings-PR kan derfor efterproeves mod netop denne baseline.
//
// #4936 (7/9): re-eksporteret fra prod (5.955 ryttere mod juli-snapshottets
// 5.650) — juli-filen var forældet, ikke kun et generator-artefakt (se
// docs/RACE_ENGINE_RULES.md §7 punkt 6 og PR-beskrivelsen for p10/p50/p90
// foer/efter mod den ægte prod-fordeling).
const POPULATION_FILE = "backend/scripts/baselines/population-snapshot-2026-09-07.json";
const STAGES_FILE = "backend/scripts/baselines/v4-proxy-stages-2026-09-06.json";
const SEEDS = "s1,s2,s3";
const FIELD_SIZE = "180";

function sha16(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex").slice(0, 16);
}

// main_sha er motor-KODENS sha, ikke denne docs-branch's egen HEAD (som
// flytter sig ved hver commit). merge-base mod origin/main er derfor det
// rigtige tal paa en branch der kun aendrer docs/scripts/baselines — det er
// commit'et hvor `backend/lib/engine/v4/**` sidst blev roert paa denne gren.
function currentSha() {
  try {
    return execFileSync("git", ["-C", REPO_ROOT, "merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  } catch {
    try {
      return execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      return "unknown (git rev-parse fejlede — koert uden for et git-repo?)";
    }
  }
}

function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "v4-anchor-"));
  const tmpJson = join(tmpDir, "raw.json");
  try {
    execFileSync(
      process.execPath,
      [
        join(SCRIPT_DIR, "headToHeadV4.js"),
        `--population=${POPULATION_FILE}`,
        `--stages=${STAGES_FILE}`,
        `--seeds=${SEEDS}`,
        `--field-size=${FIELD_SIZE}`,
        `--json=${tmpJson}`,
      ],
      { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "inherit"] },
    );

    const raw = JSON.parse(readFileSync(tmpJson, "utf8"));
    const baseline = {
      schema_version: 1,
      generated_at: raw.meta.generated_at,
      main_sha: currentSha(),
      population_file: POPULATION_FILE,
      population_file_sha256_16: sha16(join(REPO_ROOT, POPULATION_FILE)),
      population_riders: raw.meta.population_riders,
      stages_file: STAGES_FILE,
      stages_file_sha256_16: sha16(join(REPO_ROOT, STAGES_FILE)),
      seeds: raw.meta.seeds,
      field_size: raw.meta.field_size,
      order_mode: raw.meta.order_mode,
      refresh_command:
        "node backend/scripts/buildV4AnchorBaseline.mjs && node backend/scripts/renderV4AnchorTable.mjs --write",
      anchors: raw.anchors,
    };

    const outPath = join(REPO_ROOT, "backend/scripts/baselines/v4-anchor-baseline.json");
    writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Baseline skrevet: ${outPath}`);
    console.log(`main_sha: ${baseline.main_sha}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();

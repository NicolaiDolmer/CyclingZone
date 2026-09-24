#!/usr/bin/env node
// backend/scripts/buildV4AnchorBaseline.mjs
// #4911: refresh-kommando for den PINNEDE v4-ankertabel. Kører
// headToHeadV4.js på de to committede baseline-filer (population + proxy-
// etaper) over de fem laaste seeds (#4914), og skriver resultatet + provenance
// (main_sha, fil-hashes) til backend/scripts/baselines/v4-anchor-baseline.json.
// Efter denne: node backend/scripts/renderV4AnchorTable.mjs --write.
//
// Ét-kommando-refresh (begge trin):
//   node backend/scripts/buildV4AnchorBaseline.mjs && \
//   node backend/scripts/renderV4AnchorTable.mjs --write
//
// 100% READ-ONLY mod git/DB — laeser kun committede JSON-filer og HEAD's sha,
// skriver kun til de to filer nævnt ovenfor.
//
// SIDE-OM-SIDE-MAALING (#5572): `--population=<fil>` koerer samme ankre
// (samme etaper, seeds og feltstoerrelse) paa en anden population, og
// `--out=<fil>` skriver resultatet et andet sted hen. Uden flag er alt
// UAENDRET (gaten = POPULATION_FILE nedenfor → v4-anker-baselinen). En
// anden population der ville skrive til v4-anker-baselinen (intet `--out`,
// eller `--out` peget paa den) afvises, saa en side-om-side-koersel aldrig
// kan overskrive den pinnede gate — at flytte gaten er en ejerbeslutning.
// Relative stier regnes fra repo-roden (som POPULATION_FILE); koer fra roden.
//   node backend/scripts/buildV4AnchorBaseline.mjs --population=<fil> --out=<fil>

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
// #4914 (5-seed-gate): ankertabellen maales paa FEM seeds, ikke tre. Ejer-
// beslutningen 2/9 (RACE_ENGINE_RULES §7 raekke 8) er "5-seed-middel med
// spaend": ét seed svinger et anker ~12 procentpoint, og tre seeds skjulte at
// bjerg-top-10's laveste enkelt-seed laa under gulvet (§7 raekke 16). s1-s3
// er uaendrede, saa en 5-seed-tabel er en udvidelse, ikke et nyt udsnit.
// NB: hale-gaten (v4TailSpread.js --gate) er EJER-LAAST paa 3 seeds (§9
// raekke 13) og flyttes IKKE af denne linje.
const SEEDS = "s1,s2,s3,s4,s5";
const FIELD_SIZE = "180";
const BASELINE_OUT = "backend/scripts/baselines/v4-anchor-baseline.json";

function argValue(argv, name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : null;
}

// Windows' filsystem er case-insensitivt: `--out=BACKEND/...` maa ikke kunne
// snige sig uden om gate-vagten nedenfor.
function samePath(a, b) {
  const norm = (p) => (process.platform === "win32" ? resolve(REPO_ROOT, p).toLowerCase() : resolve(REPO_ROOT, p));
  return norm(a) === norm(b);
}

/**
 * #5572: population + output-sti ud fra CLI-args. Uden flag: den pinnede gate
 * (POPULATION_FILE → BASELINE_OUT), praecis som foer. En anden population
 * maa ikke skrive til BASELINE_OUT, saa gaten aldrig flyttes af en
 * side-om-side-koersel.
 * @param {string[]} argv
 * @returns {{ population: string, out: string, isGate: boolean }}
 */
export function resolveRunTargets(argv) {
  const population = argValue(argv, "population") ?? POPULATION_FILE;
  const out = argValue(argv, "out");
  const outPath = out ?? BASELINE_OUT;
  const isGatePopulation = samePath(population, POPULATION_FILE);
  const writesGate = samePath(outPath, BASELINE_OUT);
  if (!isGatePopulation && writesGate) {
    throw new Error(
      `--population=${population} kraever --out=<fil> uden for ${BASELINE_OUT}: den pinnede ankertabel maales kun paa ${POPULATION_FILE}, og at flytte gaten er en ejerbeslutning (#5572).`,
    );
  }
  return { population, out: outPath, isGate: isGatePopulation && writesGate };
}

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
  let targets;
  try {
    targets = resolveRunTargets(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const tmpDir = mkdtempSync(join(tmpdir(), "v4-anchor-"));
  const tmpJson = join(tmpDir, "raw.json");
  try {
    execFileSync(
      process.execPath,
      [
        join(SCRIPT_DIR, "headToHeadV4.js"),
        `--population=${targets.population}`,
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
      population_file: targets.population,
      population_file_sha256_16: sha16(resolve(REPO_ROOT, targets.population)),
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

    const outPath = resolve(REPO_ROOT, targets.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`${targets.isGate ? "Baseline" : "Side-om-side-maaling (IKKE gaten)"} skrevet: ${outPath}`);
    console.log(`main_sha: ${baseline.main_sha}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("buildV4AnchorBaseline.mjs")) main();

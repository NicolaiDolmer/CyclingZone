#!/usr/bin/env node
// backend/scripts/renderV4AnchorTable.mjs
// #4911: renderer ankertabellen i docs/RACE_ENGINE_RULES.md FRA den pinnede
// baseline-JSON (backend/scripts/baselines/v4-anchor-baseline.json) i stedet
// for at holde den haandskrevet. Skriver kun ind mellem markørerne
// `<!-- v4-anchors:start -->` / `<!-- v4-anchors:end -->` — resten af filen
// er urørt.
//
// Refresh (to trin, se ogsaa buildV4AnchorBaseline.mjs's egen header):
//   node backend/scripts/buildV4AnchorBaseline.mjs && \
//   node backend/scripts/renderV4AnchorTable.mjs --write
//
// --check: fejler (exit 1) hvis den aktuelle blok i docs afviger fra det
// baseline-JSON'en ville rendere — CI-egnet forward-guard mod at nogen retter
// tallene i haanden uden at opdatere baseline'en, eller omvendt.
// --write (default hvis hverken flag er givet): skriver blokken ind i filen.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

export const START_MARKER = "<!-- v4-anchors:start -->";
export const END_MARKER = "<!-- v4-anchors:end -->";

const DEFAULT_BASELINE_PATH = join(REPO_ROOT, "backend/scripts/baselines/v4-anchor-baseline.json");
const DEFAULT_DOC_PATH = join(REPO_ROOT, "docs/RACE_ENGINE_RULES.md");

function fmtPct(v) {
  return `${(v * 100).toFixed(1)} %`;
}

// Samme id -> visnings-form som headToHeadAnchors.js's egne `display`-
// funktioner (ikke JSON-serialiserbare, saa de er duplikeret her — se
// headToHeadV4.js's buildJsonExport()-kommentar).
const DISPLAY_BY_ID = {
  field_cohesion_flat: fmtPct,
  descent_vs_summit_gap_ratio: (v) => v.toFixed(2),
  descent_attack_gain_bounds: (v) => `${Math.round(v)}s`,
  punch_correlation: (v) => v.toFixed(2),
  cobblestone_lift_on_sectors: (v) => v.toFixed(3),
  favorite_win_rate: fmtPct,
  same_team_top10_share_4plus: fmtPct,
  breakaway_rate_per_terrain: fmtPct,
  sprinter_win_rate_flat: fmtPct,
  itt_correlation: (v) => v.toFixed(2),
  bonus_seconds_bounded: (v) => `${Math.round(v)}s`,
  mountain_top10_spread: (v) => `${Math.round(v)}s`,
  gt_winner_margin: (v) => `${Math.round(v)}s`,
};

function displayFor(id, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const fn = DISPLAY_BY_ID[id] ?? ((v) => String(v));
  return fn(value);
}

function formatCell(id, cell) {
  if (!cell || cell.verdict === "N/A") return "n/a";
  const base = displayFor(id, cell.value);
  const spread = cell.spread
    ? ` (${displayFor(id, cell.spread.min)}-${displayFor(id, cell.spread.max)})`
    : "";
  return `${base}${spread} [${cell.verdict}]`;
}

/**
 * @param {object} baseline  v4-anchor-baseline.json's parsede indhold
 * @returns {string}  markdown-blok INKL. start/slut-markoerer
 */
export function renderAnchorTable(baseline) {
  const lines = [];
  lines.push(START_MARKER);
  lines.push("");
  lines.push(
    "> **Genereret af harnesset, ikke haandskrevet** (#4911). Kilde: " +
      "`backend/scripts/baselines/v4-anchor-baseline.json`, produceret af " +
      "`backend/scripts/buildV4AnchorBaseline.mjs` fra den PINNEDE population + " +
      "de PINNEDE proxy-etaper — samme to filer hver gang, saa et fremtidigt " +
      "kalibrerings-PR maaler mod netop denne baseline, ikke en tilfaeldig koersel. " +
      "Spaend i parentes er min-max over seeds.",
  );
  lines.push(">");
  lines.push(
    `> Pinnet: motor-sha \`${baseline.main_sha.slice(0, 10)}\` · population ` +
      `\`${baseline.population_file}\` (${baseline.population_riders} ryttere, sha256 ` +
      `${baseline.population_file_sha256_16}) · etaper \`${baseline.stages_file}\` (sha256 ` +
      `${baseline.stages_file_sha256_16}) · seeds ${baseline.seeds.join(", ")} · feltstoerrelse ` +
      `${baseline.field_size} · genereret ${baseline.generated_at}.`,
  );
  lines.push(">");
  lines.push(`> **Refresh:** \`${baseline.refresh_command}\``);
  lines.push("");
  lines.push("| Anker | Baand (kilde) | v3 | v4 |");
  lines.push("|---|---|---|---|");
  for (const a of baseline.anchors) {
    lines.push(
      `| ${a.label} | ${a.band_label} (${a.source}) | ${formatCell(a.id, a.v3)} | ${formatCell(a.id, a.v4)} |`,
    );
  }
  lines.push("");
  lines.push(END_MARKER);
  return lines.join("\n");
}

/**
 * Erstatter blokken mellem markoererne i `docText` med `renderedBlock`.
 * @returns {string}  ny dokument-tekst
 */
export function replaceAnchorBlock(docText, renderedBlock) {
  const startIdx = docText.indexOf(START_MARKER);
  const endIdx = docText.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Fandt ikke begge markoerer (${START_MARKER} / ${END_MARKER}) i dokumentet. ` +
        "Indsaet dem manuelt én gang foerst.",
    );
  }
  const before = docText.slice(0, startIdx);
  const after = docText.slice(endIdx + END_MARKER.length);
  return `${before}${renderedBlock}${after}`;
}

function extractCurrentBlock(docText) {
  const startIdx = docText.indexOf(START_MARKER);
  const endIdx = docText.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) return null;
  return docText.slice(startIdx, endIdx + END_MARKER.length);
}

function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes("--check");
  const baselinePathArg = args.find((a) => a.startsWith("--baseline="));
  const docPathArg = args.find((a) => a.startsWith("--doc="));
  const baselinePath = baselinePathArg ? baselinePathArg.slice("--baseline=".length) : DEFAULT_BASELINE_PATH;
  const docPath = docPathArg ? docPathArg.slice("--doc=".length) : DEFAULT_DOC_PATH;

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const rendered = renderAnchorTable(baseline);
  const docText = readFileSync(docPath, "utf8");

  if (checkMode) {
    const current = extractCurrentBlock(docText);
    if (current === null) {
      console.error(`--check: fandt ikke ankertabel-markoererne i ${docPath}`);
      process.exit(1);
    }
    if (current !== rendered) {
      console.error(
        `--check FAILED: ankertabellen i ${docPath} afviger fra ${baselinePath}. ` +
          "Koer uden --check (eller med --write) for at opdatere.",
      );
      process.exit(1);
    }
    console.log("--check OK: ankertabellen matcher baseline'en.");
    return;
  }

  const next = replaceAnchorBlock(docText, rendered);
  writeFileSync(docPath, next);
  console.log(`Ankertabel skrevet ind i ${docPath}.`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("renderV4AnchorTable.mjs")) {
  main();
}

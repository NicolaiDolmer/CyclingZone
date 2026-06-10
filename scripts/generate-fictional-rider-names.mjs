#!/usr/bin/env node
// CLI: deterministisk rename-mapping for alle PCM-ryttere (#669).
//
// DRY-RUN ONLY — dette script rører ALDRIG nogen database. Output er filer
// (JSON-mapping, staging-SQL, sample-markdown) som ejeren reviewer, og som
// migrations-PLANEN i scripts/migrations-manual/ konsumerer EFTER ejer-go.
//
// Pipeline (begge trin lokalt, ingen DB):
//   1. python scripts/extract-pcm-rider-input.py        → scripts/out/669-pcm-rider-input.tsv
//   2. node scripts/generate-fictional-rider-names.mjs  → scripts/out/669-*.{json,sql,md}
//
// Determinisme: samme seed + samme input-TSV → bit-identisk output. Seed og
// SHA-256 af input gemmes i JSON-metadata, så enhver kørsel kan reproduceres.
//
// Flags:
//   --input <tsv>        default scripts/out/669-pcm-rider-input.tsv
//   --seed <int>         default 669
//   --out <json>         default scripts/out/669-fictional-names.json
//   --emit-sql <sql>     default scripts/out/669-fictional-names-staging.sql
//   --sample-out <md>    default scripts/out/669-fictional-names-sample.md
//   --sample-size <int>  default 100
//   --extra-names <txt>  valgfri: fil med ét eksisterende navn pr. linje som
//                        OGSÅ skal undgås (fx fiktive #1135-ryttere fra prod)

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { foldNameNordic } from "../backend/lib/pcmRiderMatcher.js";
import {
  generateRenameMapping,
  selectReviewSample,
  sqlString,
} from "./lib/fictional-rename-generator.mjs";
import { CLUSTER_APPROXIMATIONS } from "./lib/fictional-name-pools-extended.mjs";

function parseArgs(argv) {
  const args = {
    input: "scripts/out/669-pcm-rider-input.tsv",
    seed: 669,
    out: "scripts/out/669-fictional-names.json",
    emitSql: "scripts/out/669-fictional-names-staging.sql",
    sampleOut: "scripts/out/669-fictional-names-sample.md",
    sampleSize: 100,
    extraNames: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i];
    else if (a === "--seed") args.seed = parseInt(argv[++i], 10);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--emit-sql") args.emitSql = argv[++i];
    else if (a === "--sample-out") args.sampleOut = argv[++i];
    else if (a === "--sample-size") args.sampleSize = parseInt(argv[++i], 10);
    else if (a === "--extra-names") args.extraNames = argv[++i];
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return args;
}

// TSV: pcm_id \t nationality_code \t firstname \t lastname (header-linje).
// TSV frem for CSV: navne indeholder aldrig tab, så ingen quoting-kanter.
function readRiderTsv(path) {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines.shift().split("\t");
  const expected = ["pcm_id", "nationality_code", "firstname", "lastname"];
  if (header.join(",") !== expected.join(",")) {
    throw new Error(`Uventet TSV-header i ${path}: ${header.join(",")} (forventede ${expected.join(",")})`);
  }
  return lines.map((line, i) => {
    const [pcmId, nat, first, last] = line.split("\t");
    const pcm_id = parseInt(pcmId, 10);
    if (!Number.isInteger(pcm_id)) throw new Error(`Linje ${i + 2}: ugyldigt pcm_id "${pcmId}"`);
    return { pcm_id, nationality_code: nat, firstname: first, lastname: last };
  });
}

function writeOut(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function buildStagingSql(mapping, meta) {
  const lines = [];
  lines.push("-- AUTOGENERERET af scripts/generate-fictional-rider-names.mjs (#669)");
  lines.push(`-- seed=${meta.seed} input_sha256=${meta.input_sha256} genereret=${meta.generated_at}`);
  lines.push("-- Reproducérbar: samme seed + samme input-TSV giver bit-identisk fil.");
  lines.push("-- Konsumeres af scripts/migrations-manual/2026-06-10-669-fictional-rider-names-rename-PLAN.sql");
  lines.push("-- KØR ALDRIG denne fil alene mod prod — kun som del af planen, efter ejer-go.");
  lines.push("");
  lines.push("CREATE TABLE IF NOT EXISTS fictional_name_staging_669 (");
  lines.push("  pcm_id integer PRIMARY KEY,");
  lines.push("  nationality_code text NOT NULL,");
  lines.push("  new_firstname text NOT NULL,");
  lines.push("  new_lastname text NOT NULL");
  lines.push(");");
  lines.push("");
  lines.push("TRUNCATE fictional_name_staging_669;");
  lines.push("");
  const BATCH = 500;
  for (let i = 0; i < mapping.length; i += BATCH) {
    const batch = mapping.slice(i, i + BATCH);
    lines.push("INSERT INTO fictional_name_staging_669 (pcm_id, nationality_code, new_firstname, new_lastname) VALUES");
    lines.push(
      batch
        .map((m) => `  (${m.pcm_id}, ${sqlString(m.nationality_code)}, ${sqlString(m.new_firstname)}, ${sqlString(m.new_lastname)})`)
        .join(",\n") + ";",
    );
    lines.push("");
  }
  return lines.join("\n");
}

function buildSampleMarkdown(sample, stats, meta) {
  const lines = [];
  lines.push(`<!-- AUTOGENERERET af scripts/generate-fictional-rider-names.mjs — seed=${meta.seed} input_sha256=${meta.input_sha256} -->`);
  lines.push("");
  lines.push("| pcm_id | Nationalitet | Cluster | Nyt navn |");
  lines.push("|---|---|---|---|");
  for (const m of sample) {
    lines.push(`| ${m.pcm_id} | ${m.nationality_code} | ${m.cluster} | ${m.new_firstname} ${m.new_lastname} |`);
  }
  lines.push("");
  lines.push("### Cluster-utilization");
  lines.push("");
  lines.push("| Cluster | Ryttere | Kapacitet (kombinationer) | Udnyttelse |");
  lines.push("|---|---|---|---|");
  for (const [key, u] of Object.entries(stats.utilization).sort((a, b) => b[1].generated - a[1].generated)) {
    lines.push(`| ${key} | ${u.generated} | ${u.capacity} | ${u.pct}% |`);
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv);
  const rawInput = readFileSync(args.input);
  const inputSha = createHash("sha256").update(rawInput).digest("hex");
  const riders = readRiderTsv(args.input);

  const extraFoldedNames = [];
  if (args.extraNames) {
    for (const line of readFileSync(args.extraNames, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (t) extraFoldedNames.push(foldNameNordic(t));
    }
  }

  const { mapping, stats } = generateRenameMapping(riders, {
    seed: args.seed,
    extraFoldedNames,
  });

  const meta = {
    script: "scripts/generate-fictional-rider-names.mjs",
    issue: 669,
    seed: args.seed,
    input: args.input,
    input_sha256: inputSha,
    extra_names_file: args.extraNames,
    generated_at: new Date().toISOString(),
  };

  writeOut(args.out, JSON.stringify({ meta, stats, mapping }, null, 1));
  writeOut(args.emitSql, buildStagingSql(mapping, meta));

  const sample = selectReviewSample(mapping, { size: args.sampleSize });
  writeOut(args.sampleOut, buildSampleMarkdown(sample, stats, meta));

  // ── Konsol-rapport ───────────────────────────────────────────────────────────
  console.log(`\n#669 rename-mapping genereret (DRY-RUN, ingen DB)`);
  console.log(`  Ryttere:          ${stats.total}`);
  console.log(`  Nationaliteter:   ${stats.nationalities}`);
  console.log(`  Kollisions-korpus:${stats.corpusSize} foldede navne (alle nuværende + ${extraFoldedNames.length} ekstra)`);
  console.log(`  Compound-navne:   ${stats.compoundCount} (overflow-strategi)`);
  console.log(`  Seed:             ${stats.seed}`);
  console.log(`  Input-SHA256:     ${inputSha.slice(0, 16)}…`);
  console.log(`\n  Cluster-utilization (genereret/kapacitet):`);
  for (const [key, u] of Object.entries(stats.utilization).sort((a, b) => b[1].pct - a[1].pct)) {
    const warn = u.pct > 60 ? "  ⚠️ over 60% — udvid pool før næste vækst" : "";
    console.log(`    ${key.padEnd(16)} ${String(u.generated).padStart(5)} / ${String(u.capacity).padStart(5)}  (${u.pct}%)${warn}`);
  }
  const fb = Object.keys(stats.fallbackNationalities);
  if (fb.length) {
    console.log(`\n  ⚠️ Nationaliteter UDEN dedikeret pool (faldt til generic): ${JSON.stringify(stats.fallbackNationalities)}`);
  } else {
    console.log(`\n  ✅ Alle nationaliteter ramte en dedikeret (eller dokumenteret approksimeret) pool.`);
  }
  console.log(`\n  Dokumenterede kulturelle approksimationer: ${Object.keys(CLUSTER_APPROXIMATIONS).length} (se audit-doc)`);
  console.log(`\n  Output:`);
  console.log(`    JSON-mapping:  ${args.out}`);
  console.log(`    Staging-SQL:   ${args.emitSql}`);
  console.log(`    Review-sample: ${args.sampleOut}\n`);
}

main();

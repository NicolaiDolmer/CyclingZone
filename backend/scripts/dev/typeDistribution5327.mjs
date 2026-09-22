// #5327: Foer/efter-typefordeling paa arketype-genereringens PRIMAERE type.
//
// 100 % OFFLINE — generateFictionalRiders roerer ingen DB (se dens egen
// modul-kommentar i fictionalRiderGenerator.js), saa dette script er en ren
// lokal simulering, ikke en tørkørsel mod prod.
//
//   "Foer"  = primaryTypeMode "tier" (TIER_TYPE_WEIGHTS — dagens adfaerd,
//             uaendret default).
//   "Efter" = primaryTypeMode "distribution" (#5327s nye, bag-kontakt-graen:
//             primaeren traekkes tier-uafhaengigt fra archetypeDistribution.js'
//             DEFAULT_DISTRIBUTION).
//
// Ejer-krav 4/9 (gentaget paa #5327): foer/efter-fordeling paa n=1.000
// genererede ryttere, som tabel — men REPOET ER OFFENTLIGT (hard rule 17):
// maalte fordelinger fra generatoren maa ALDRIG committes eller citeres i
// PR-body/issue-kommentarer/commit-beskeder. Scriptet skriver derfor KUN til
// balance-internals/ (gitignoreret) — referér resultatet ved filnavn, aldrig
// ved de faktiske tal.
//
// Kør fra backend/:
//   node scripts/dev/typeDistribution5327.mjs
// Valgfrit:
//   --count=1000   antal ryttere pr. gren (default 1000, ejer-krav 4/9)
//   --seed=2026
//   --out=<mappe>  output-mappe (default: balance-internals/<dato>-5327-type-distribution)
//
// Refs #5327

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateFictionalRiders,
  PRIMARY_TYPE_MODE_TIER,
  PRIMARY_TYPE_MODE_DISTRIBUTION,
} from "../../lib/fictionalRiderGenerator.js";
import { ARCHETYPE_TYPES, DEFAULT_DISTRIBUTION } from "../../lib/archetypeDistribution.js";
import { LAUNCH_REFERENCE_YEAR } from "../../lib/riderSeasonAge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "../../..");

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

function countByType(riders) {
  const counts = Object.fromEntries(ARCHETYPE_TYPES.map((t) => [t, 0]));
  for (const r of riders) counts[r._meta.archetype] = (counts[r._meta.archetype] ?? 0) + 1;
  return counts;
}

function pct(n, total) {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
}

function main() {
  const count = Number(arg("count", 1000));
  const seed = Number(arg("seed", 2026));
  if (!Number.isInteger(count) || count < 1) throw new Error(`ugyldig --count=${count}`);
  if (!Number.isInteger(seed)) throw new Error(`ugyldig --seed=${seed}`);

  const referenceYear = LAUNCH_REFERENCE_YEAR;

  const before = generateFictionalRiders({
    seed, count, referenceYear, primaryTypeMode: PRIMARY_TYPE_MODE_TIER,
  }).riders;
  const after = generateFictionalRiders({
    seed, count, referenceYear, primaryTypeMode: PRIMARY_TYPE_MODE_DISTRIBUTION,
  }).riders;

  const beforeCounts = countByType(before);
  const afterCounts = countByType(after);

  const rows = ARCHETYPE_TYPES.map((t) => ({
    type: t,
    beforeN: beforeCounts[t] ?? 0,
    beforePct: pct(beforeCounts[t] ?? 0, before.length),
    afterN: afterCounts[t] ?? 0,
    afterPct: pct(afterCounts[t] ?? 0, after.length),
    targetPct: DEFAULT_DISTRIBUTION[t],
  }));

  const outDir = resolve(arg("out", join(REPO, "balance-internals",
    `${new Date().toISOString().slice(0, 10)}-5327-type-distribution`)));
  mkdirSync(outDir, { recursive: true });

  const lines = [
    `# #5327 primaer type-fordeling — foer/efter (n=${count} pr. gren, seed=${seed})`,
    "",
    "Foer  = primaryTypeMode \"tier\" (TIER_TYPE_WEIGHTS — dagens adfaerd).",
    "Efter = primaryTypeMode \"distribution\" (DEFAULT_DISTRIBUTION — #5327s nye kontakt).",
    "",
    "| Type | Foer (n) | Foer (%) | Efter (n) | Efter (%) | Maal-% (DEFAULT_DISTRIBUTION) |",
    "|---|---:|---:|---:|---:|---:|",
    ...rows.map((r) =>
      `| ${r.type} | ${r.beforeN} | ${r.beforePct} | ${r.afterN} | ${r.afterPct} | ${r.targetPct} |`),
    "",
    "IKKE daekket her: race:gate/sim-harness-koersel (kun raa primaer-typefordeling).",
    "Se PR-beskrivelsen for hvilken sim-harness der er koert ved siden af.",
  ];
  writeFileSync(join(outDir, "opsummering.md"), `${lines.join("\n")}\n`);

  console.log(`Skrevet: ${join(outDir, "opsummering.md")}`);
  console.log(
    "(Filen indeholder MAALTE FORDELINGER FRA GENERATOREN — citer ALDRIG de faktiske " +
    "tal i PR-body/issue-kommentarer/commit-beskeder, hard rule 17. Referér filen ved navn.)",
  );
}

main();

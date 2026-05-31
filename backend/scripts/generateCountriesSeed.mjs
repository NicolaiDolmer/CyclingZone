#!/usr/bin/env node
// Genererer seed-SQL for countries-tabellen (#844 Slice 1) fra det rene modul
// backend/lib/countriesSeed.js. Skriver til stdout (default) eller --out <fil>.
//
// Brug:
//   node backend/scripts/generateCountriesSeed.mjs                 # print seed-SQL
//   node backend/scripts/generateCountriesSeed.mjs --out seed.sql  # skriv til fil
//
// Rør ALDRIG en database. Outputtet indlejres i migrationen
// database/2026-05-31-countries-table.sql (committet), så seed'en er en
// reproducerbar, review-bar artefakt — ikke et live-kald.

import { writeFileSync } from "node:fs";
import { buildCountryRows, rowsToInsertSql } from "../lib/countriesSeed.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else throw new Error(`Ukendt argument: ${argv[i]}`);
  }
  return args;
}

const args = parseArgs(process.argv);
const { rows, warnings } = buildCountryRows();

const tierCounts = rows.reduce((acc, r) => {
  acc[r._tier] = (acc[r._tier] || 0) + 1;
  return acc;
}, {});

if (warnings.length) {
  console.error(`⚠️  ${warnings.length} advarsel(er) — udfyld huller i countriesSeed.js:`);
  for (const w of warnings) console.error(`   - ${w}`);
} else {
  console.error("✅ Ingen huller: alle nationer har name_en, ioc_code og continent.");
}
console.error(`📊 ${rows.length} nationer · tier-fordeling ${JSON.stringify(tierCounts)}`);

const sql = rowsToInsertSql(rows);

if (args.out) {
  writeFileSync(args.out, sql + "\n");
  console.error(`💾 Skrevet: ${args.out}`);
} else {
  process.stdout.write(sql + "\n");
}

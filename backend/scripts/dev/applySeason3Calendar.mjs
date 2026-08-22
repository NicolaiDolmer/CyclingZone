#!/usr/bin/env node
// #4103/#4104 — ORKESTRATOR for kalender-applyen. Een kommando i stedet for fire.
//
// Scriptet indeholder INGEN egen slette- eller skrivelogik. Det kalder de tre
// eksisterende, testede scripts i den rigtige raekkefoelge og afbryder oejeblikkeligt
// hvis et af dem fejler. Alle sikkerheds-gates ligger fortsat i de kaldte scripts:
//
//   1. regenSeason3Calendar.mjs (dry-run)   - saeson-port: status SKAL vaere 'upcoming'
//   2. wipeSeason3Calendar.mjs  (dry-run)   - gameplay-port: race_entries/-results/
//                                             -incidents SKAL vaere 0, ellers exit 1
//   3. wipeSeason3Calendar.mjs  --apply     - skriver JSON-snapshot af ALT foer sletning
//   4. regenSeason3Calendar.mjs --apply     - post-verificerer at foerste etape er 25/8
//
// Raekkefoelgen er bindende: regen --apply kraever 0 eksisterende races, saa wipe skal
// koere foerst. Og HELE kaeden kraever at saesonen stadig er 'upcoming' - efter
// cutoveret naegter wipe-scriptet at koere, og kalenderen kan ikke laengere rettes.
//
// KOERSEL (kun efter ejer-go paa dry-runnen):
//   cd backend
//   infisical run --env=prod -- node scripts/dev/applySeason3Calendar.mjs --jeg-har-set-dry-runnet
//
// Refs #4103 #4104 #4121

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIRMED = process.argv.includes("--jeg-har-set-dry-runnet");

if (!CONFIRMED) {
  console.error("STOP - denne kommando skriver til prod.");
  console.error("Kraever --jeg-har-set-dry-runnet. Se dry-runnen foerst.");
  process.exit(2);
}

const TRIN = [
  { nr: 1, navn: "Kalender-plan (dry-run)", script: "regenSeason3Calendar.mjs", args: [] },
  { nr: 2, navn: "Sletnings-plan (dry-run)", script: "wipeSeason3Calendar.mjs", args: [] },
  { nr: 3, navn: "Slet gammel S3-kalender (snapshot skrives foerst)", script: "wipeSeason3Calendar.mjs", args: ["--apply", "--jeg-har-set-dry-runnet"] },
  { nr: 4, navn: "Byg ny S3-kalender", script: "regenSeason3Calendar.mjs", args: ["--apply", "--jeg-har-set-dry-runnet"] },
];

const linje = (t) => console.log("\n" + "=".repeat(72) + `\n  TRIN ${t.nr}/4 — ${t.navn}\n` + "=".repeat(72));

for (const trin of TRIN) {
  linje(trin);
  const r = spawnSync(process.execPath, [join(__dirname, trin.script), ...trin.args], { stdio: "inherit" });
  if (r.error) {
    console.error(`\nAFBRUDT paa trin ${trin.nr}: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`\nAFBRUDT paa trin ${trin.nr} (${trin.script} exit ${r.status}).`);
    if (trin.nr <= 2) console.error("Intet er skrevet - en af gatene sagde nej. Laes outputtet ovenfor.");
    if (trin.nr === 3) console.error("Sletningen fejlede. Kalenderen kan vaere delvist slettet - TJEK snapshot-filen og sig til.");
    if (trin.nr === 4) console.error("KALENDEREN ER SLETTET MEN IKKE GENOPBYGGET. Koer trin 4 igen manuelt, eller gendan fra snapshottet.");
    process.exit(r.status ?? 1);
  }
}

console.log("\n" + "=".repeat(72));
console.log("  FAERDIG - alle fire trin gik igennem.");
console.log("=".repeat(72));
console.log("\nNaeste: verificér i appen, og giv besked til Claude, som tjekker");
console.log("prod-tallene (antal loeb, race_days_total, GT-vinduer, monument-laengder)");
console.log("mod dry-runnen og opdaterer patch notes + issues.\n");

#!/usr/bin/env node
// #4123 — (gen)skriver den committede gyldne S3-kalender-snapshot
// (lib/__fixtures__/calendarGoldenSnapshot.s3.json) fra den offline pakker-kørsel.
//
// Kør denne KUN når en ændring i pakkeren/generatoren er en TILSIGTET ændring af
// kalenderens form — så viser `git diff` på selve JSON-filen præcis hvad der ændrede
// sig, og den ændring hører med i samme PR som koden der forårsagede den. At regenerere
// snapshottet er IKKE det samme som at rette en fejl: består testen ikke fordi
// pakkeren er blevet FORKERT, er svaret at rette pakkeren, ikke snapshottet.
//
// 100 % offline (samme fixture-sti som lib/calendarGoldenSnapshot.test.js).
//
//   cd backend && node scripts/dev/refreshCalendarGoldenSnapshot.mjs
//   cd backend && node scripts/dev/refreshCalendarGoldenSnapshot.mjs --check   (exit 1 ved diff, skriver intet)
//
// Refs #4123 #4218

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildCalendarGoldenSnapshot, diffCalendarGoldenSnapshots } from "./lib/calendarGoldenSnapshotBuilder.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, "..", "..", "lib", "__fixtures__", "calendarGoldenSnapshot.s3.json");

const checkOnly = process.argv.includes("--check");
const ny = buildCalendarGoldenSnapshot();
const nyJson = `${JSON.stringify(ny, null, 2)}\n`;

if (checkOnly) {
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`[FEJL] ${SNAPSHOT_PATH} findes ikke.`);
    process.exit(1);
  }
  const gylden = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const diff = diffCalendarGoldenSnapshots(gylden, ny);
  if (diff.length === 0) {
    console.log("[ok] Ingen ændring — snapshottet er stadig gyldigt.");
    process.exit(0);
  }
  console.error(`[FEJL] ${diff.length} ændring(er) fundet mod ${SNAPSHOT_PATH}:`);
  for (const linje of diff.slice(0, 40)) console.error(`  ${linje}`);
  if (diff.length > 40) console.error(`  ... og ${diff.length - 40} flere`);
  console.error("\nEr ændringen tilsigtet: kør scriptet UDEN --check for at genskrive filen.");
  process.exit(1);
}

writeFileSync(SNAPSHOT_PATH, nyJson, "utf8");
console.log(`Skrevet: ${SNAPSHOT_PATH}`);

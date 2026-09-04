// #4123 — CI-testen bag den gyldne S3-kalender-snapshot.
//
// Regenererer kalenderen offline (samme fixture + samme kanoniske S3-parametre som
// scripts/dev/calendarScorecard4218.mjs) og diff'er mod den committede
// lib/__fixtures__/calendarGoldenSnapshot.s3.json. Enhver PR der ændrer pakkerens/
// generatorens output viser sin fulde konsekvens HER, i stedet for at et menneske skal
// huske at køre en dry-run og eyeballe før/efter — det var præcis den arbejdsgang der
// lod #3546's bytte-mekanisme bryde GT-real-day-separationen uopdaget (se #4123).
//
// EN RØD DIFF ER IKKE AUTOMATISK EN FEJL. Er ændringen tilsigtet, kør
// `node scripts/dev/refreshCalendarGoldenSnapshot.mjs` og commit den nye snapshot-fil
// i SAMME PR som koden der ændrede kalenderen (§12's forward-guard-princip i
// docs/CALENDAR_RULES.md: ændrer du en regel, skal SSOT + kode + gate ændres sammen).
//
// Refs #4123 #4218 #4121

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildCalendarGoldenSnapshot, diffCalendarGoldenSnapshots } from "../scripts/dev/lib/calendarGoldenSnapshotBuilder.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, "__fixtures__", "calendarGoldenSnapshot.s3.json");

test("#4123: den offline S3-kalender matcher den committede gyldne snapshot", () => {
  const gylden = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const ny = buildCalendarGoldenSnapshot();

  const diff = diffCalendarGoldenSnapshots(gylden, ny);
  if (diff.length > 0) {
    const besked = [
      `${diff.length} ændring(er) mod den gyldne kalender-snapshot (lib/__fixtures__/calendarGoldenSnapshot.s3.json):`,
      ...diff.slice(0, 30).map((l) => `  ${l}`),
      diff.length > 30 ? `  ... og ${diff.length - 30} flere` : null,
      "",
      "Er ændringen TILSIGTET: kør 'node scripts/dev/refreshCalendarGoldenSnapshot.mjs' i backend/ og commit den nye fil i samme PR.",
      "Er den IKKE tilsigtet: det er en regression i pakkeren/generatoren, ret koden i stedet.",
    ].filter(Boolean).join("\n");
    assert.fail(besked);
  }
});

test("#4123: determinisme — to regenereringer giver byte-identisk snapshot", () => {
  const a = JSON.stringify(buildCalendarGoldenSnapshot());
  const b = JSON.stringify(buildCalendarGoldenSnapshot());
  assert.equal(a, b, "buildCalendarGoldenSnapshot() skal være et rent, deterministisk kald");
});

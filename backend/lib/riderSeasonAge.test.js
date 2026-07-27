// backend/lib/riderSeasonAge.test.js
// SSOT for rytter-alder + forward-guard mod at formlen duplikeres igen.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LAUNCH_REFERENCE_YEAR, ageForSeason, seasonReferenceYear } from "./riderSeasonAge.js";
import { ageForSeason as fromProgression } from "./riderProgressionEngine.js";
import { ageForSeason as fromSquadGuard } from "./squadRiskGuard.js";
import { ageForSeason as fromPeakSuggestions } from "./peakSuggestions.js";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));

test("ageForSeason: sæson-drevet, ikke wall-clock", () => {
  assert.equal(ageForSeason("2001-03-01", 1), LAUNCH_REFERENCE_YEAR - 2001);
  assert.equal(ageForSeason("2001-03-01", 2), LAUNCH_REFERENCE_YEAR + 1 - 2001);
  assert.equal(ageForSeason("2001-03-01", 5), LAUNCH_REFERENCE_YEAR + 4 - 2001);
  // Fødselsdagen i året er irrelevant (cykelsportens årgangs-konvention).
  assert.equal(ageForSeason("2001-12-31", 2), ageForSeason("2001-01-01", 2));
});

test("ageForSeason: manglende eller ugyldigt input → null, aldrig et gæt", () => {
  assert.equal(ageForSeason(null, 2), null);
  assert.equal(ageForSeason(undefined, 2), null);
  assert.equal(ageForSeason("", 2), null);
  assert.equal(ageForSeason("2001-03-01", null), null);
  assert.equal(ageForSeason("2001-03-01", Number.NaN), null);
  assert.equal(ageForSeason("ikke-en-dato", 2), null);
});

test("seasonReferenceYear: sæson N er launch-året plus N−1", () => {
  assert.equal(seasonReferenceYear(1), LAUNCH_REFERENCE_YEAR);
  assert.equal(seasonReferenceYear(2), LAUNCH_REFERENCE_YEAR + 1);
  assert.equal(seasonReferenceYear(null), null);
  assert.equal(seasonReferenceYear(Number.NaN), null);
});

// Alle tre libs der tidligere havde hver sin kopi skal nu svare identisk. Divergerer
// de, er en duplikat sneget tilbage ind — præcis det #3071 og #3081 kostede.
test("alle konsumenter deler præcis samme formel", () => {
  for (const seasonNumber of [1, 2, 3, 7]) {
    for (const birthdate of ["1996-05-05", "2004-01-01", "1988-12-31"]) {
      const expected = ageForSeason(birthdate, seasonNumber);
      assert.equal(fromProgression(birthdate, seasonNumber), expected,
        `riderProgressionEngine divergerer for ${birthdate} i sæson ${seasonNumber}`);
      assert.equal(fromSquadGuard(birthdate, seasonNumber), expected,
        `squadRiskGuard divergerer for ${birthdate} i sæson ${seasonNumber}`);
      assert.equal(fromPeakSuggestions(birthdate, seasonNumber), expected,
        `peakSuggestions divergerer for ${birthdate} i sæson ${seasonNumber}`);
    }
  }
});

// Forward-guard. Historikken er entydig: hver gang formlen blev kopieret "med en god
// begrundelse", divergerede en af kopierne senere. #3071 (frontend på wall-clock) og
// #3081 (assistenten på wall-clock) er begge den fejl. Guarden fejler hvis nogen
// erklærer konstanten eller formlen på ny i backend/lib i stedet for at importere.
test("forward-guard: LAUNCH_REFERENCE_YEAR erklæres kun ét sted i backend/lib", () => {
  const offenders = [];
  for (const file of readdirSync(LIB_DIR)) {
    if (!file.endsWith(".js") || file.endsWith(".test.js")) continue;
    if (file === "riderSeasonAge.js") continue; // SSOT'en selv
    const src = readFileSync(join(LIB_DIR, file), "utf8");
    // En ERKLÆRING (const/let/var/export const), ikke en import eller en omtale
    // i en kommentar. Kommentarlinjer strippes først, så dokumentationen der
    // forklarer historikken ikke falsk-fejler guarden.
    const code = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    if (/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+LAUNCH_REFERENCE_YEAR\s*=/.test(code)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [],
    `LAUNCH_REFERENCE_YEAR skal importeres fra riderSeasonAge.js, ikke erklæres på ny. ` +
    `Duplikater har kostet #3071 og #3081. Fundet i: ${offenders.join(", ")}`);
});

test("forward-guard: guarden er ikke et tavst no-op", () => {
  // Selve SSOT-filen SKAL indeholde erklæringen guarden leder efter — ellers ville
  // regexet kunne være forkert uden at nogen opdagede det.
  const ssot = readFileSync(join(LIB_DIR, "riderSeasonAge.js"), "utf8");
  assert.match(ssot, /export const LAUNCH_REFERENCE_YEAR\s*=/,
    "guardens mønster matcher ikke længere den erklæring den skal fange");
});

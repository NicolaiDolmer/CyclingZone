// backend/lib/riderSeasonAge.test.js
// SSOT for rytter-alder + forward-guard mod at formlen duplikeres igen.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { LAUNCH_REFERENCE_YEAR, ageForSeason, seasonReferenceYear } from "./riderSeasonAge.js";
import { ageForSeason as fromProgression } from "./riderProgressionEngine.js";
import { ageForSeason as fromSquadGuard } from "./squadRiskGuard.js";
import { ageForSeason as fromPeakSuggestions } from "./peakSuggestions.js";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = dirname(LIB_DIR);
const SCRIPTS_DIR = join(BACKEND_DIR, "scripts");

// Kommentarlinjer strippes, saa dokumentationen der forklarer historikken ikke
// falsk-fejler guarderne nedenfor.
function codeOf(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
}

// Alle .js/.mjs under en mappe (rekursivt), uden tests.
function sourceFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...sourceFilesUnder(path)); continue; }
    if (!/\.(js|mjs)$/.test(entry.name) || /\.test\.(js|mjs)$/.test(entry.name)) continue;
    out.push(path);
  }
  return out;
}

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
// #4455 udvidede guarden fra backend/lib til også backend/scripts: den fjerde kopi
// stod i scripts/simulateSeasonProduction.js, og en måling fandt syv til. Scripts er
// ikke "bare" scripts — de er kalibreringsgrundlaget balance-beslutninger træffes på.
test("forward-guard: launch-referenceåret erklæres kun ét sted (backend/lib + backend/scripts)", () => {
  const offenders = [];
  for (const path of [...sourceFilesUnder(LIB_DIR), ...sourceFilesUnder(SCRIPTS_DIR)]) {
    if (path === join(LIB_DIR, "riderSeasonAge.js")) continue; // SSOT'en selv
    const code = codeOf(path);
    const rel = relative(BACKEND_DIR, path).replace(/\\/g, "/");
    // (a) En ERKLÆRING af selve navnet — ikke en import, ikke en omtale.
    if (/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+LAUNCH_REFERENCE_YEAR\s*=/.test(code)) {
      offenders.push(`${rel} (erklærer LAUNCH_REFERENCE_YEAR)`);
    }
    // (b) Samme konstant under et andet navn: REFERENCE_YEAR/SEASON1_YEAR/ASOF_YEAR/
    //     LAUNCH_YEAR/REF_YEAR er alle sammen dukket op med 2026 hårdkodet.
    const alias = code.match(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*YEAR)\s*=\s*2026\s*[;,\n]/);
    if (alias) offenders.push(`${rel} (${alias[1]} = 2026)`);
  }
  assert.deepEqual(offenders, [],
    `Launch-referenceåret skal importeres fra lib/riderSeasonAge.js, ikke erklæres på ny. ` +
    `Duplikater har kostet #3071, #3081 og #4455. Fundet i:\n${offenders.join("\n")}`);
});

// Konstanten alene er ikke nok: formlen kan også inlines med årstallet skrevet
// direkte ind (`2026 - fødselsår`, `2026 + (n-1) - fødselsår`). Det var præcis
// mønsteret i seks scripts #4455 ryddede op i.
test("forward-guard: ingen inlinet alders-formel med hårdkodet årstal i backend/scripts", () => {
  // Et 4-cifret årstal, evt. med et sæson-offset, minus et fødselsår-udtryk.
  const INLINE_AGE = /\b20\d\d\b[^\n;]{0,40}?-\s*(?:new\s+Date\([^)]*birthdate|Number\(String\([^)]*birthdate)/;
  const offenders = [];
  for (const path of sourceFilesUnder(SCRIPTS_DIR)) {
    const code = codeOf(path);
    if (INLINE_AGE.test(code)) offenders.push(relative(BACKEND_DIR, path).replace(/\\/g, "/"));
  }
  assert.deepEqual(offenders, [],
    `Alders-formlen skal komme fra lib/riderSeasonAge.ageForSeason(birthdate, seasonNumber), ` +
    `ikke skrives med årstallet inline. Fundet i:\n${offenders.join("\n")}`);
});

test("forward-guard: guarderne er ikke tavse no-ops", () => {
  // Selve SSOT-filen SKAL indeholde erklæringen guarden leder efter — ellers ville
  // regexet kunne være forkert uden at nogen opdagede det.
  const ssot = readFileSync(join(LIB_DIR, "riderSeasonAge.js"), "utf8");
  assert.match(ssot, /export const LAUNCH_REFERENCE_YEAR\s*=/,
    "guardens mønster matcher ikke længere den erklæring den skal fange");

  // Guarderne skal fælde de præcise linjer #4455 fjernede. Uden det kunne et regex
  // stille og roligt holde op med at matche, og guarden ville bestå på ingenting.
  const ALIAS = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*YEAR)\s*=\s*2026\s*[;,\n]/;
  const INLINE_AGE = /\b20\d\d\b[^\n;]{0,40}?-\s*(?:new\s+Date\([^)]*birthdate|Number\(String\([^)]*birthdate)/;
  for (const line of [
    "const LAUNCH_YEAR = 2026;",
    "const SEASON1_YEAR = 2026;",
    "const REFERENCE_YEAR = 2026;",
    "const ASOF_YEAR = 2026;",
    "const REF_YEAR = 2026;",
  ]) {
    assert.match(`\n${line}`, ALIAS, `alias-guarden fanger ikke længere: ${line}`);
  }
  for (const line of [
    "const age = 2026 - Number(String(riderRow.birthdate).slice(0, 4));",
    "const age = 2026 + (seasonNumber - 1) - new Date(r.birthdate).getUTCFullYear();",
    "const age = SEASON1_YEAR - new Date(r.birthdate).getFullYear();".replace("SEASON1_YEAR", "2026"),
  ]) {
    assert.match(line, INLINE_AGE, `inline-guarden fanger ikke længere: ${line}`);
  }
  // Og den må ikke fælde den korrekte kaldeform.
  assert.doesNotMatch("const age = ageForSeason(r.birthdate, season.number);", INLINE_AGE);
});

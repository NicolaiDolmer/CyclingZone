// backend/lib/riderSeasonAge.test.js
// SSOT for rytter-alder + forward-guard mod at formlen duplikeres igen.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LAUNCH_REFERENCE_YEAR, ageForSeason, seasonReferenceYear, birthYearFrom,
  isU25ForReferenceYear, isU25ForSeason, isU23ForReferenceYear, isU23ForSeason,
} from "./riderSeasonAge.js";
import { ageForSeason as fromProgression } from "./riderProgressionEngine.js";
import { ageForSeason as fromSquadGuard } from "./squadRiskGuard.js";
import { ageForSeason as fromPeakSuggestions } from "./peakSuggestions.js";
import { deriveIsU25FromBirthdate } from "./raceRunner.js";

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

// #4455 FUND 4: fødselsåret må ikke afhænge af serverens tidszone. "YYYY-MM-DD"
// parses som UTC-midnat, så `new Date(bd).getFullYear()` ruller 1. januar et år
// tilbage vest for UTC. Prod har 9 ryttere født 1/1 (målt 31/8), og de gamle
// script-varianter (getUTCFullYear / slice(0,4)) var begge tidszone-uafhængige —
// SSOT'en skal matche DEM, ikke lokaltiden.
test("birthYearFrom: dato-kun-strenge er tidszone-uafhængige", () => {
  assert.equal(birthYearFrom("2001-01-01"), 2001);
  assert.equal(birthYearFrom("2001-12-31"), 2001);
  assert.equal(birthYearFrom(" 1996-06-15 "), 1996); // trimmes
  // Samme svar som de to gamle tidszone-uafhængige varianter, for hele årgangen.
  for (let year = 1975; year <= 2012; year++) {
    for (const md of ["01-01", "06-15", "12-31"]) {
      const bd = `${year}-${md}`;
      assert.equal(birthYearFrom(bd), new Date(bd).getUTCFullYear(), `getUTCFullYear-variant divergerer for ${bd}`);
      assert.equal(birthYearFrom(bd), Number(String(bd).slice(0, 4)), `slice(0,4)-variant divergerer for ${bd}`);
    }
  }
});

test("birthYearFrom: manglende eller ugyldigt input → null", () => {
  assert.equal(birthYearFrom(null), null);
  assert.equal(birthYearFrom(undefined), null);
  assert.equal(birthYearFrom(""), null);
  assert.equal(birthYearFrom("ikke-en-dato"), null);
  // Ikke dato-kun-formen → falder tilbage på Date, så et fuldt timestamp stadig virker.
  assert.equal(birthYearFrom("1996-06-15T12:00:00Z"), new Date("1996-06-15T12:00:00Z").getFullYear());
});

test("seasonReferenceYear: sæson N er launch-året plus N−1", () => {
  assert.equal(seasonReferenceYear(1), LAUNCH_REFERENCE_YEAR);
  assert.equal(seasonReferenceYear(2), LAUNCH_REFERENCE_YEAR + 1);
  assert.equal(seasonReferenceYear(null), null);
  assert.equal(seasonReferenceYear(Number.NaN), null);
});

// ── U25/U23 (ejer-beslutning 2/9-2026, UCI-reglen) ────────────────────────────
// U25 = sæson-alder ≤ 25 (født ≥ referenceår-25). Ændret fra den tidligere
// "< 25"-konvention, da spillerne forventede at en 25-årig talte som U25 (feedback
// 1/9), og UCIs hvide trøje følger netop denne grænse. U23 er UÆNDRET (< 23).
test("isU25ForReferenceYear: boundary 24/25/26 - 24 og 25 ER U25, 26 er IKKE", () => {
  assert.equal(isU25ForReferenceYear("2002-06-15", 2026), true);  // 24
  assert.equal(isU25ForReferenceYear("2001-06-15", 2026), true);  // 25, UCI-reglen
  assert.equal(isU25ForReferenceYear("2001-01-01", 2026), true);  // 25, årsskifte
  assert.equal(isU25ForReferenceYear("2000-06-15", 2026), false); // 26
});

test("isU25ForReferenceYear: robust ved manglende/ugyldigt input", () => {
  assert.equal(isU25ForReferenceYear(null, 2026), false);
  assert.equal(isU25ForReferenceYear(undefined, 2026), false);
  assert.equal(isU25ForReferenceYear("2001-01-01", null), false);
  assert.equal(isU25ForReferenceYear("2001-01-01", Number.NaN), false);
  assert.equal(isU25ForReferenceYear("ikke-en-dato", 2026), false);
});

test("isU25ForSeason: sæson-drevet - samme rytter kan krydse 25-grænsen ved sæsonskift", () => {
  // Født 2001 → 25 år i sæson 1 (2026, U25 under UCI-reglen), 26 år i sæson 2 (2027, ikke U25).
  assert.equal(isU25ForSeason("2001-06-15", 1), true);
  assert.equal(isU25ForSeason("2001-06-15", 2), false);
  assert.equal(isU25ForSeason("2001-06-15", null), false);
});

test("isU23ForReferenceYear: boundary 22/23 - UÆNDRET af 2/9-beslutningen", () => {
  assert.equal(isU23ForReferenceYear("2004-06-15", 2026), true);  // 22
  assert.equal(isU23ForReferenceYear("2003-06-15", 2026), false); // 23 (bærer u25 i stedet)
  assert.equal(isU23ForReferenceYear(null, 2026), false);
  assert.equal(isU23ForReferenceYear("2004-06-15", Number.NaN), false);
});

test("isU23ForSeason: delegerer via seasonReferenceYear, samme grænse som isU23ForReferenceYear", () => {
  assert.equal(isU23ForSeason("2004-06-15", 1), isU23ForReferenceYear("2004-06-15", LAUNCH_REFERENCE_YEAR));
  assert.equal(isU23ForSeason("2004-06-15", null), false);
});

// deriveIsU25FromBirthdate (raceRunner.js) er den ene konsument der IKKE tager
// et sæsonNUMMER men et referenceår direkte, samme kontrakt som
// isU25ForReferenceYear, så den skal svare bit-identisk.
test("deriveIsU25FromBirthdate (raceRunner.js) deler præcis samme formel som isU25ForReferenceYear", () => {
  for (const referenceYear of [2026, 2027, 2030]) {
    for (const birthdate of ["2010-06-15", "2002-01-01", "2001-01-01", "2001-12-31", "2000-06-15", null]) {
      assert.equal(
        deriveIsU25FromBirthdate(birthdate, referenceYear),
        isU25ForReferenceYear(birthdate, referenceYear),
        `raceRunner.deriveIsU25FromBirthdate divergerer for ${birthdate} i referenceår ${referenceYear}`
      );
    }
  }
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
    // (c) Samme konstant som OBJEKT-PROPERTY eller DEFAULT-PARAMETER. Første runde af
    //     #4455 så kun erklæringsformen, så `asOfYear: 2026` i abilityDerivation.js's
    //     CALIBRATION slap forbi — den FEMTE kopi, og den eneste i den KØRENDE backend
    //     (deriveAbilities kaldes uden asOfYear fra backfillCores/starterSquadAllocator).
    //     Et nøglenavn der ender på "Year"/"YEAR" er et årstal, ikke et seed: `seed: 2026`
    //     og `makeRng(2026)` er bevidst urørte og må ikke fældes.
    const prop = code.match(/\b([A-Za-z_$][A-Za-z0-9_$]*(?:Year|YEAR))\s*[:=]\s*2026\b/);
    if (prop) offenders.push(`${rel} (${prop[1]}: 2026)`);
    // (d) `|| 2026` — fallback-formen, fx når et årstal ikke kunne parses ud af
    //     season.start_date (academyIntake.js/seasonAcademyIntake.js).
    if (/\|\|\s*2026\b/.test(code)) offenders.push(`${rel} (|| 2026 som fallback)`);
  }
  assert.deepEqual(offenders, [],
    `Launch-referenceåret skal importeres fra lib/riderSeasonAge.js, ikke erklæres på ny. ` +
    `Duplikater har kostet #3071, #3081 og #4455. Fundet i:\n${offenders.join("\n")}`);
});

// Konstanten alene er ikke nok: formlen kan også inlines med årstallet skrevet
// direkte ind (`2026 - fødselsår`, `2026 + (n-1) - fødselsår`). Det var præcis
// mønsteret i seks scripts #4455 ryddede op i.
// Et 4-cifret årstal, evt. med et sæson-offset, minus et fødselsår-udtryk — alt sammen
// på ÉN linje.
const INLINE_AGE = /\b20\d\d\b[^\n;]{0,40}?-\s*(?:new\s+Date\([^)]*birthdate|Number\(String\([^)]*birthdate)/;

// Den FLERLINJEDE form, som INLINE_AGE ikke kan se: fødselsåret trækkes ud i en lokal
// variabel på én linje og bruges i formlen på en anden. #4455's review afslørede at
// præcis den form — careerCurveSimulation.js's `ageInSeason1` — slap forbi guarden,
// selvom PR'en selv fjernede den. Den blev kun fanget indirekte, fordi dens
// `const SEASON1_YEAR = 2026` faldt i alias-guarden; havde konstanten heddet noget
// andet, var kopien gået lige igennem.
const BIRTH_YEAR_LOCAL = /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*[^;\n]*birthdate[^;\n]*(?:getUTCFullYear|getFullYear|slice\s*\(\s*0\s*,\s*4\s*\))/g;

function multilineAgeOffence(code) {
  for (const m of code.matchAll(BIRTH_YEAR_LOCAL)) {
    const navn = m[1];
    // Et årstal eller en *YEAR-konstant minus netop den lokale = alders-formlen.
    const brug = new RegExp(`(?:\\b20\\d\\d\\b|[A-Za-z_$][A-Za-z0-9_$]*(?:Year|YEAR))\\s*-\\s*${navn}\\b`);
    if (brug.test(code)) return navn;
  }
  return null;
}

test("forward-guard: ingen inlinet alders-formel med hårdkodet årstal i backend/lib + backend/scripts", () => {
  const offenders = [];
  // #4455-review: guarden dækker nu OGSÅ backend/lib. Den femte kopi lå netop dér,
  // i den kørende backend — at kun scripts blev scannet var selve hullet.
  for (const path of [...sourceFilesUnder(LIB_DIR), ...sourceFilesUnder(SCRIPTS_DIR)]) {
    if (path === join(LIB_DIR, "riderSeasonAge.js")) continue; // SSOT'en selv
    const code = codeOf(path);
    const rel = relative(BACKEND_DIR, path).replace(/\\/g, "/");
    if (INLINE_AGE.test(code)) offenders.push(`${rel} (årstal inline på én linje)`);
    const navn = multilineAgeOffence(code);
    if (navn) offenders.push(`${rel} (fødselsår i lokal '${navn}', formel på næste linje)`);
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

  // #4455-review, FUND 2: objekt-property- og fallback-formen. `asOfYear: 2026` var
  // den femte kopi, og den slap forbi begge de oprindelige guards.
  const PROP = /\b([A-Za-z_$][A-Za-z0-9_$]*(?:Year|YEAR))\s*[:=]\s*2026\b/;
  for (const line of [
    "  asOfYear: 2026,",
    "  referenceYear: 2026,",
    "  referenceYear = 2026,",
    "  launchYear: 2026,",
    "const LAUNCH_REFERENCE_YEAR = 2026;",
  ]) {
    assert.match(line, PROP, `property-guarden fanger ikke længere: ${line}`);
  }
  // Seeds er IKKE årstal og må aldrig fældes — de er bevidst hårdkodede.
  for (const line of ["  seed: 2026,", "const rng = makeRng(2026);", "  count: 2026,"]) {
    assert.doesNotMatch(line, PROP, `property-guarden fælder et seed: ${line}`);
  }
  assert.match("  ?? (parseInt(x, 10) || 2026);", /\|\|\s*2026\b/);

  // #4455-review, FUND 3: den FLERLINJEDE form. Dette er careerCurveSimulation.js's
  // `ageInSeason1` ORDRET som den stod før denne PR fjernede den. Den oprindelige
  // guard 2 matchede den IKKE — PR-bodyens påstand om det modsatte var forkert.
  const FJERNET_FRA_CAREER_CURVE = [
    "function ageInSeason1(birthdate) {",
    "  const birthYear = new Date(birthdate).getFullYear();",
    "  return Number.isFinite(birthYear) ? SEASON1_YEAR - birthYear : null;",
    "}",
  ].join("\n");
  assert.doesNotMatch(FJERNET_FRA_CAREER_CURVE, INLINE_AGE,
    "forudsætningen er ændret: en-linje-guarden matcher nu den flerlinjede form");
  assert.equal(multilineAgeOffence(FJERNET_FRA_CAREER_CURVE), "birthYear",
    "flerlinje-guarden fanger ikke længere careerCurveSimulation.js's fjernede formel");

  // Samme form med de to andre år-udtræk, så guarden ikke kun kender én stavemåde.
  for (const variant of [
    "const by = new Date(r.birthdate).getUTCFullYear();\nconst age = 2026 - by;",
    "let bY = Number(String(row.birthdate).slice(0, 4));\nconst age = REFERENCE_YEAR - bY;",
  ]) {
    assert.notEqual(multilineAgeOffence(variant), null, `flerlinje-guarden fanger ikke: ${variant}`);
  }

  // Den korrekte kaldeform og SSOT'ens egen delte helper må ikke fældes.
  assert.equal(multilineAgeOffence("const age = ageForSeason(r.birthdate, n);"), null);
  assert.equal(multilineAgeOffence("const year = birthYearFrom(birthdate);\nreturn clamp(asOfYear - year, 16, 45);"), null);
});

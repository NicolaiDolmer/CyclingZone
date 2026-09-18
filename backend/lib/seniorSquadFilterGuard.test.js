// Forward-guard for seniortruppens prædikat (#4619, spec §5.1).
//
// HVAD DEN FÆLDER
// Et nyt, håndskrevet `.eq("is_academy", false)` i backend/lib eller
// backend/routes. Det er senior-læserens filter, og det skal ligge ÉT sted:
// squads.applySeniorSquadFilter. Denne guard er backwards-checkets tvilling —
// backwards-checket fandt og konverterede de eksisterende kaldsteder, guarden
// sikrer at nummer tretten ikke sniger sig ind.
//
// HVORFOR DET ER VÆRD AT VOGTE
// Præcis denne spredning er hvad #1307/#1308 kostede: ét kaldsted manglede
// akademi-filteret, og 264 akademiryttere blev auto-udtaget til seniorløb. Med
// en `riders.squad`-backfill der endnu ikke er kørt, er prisen for en ny kopi
// endnu højere: en kopi der kun spørger på `is_academy` bliver tavst FORKERT i
// det øjeblik backfill'en lander, og en kopi der kun spørger på `squad` er
// forkert NU. Begge fejl er usynlige i en almindelig test.
//
// HVAD DEN BEVIDST IKKE FÆLDER
//   • `.eq("is_academy", true)` — ungdoms-siden (akademi-optagelse, graduering,
//     intake-udløb) har sin egen SSOT-opgave og er ikke denne slices scope.
//   • `is_academy: false` i et update/insert-objekt — det er en SKRIVNING, og den
//     har allerede sin egen delte helper (squads.seniorSquadPatch).
//   • backend/scripts/** — engangs-dry-runs og snapshots er analyse, ikke
//     gameplay-læsere. De må gerne spørge på rå kolonner.
//   • Testfiler, som netop skal kunne konstruere det rå filter for at asserte på det.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(__dirname, "..");

// Den ENE fil der må indeholde prædikatet.
const ALLOWED = new Set([join("lib", "squads.js")]);

// Mapper der scannes. backend/scripts er bevidst udenfor, se headeren.
const SCANNED_DIRS = ["lib", "routes"];

// `.eq("is_academy", false)` i begge citationsformer, med vilkårlig whitespace.
const SENIOR_FILTER_RE = /\.eq\(\s*["']is_academy["']\s*,\s*false\s*\)/g;

function jsFilesIn(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__fixtures__" || entry === "testdb") continue;
      out.push(...jsFilesIn(full));
      continue;
    }
    if (!/\.(js|mjs)$/.test(entry)) continue;
    if (/\.test\.(js|mjs)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

test("ingen haandskrevet .eq(\"is_academy\", false) uden for squads.js", () => {
  const offenders = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of jsFilesIn(join(BACKEND_DIR, dir))) {
      const rel = relative(BACKEND_DIR, file);
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        // Kommentarlinjer maa gerne CITERE filteret (det goer flere headere).
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        SENIOR_FILTER_RE.lastIndex = 0;
        if (SENIOR_FILTER_RE.test(line)) {
          offenders.push(`${rel.split(sep).join("/")}:${i + 1}`);
        }
      });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Senior-trup-filteret skal komme fra squads.applySeniorSquadFilter (#4619, spec §5.1). " +
      `Haandskrevne kopier fundet: ${offenders.join(", ")}`
  );
});

test("guarden ville faktisk fange en ny kopi (regex-selvtest)", () => {
  // En guard der ikke kan fejle er ingen guard. Selvtesten laaser regexen, saa
  // en fremtidig oprydning i den ikke tavst goer guarden blind.
  for (const sample of [
    '.eq("is_academy", false)',
    ".eq('is_academy', false)",
    '.eq( "is_academy" ,  false )',
  ]) {
    SENIOR_FILTER_RE.lastIndex = 0;
    assert.ok(SENIOR_FILTER_RE.test(sample), `skulle matche: ${sample}`);
  }
  for (const sample of [
    '.eq("is_academy", true)',
    "is_academy: false,",
    '.eq("is_retired", false)',
  ]) {
    SENIOR_FILTER_RE.lastIndex = 0;
    assert.ok(!SENIOR_FILTER_RE.test(sample), `skulle IKKE matche: ${sample}`);
  }
});

test("squads.js indeholder faktisk det ene tilladte forekomst", () => {
  // Allowlisten maa ikke blive et tomt loefte: hvis praedikatet flytter, skal
  // denne test tvinge allowlisten til at flytte med.
  const src = readFileSync(join(BACKEND_DIR, "lib", "squads.js"), "utf8");
  SENIOR_FILTER_RE.lastIndex = 0;
  assert.ok(
    SENIOR_FILTER_RE.test(src),
    "squads.js skal baere senior-trup-filteret; flyttes det, skal ALLOWED opdateres"
  );
});

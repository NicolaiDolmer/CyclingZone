// #4482 forward-guard: en mekanik der er skrevet, testet og eksporteret — men
// aldrig KALDT i produktionsstien.
//
// Sådan opstod #4482: `expireSeasonScopedConsequences` havde en definition, en
// docstring der beskrev den som en del af mekanikken, og tre grønne tests. Den
// eneste kalder var dens egen test. Resultatet stod i prod i to sæsoner: 36
// aktive bonustilbud på afsluttede sæsoner, hvert på 200.000 CZ$.
//
// Testdækning beviser at en funktion VIRKER, ikke at den BRUGES. Det er præcis
// samme familie som #4479 (en vagt lovet i prosa, aldrig bygget) og #4463 (et
// grønt flueben der intet målte): noget ser dækket ud uden at være det.
//
// BEVIDST AFGRÆNSET: listen er eksplicit, ikke et scan over alle eksporter. Et
// generelt scan ville flagge helpers, fremtidige API'er og bevidst ubrugt kode,
// og en vagt der råber om ingenting bliver slået fra. Tilføj en linje her når
// du bygger en mekanik hvis hele værdi ligger i at den bliver kaldt.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..");

// [eksporteret navn, filen den bor i, hvorfor den SKAL være wiret]
const MUST_BE_CALLED = [
  [
    "expireSeasonScopedConsequences",
    "lib/boardConsequences.js",
    "#4482 — uden en kalder udløber lag 6-bonustilbud aldrig, og et tilbud fra en "
      + "afsluttet sæson kan stadig indløses til 200.000 CZ$",
  ],
];

const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist", "build"]);

// En OMTALE i en kommentar er ikke wiring — det er præcis den forveksling #4479
// handlede om. Uden dette trin meldte vagten grønt i sin egen mutationstest,
// fordi den fandt sit eget navn i kommentaren der forklarer hvorfor den findes.
// Groft, men tilstrækkeligt: vi leder kun efter et identifier-navn, så en `//`
// eller `/* */` inde i en streng koster højst en falsk NEGATIV på en linje der
// alligevel ikke er et kald.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (!/\.(?:js|mjs)$/.test(entry)) continue;
    if (/\.test\.(?:js|mjs)$/.test(entry)) continue; // en test er ikke en kalder
    out.push(full);
  }
  return out;
}

test("#4482 forward-guard: hver mekanik på listen har mindst én kalder i produktionsstien", () => {
  const files = sourceFiles(BACKEND);
  const uwired = [];

  for (const [name, ownFile, hvorfor] of MUST_BE_CALLED) {
    const ownAbs = join(BACKEND, ownFile);
    // Vi leder efter en REFERENCE, ikke et bogstaveligt `name(`. Koden bruger
    // dependency-injection (`const fn = deps.x ?? x`), så det faktiske kald
    // hedder `expireFn(...)` og ville aldrig matche et navne-kald. En import
    // uden brug ville i øvrigt fælde eslint's no-unused-vars, så en reference
    // i en produktionsfil ER evidens for at mekanikken er wiret ind.
    // `(?<![.\w])` udelukker property-adgang: `deps.expireSeasonScopedConsequences`
    // er navnet på et injektions-punkt, IKKE evidens for at mekanikken er wiret.
    // Uden den negation bed vagten ikke i mutationstesten — den så sit eget
    // deps-opslag og meldte grønt.
    const callRe = new RegExp(`(?<![.\\w])${name}\\b`);
    const callers = files.filter((f) => {
      if (f === ownAbs) return false; // egen fil tæller ikke som at være wiret ind
      const src = stripComments(readFileSync(f, "utf8"));
      return callRe.test(src);
    });
    if (callers.length === 0) {
      uwired.push(`${name} (${ownFile}) — ${hvorfor}`);
    }
  }

  assert.deepEqual(
    uwired,
    [],
    "Disse mekanikker er eksporteret og testet, men INGEN produktionsfil kalder dem. "
      + "En grøn testsuite beviser at koden virker, ikke at den kører. Wire den ind, "
      + "eller slet den og fjern linjen fra listen (#4482).",
  );
});

test("#4482 forward-guard: vagten kan faktisk fælde (selvtest)", () => {
  // Uden denne ville en tastefejl i regexet gøre vagten permanent grøn — samme
  // fejlklasse som den skal beskytte imod.
  const files = sourceFiles(BACKEND);
  const opfundet = "denneFunktionFindesIkkeNogetSted4482";
  const callRe = new RegExp(`\\b${opfundet}\\b`);
  const fundet = files.filter((f) => callRe.test(stripComments(readFileSync(f, "utf8"))));
  assert.deepEqual(fundet, [], "selvtesten forudsætter at navnet er opfundet");

  // Og omvendt: et navn vi VED er wiret, skal findes.
  const kendt = new RegExp("\\brunSeasonStartHooks\\b");
  const kendtFundet = files.filter(
    (f) => relative(BACKEND, f) !== "lib/seasonStartHooks.js" && kendt.test(stripComments(readFileSync(f, "utf8"))),
  );
  assert.ok(kendtFundet.length > 0, "runSeasonStartHooks ER wiret — finder vagten den ikke, er regexet i stykker");
});

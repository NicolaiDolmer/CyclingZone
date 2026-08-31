// #4419 · Forward-guard: de to funktioner der SKRIVER rytterværdier til hele
// populationen må kun have ÉT produktions-kaldested, søndags-jobbet.
//
// Baggrunden er fejlklassen omlægningen selv ramte: værdi-genberegningen havde
// TO kaldesteder (trænings-sweepen kl. 22 og POST /api/training/run-today), og
// et backwards-check der kun greppede efter det ene fandt kun det ene. Den
// tidligere regressionstest i trainingSweep.test.js kunne ikke fange en
// gen-indførelse: den asserterede returværdiens FORM, og et kald pakket i
// try/catch ville ikke ændre formen (adversarisk review 31/8, fund 4).
//
// Derfor statisk analyse på import-linjerne i stedet: et gen-indført kald KAN
// ikke undgå at importere funktionen, uanset hvordan kaldet pakkes ind, og
// analysen ser hele backend/ på én gang i stedet for én fil ad gangen. Samme
// mønster som cron.monitorCoverage.test.js (to uafhængige kilder krydses:
// kildeteksten og den tilladte liste her).
//
// backend/scripts/ er BEVIDST undtaget: CLI-værktøjer (backfills, cutover,
// scorecards) kalder værdi-kæden med vilje og køres i hånden med ejer-go.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Kun søndags-jobbet må importere dem. Nøglen er stien relativt til backend/.
const ALLOWED_IMPORTERS = {
  refreshChangedRiderValues: ["lib/sundayValueSweep.js"],
  runMarketValueSundaySweep: ["lib/sundayValueSweep.js"],
};

const SKIP_DIRS = new Set(["node_modules", "scripts", ".git"]);

function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) collectSourceFiles(full, out);
      continue;
    }
    if (!entry.endsWith(".js") || entry.endsWith(".test.js")) continue;
    out.push(full);
  }
  return out;
}

// Matcher named imports: import { a, refreshChangedRiderValues as x, b } from "...".
// En kommentar der blot NÆVNER navnet (som den i routes/api.js der forklarer at
// kaldet er fjernet) matcher ikke, fordi der kræves en import-sætning omkring.
function importsSymbol(src, symbol) {
  const re = new RegExp(String.raw`import\s*\{[^}]*\b${symbol}\b[^}]*\}\s*from`, "s");
  return re.test(src);
}

test("kun sundayValueSweep.js importerer værdi-skrivende funktioner (#4419)", () => {
  const files = collectSourceFiles(HERE);
  assert.ok(files.length > 100, `forventede at scanne hele backend/, fandt kun ${files.length} filer`);

  for (const [symbol, allowed] of Object.entries(ALLOWED_IMPORTERS)) {
    const found = files
      .filter((f) => importsSymbol(readFileSync(f, "utf8"), symbol))
      .map((f) => relative(HERE, f).split(sep).join("/"))
      .sort();
    assert.deepEqual(
      found,
      [...allowed].sort(),
      `${symbol} har fået et nyt kaldested. Værdier skal flytte sig ÉN gang om ugen ` +
      `(søndag fra kl. 06, ejer-beslutning 30/8) — tilføj ikke et kaldested her uden ejer-go.`
    );
  }
});

test("guarden kan faktisk fejle (negativ prøve)", () => {
  // Uden denne ville en tastefejl i regexen gøre testen ovenfor grøn for altid.
  const reintroduced = 'import { refreshChangedRiderValues } from "../lib/riderValueRefresh.js";';
  assert.equal(importsSymbol(reintroduced, "refreshChangedRiderValues"), true);
  const mentionedInComment = "// Det tidligere refreshChangedRiderValues-kald er fjernet (#4419).";
  assert.equal(importsSymbol(mentionedInComment, "refreshChangedRiderValues"), false);
});

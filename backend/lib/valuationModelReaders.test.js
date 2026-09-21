// #5443 — VAGT: produktionskode må ikke indlæse en værdimodel udenom kontakten.
//
// HVAD DEN BESKYTTER MOD (den fejl der faktisk skete). PR #5446 lagde
// model-valget i app_config og førte søndagskørslen + sæson-transitionen
// igennem det. Tre andre produktions-læsere blev overset, fordi de indlæste
// `riderValuationModelV4.json` direkte ved modul-load:
//
//   backend/routes/api.js            (rytterkort, værdi-trend, scouting, admin)
//   backend/lib/backfillCores.js     (nye ryttere, heal-sweep, base_value-backfill)
//   backend/lib/starterSquadAllocator.js (startruppens cap-gate)
//
// Uskadeligt så længe nøglen står på v4 — og præcis derfor usynligt. Den dag
// ejeren tænder den nye model, ville de tre stier stille regne med den gamle:
// en nyoprettet rytter ville få en pris fra én model mens resten af
// populationen stod på en anden, og rytterkortet ville vise et andet tal end
// databasen. En reviewer fangede det ikke; en test kan.
//
// REGLEN: kun model-select-modulet må nævne en `riderValuationModelV*.json` i
// KODE under backend/lib og backend/routes. Kommentarer er frit — de er
// historik og forklaring, ikke en indlæsning. Test-filer er undtaget: de må
// gerne læse en konkret model for at bevise noget om netop den.
//
// Måleværktøjerne under backend/scripts/ er BEVIDST ikke omfattet. De er
// offline-harnesses og tørkørsler der skal kunne pege på én bestemt model
// uafhængigt af hvad prod står på; at tvinge dem gennem app_config ville gøre
// en måling afhængig af en nøgle den netop skal måle imod.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, "..");

// Den ENE fil der ejer model-valget. Alt andet skal igennem den.
const MODEL_SELECT_MODULE = "riderValuationModelSelect.js";

const SCANNED_DIRS = ["lib", "routes"];
const MODEL_FILE_PATTERN = /riderValuationModelV\d*\.json/;

function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...jsFilesUnder(full)); continue; }
    if (!entry.endsWith(".js") && !entry.endsWith(".mjs")) continue;
    if (entry.endsWith(".test.js") || entry.endsWith(".test.mjs")) continue;
    if (entry === MODEL_SELECT_MODULE) continue;
    out.push(full);
  }
  return out;
}

// Fjern kommentarer, så en forklarende linje om v4 ikke tæller som en
// indlæsning. `//` inde i en URL (`https://…`) er ikke en kommentar-start, så
// et kolon lige før slås fra. Simpelt med vilje: vagten skal kunne læses af
// den der en dag rammer den.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("ingen produktionsfil under backend/lib eller backend/routes indlæser en værdimodel direkte", () => {
  const offenders = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of jsFilesUnder(join(BACKEND, dir))) {
      const code = stripComments(readFileSync(file, "utf8"));
      const hit = code.match(MODEL_FILE_PATTERN);
      if (hit) offenders.push(`${relative(BACKEND, file).split(sep).join("/")} (${hit[0]})`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Disse filer nævner en værdimodel-JSON i kode i stedet for at gå gennem "
    + `${MODEL_SELECT_MODULE}. Brug loadValuationModel(supabase) (skrive-/batch-sti), `
    + "loadValuationModelCached(supabase) (læse-/request-sti) eller "
    + `loadValuationModelById(DEFAULT_VALUATION_MODEL_ID) (ren funktion uden DB):\n  ${offenders.join("\n  ")}`
  );
});

test("vagten har tænder — den ville fange en direkte indlæsning", () => {
  const fake = [
    "// kommentar om riderValuationModelV4.json — må IKKE tælle",
    'const M = JSON.parse(readFileSync(join(__dirname, "./riderValuationModelV4.json"), "utf8"));',
  ].join("\n");
  assert.match(stripComments(fake), MODEL_FILE_PATTERN);

  const commentOnly = [
    "// #2594 cutover: modellen er nu v4 (riderValuationModelV4.json).",
    "/* blok: riderValuationModelV5.json er den nye */",
    "const url = \"https://example.invalid/riderValuationModelV4.json-ish\";".replace("riderValuationModelV4.json-ish", "noget-andet"),
  ].join("\n");
  assert.doesNotMatch(stripComments(commentOnly), MODEL_FILE_PATTERN);
});

test("model-select-modulet er det ene sted der KENDER filerne", () => {
  const code = readFileSync(join(BACKEND, "lib", MODEL_SELECT_MODULE), "utf8");
  assert.match(code, /riderValuationModelV4\.json/);
  assert.match(code, /riderValuationModelV5\.json/);
});

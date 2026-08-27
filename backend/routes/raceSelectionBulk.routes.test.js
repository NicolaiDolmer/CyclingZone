// #1146 — kontrakt-tests for PUT /races/selection/bulk (sæsonmatrixens "Gem plan").
//
// api.js er ikke unit-testbar direkte (kræver live Supabase-client) — samme
// kildetekst-scan-mønster som scoutAssignments.routes.test.js/
// raceStrategyEligibility.routes.test.js. Selve valideringen (validateSelection,
// prepareSelectionChange, saveSelectionBulk) er dækket DB-mock-niveau i
// raceSelection.test.js — denne fil dækker KUN routens wiring: auth/rate-limit,
// cap/tomt-body-afvisning, og at den genbruger single-endpointets delte funktioner
// i stedet for at kopiere/divergere valideringen (#1146-kontraktkravet).
//
// #4310-refutation (FUND 3): den peer-/DB-konflikt-KLASSIFIKATION der rent faktisk
// beviser at en swap er rækkefølge-uafhængig lå TIDLIGERE inline i handleren, og var
// derfor kun dækket her som kildetekst-regex — 0% reel adfærdsdækning. Den er nu
// udtrukket til den rene, direkte kaldbare classifyBulkSelectionConflicts (backend/lib/
// raceSelection.js), og DEN reelle egenskab (2-vejs/3-vejs swap, rækkefølge-
// uafhængighed, peer- vs. DB-konflikt-klassifikation) er bevist med kørende tests i
// raceSelection.test.js. Denne fil beviser nu kun at routen RENT FAKTISK KALDER den
// udtrukne funktion (wiring), ikke længere selve konflikt-logikken.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "api.js"), "utf8");

const MARKER = 'router.put("/races/selection/bulk"';

function handlerBlock() {
  const idx = apiSource.indexOf(MARKER);
  assert.ok(idx !== -1, "PUT /races/selection/bulk skal findes");
  const next = apiSource.indexOf("\nrouter.", idx + 1);
  return apiSource.slice(idx, next === -1 ? idx + 8000 : next);
}

test("PUT /races/selection/bulk er registreret + kræver auth + marketWriteLimiter (#1146)", () => {
  const idx = apiSource.indexOf(MARKER);
  assert.ok(idx !== -1);
  const line = apiSource.slice(idx, apiSource.indexOf("\n", idx));
  assert.match(line, /requireAuth/, "skal kræve auth");
  assert.match(line, /marketWriteLimiter/, "skal rate-limites (ÉN hit pr. bulk-kald, hele kontraktens pointe)");
});

// Auth-afvisning: samme "no team → 400"-vagt som ALLE andre manager-write-routes
// (herunder single-endpointet PUT /:raceId/selection lige før dette).
test("PUT /races/selection/bulk afviser med 400 hvis req.team mangler", () => {
  const block = handlerBlock();
  assert.match(block, /if\s*\(!req\.team\)\s*return res\.status\(400\)/);
});

test("PUT /races/selection/bulk afviser tomt/manglende changes-array med 400 selection_invalid_body", () => {
  const block = handlerBlock();
  assert.match(block, /!Array\.isArray\(changes\)\s*\|\|\s*changes\.length === 0/);
  assert.match(block, /selection_invalid_body/);
});

test("PUT /races/selection/bulk håndhæver cap = 60 changes pr. kald (400 selection_bulk_too_large)", () => {
  // SELECTION_BULK_MAX deklareres lige FØR routen (modul-niveau konstant, ikke inde i
  // selve handler-funktionen) — matches derfor mod hele apiSource, ikke handlerBlock().
  assert.match(apiSource, /const SELECTION_BULK_MAX\s*=\s*60;/);
  const block = handlerBlock();
  assert.match(block, /changes\.length > SELECTION_BULK_MAX/);
  assert.match(block, /selection_bulk_too_large/);
});

test("PUT /races/selection/bulk afviser dublet-raceId i samme kald (400 selection_duplicate_race)", () => {
  const block = handlerBlock();
  assert.match(block, /new Set\(raceIds\)\.size\s*!==\s*raceIds\.length/);
  assert.match(block, /selection_duplicate_race/);
});

// #1146-kontraktkravet: "ingen ny valideringssemantik" — routen skal GENBRUGE single-
// endpointets delte funktion, ikke en kopieret/divergerende valideringsblok.
test("PUT /races/selection/bulk genbruger prepareSelectionChange (samme validering som single-endpointet)", () => {
  const block = handlerBlock();
  assert.match(block, /prepareSelectionChange\(\{/);
});

test("PUT /races/selection/bulk skriver ATOMISK via saveSelectionBulk (replace_race_selection_bulk-RPC'en)", () => {
  const block = handlerBlock();
  assert.match(block, /saveSelectionBulk\(\{/);
});

test("PUT /races/selection/bulk genbruger selectionRoleFor (samme rolle-mapping som saveSelection)", () => {
  const block = handlerBlock();
  assert.match(block, /selectionRoleFor\(/);
});

// Peer-/DB-konflikt-klassifikationen (2-vejs/3-vejs swap, rækkefølge-uafhængighed) er
// udtrukket til classifyBulkSelectionConflicts — den ADFÆRD bevises af de kørende tests
// i raceSelection.test.js, ikke her. Denne test beviser kun WIRING: routen kalder
// rent faktisk den udtrukne funktion, og håndterer begge dens konflikt-typer
// (peer_conflict -> 409 selection_rider_bound; db_conflict -> resolveBindingConflictDetails).
test("PUT /races/selection/bulk kalder classifyBulkSelectionConflicts og håndterer begge konflikt-typer", () => {
  const block = handlerBlock();
  assert.match(block, /classifyBulkSelectionConflicts\(\{/);
  assert.match(block, /result\.kind === "peer_conflict"/);
  assert.match(block, /result\.kind === "db_conflict"/);
  assert.match(block, /selection_rider_bound/);
});

// Alt-eller-intet-kontrakten (#1146): HELE batchen skal valideres FØR noget som helst
// skrives. Kan ikke udøves uden en live server (se raceSelection.test.js for
// saveSelectionBulk's egen ét-RPC-kald-kontrakt) — her låses rækkefølgen i kildeteksten:
// begge valideringspas (prepareSelectionChange + konflikt-klassifikationen) ligger FØR
// saveSelectionBulk-kaldet.
test("PUT /races/selection/bulk validerer ALLE ændringer FØR den skriver noget (saveSelectionBulk kaldes sidst)", () => {
  const block = handlerBlock();
  const prepIdx = block.indexOf("prepareSelectionChange(");
  const classifyIdx = block.indexOf("classifyBulkSelectionConflicts(");
  const saveIdx = block.indexOf("saveSelectionBulk(");
  assert.ok(prepIdx !== -1 && classifyIdx !== -1 && saveIdx !== -1, "alle tre markører skal findes i routen");
  assert.ok(prepIdx < saveIdx, "prepareSelectionChange skal kaldes FØR saveSelectionBulk");
  assert.ok(classifyIdx < saveIdx, "konflikt-klassifikationen skal ligge FØR saveSelectionBulk");
});

test("PUT /races/selection/bulk er registreret FØR /races/:raceId/selection/auto (ingen param-kollision)", () => {
  const bulkIdx = apiSource.indexOf(MARKER);
  const autoIdx = apiSource.indexOf('router.post("/races/:raceId/selection/auto"');
  assert.ok(bulkIdx !== -1 && autoIdx !== -1);
});

test("raceSelection.js eksporterer prepareSelectionChange + saveSelectionBulk + classifyBulkSelectionConflicts + roleFor", () => {
  assert.match(
    apiSource,
    /import\s*\{[^}]*\bprepareSelectionChange\b[^}]*\bsaveSelectionBulk\b[^}]*\bclassifyBulkSelectionConflicts\b[^}]*\}\s*from\s*"\.\.\/lib\/raceSelection\.js"/s,
  );
});

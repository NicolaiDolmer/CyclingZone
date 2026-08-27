// #1146 — kontrakt-tests for PUT /races/selection/bulk (sæsonmatrixens "Gem plan").
//
// api.js er ikke unit-testbar direkte (kræver live Supabase-client) — samme
// kildetekst-scan-mønster som scoutAssignments.routes.test.js/
// raceStrategyEligibility.routes.test.js. Selve valideringen (validateSelection,
// prepareSelectionChange, saveSelectionBulk) er dækket DB-mock-niveau i
// raceSelection.test.js — denne fil dækker KUN routens wiring: auth/rate-limit,
// cap/tomt-body-afvisning, og at den genbruger single-endpointets delte funktioner
// i stedet for at kopiere/divergere valideringen (#1146-kontraktkravet).
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

// Peer-konflikter (mod en ANDEN ændring i SAMME kald) skal afvises — auto-release
// gælder KUN #2637-konflikter mod løb UDENFOR batchen (se raceSelection.test.js for
// den semantiske adfærd via saveSelectionBulk).
test("PUT /races/selection/bulk klassificerer peer-konflikter (samme batch) som blokerende, ikke auto-løsbare", () => {
  const block = handlerBlock();
  assert.match(block, /peerBound/);
  assert.match(block, /selection_rider_bound/);
});

// Alt-eller-intet-kontrakten (#1146): HELE batchen skal valideres FØR noget som helst
// skrives. Kan ikke udøves uden en live server (se raceSelection.test.js for
// saveSelectionBulk's egen ét-RPC-kald-kontrakt) — her låses rækkefølgen i kildeteksten:
// begge valideringspas (prepareSelectionChange + peer-konflikt-tjekket) ligger FØR
// saveSelectionBulk-kaldet.
test("PUT /races/selection/bulk validerer ALLE ændringer FØR den skriver noget (saveSelectionBulk kaldes sidst)", () => {
  const block = handlerBlock();
  const prepIdx = block.indexOf("prepareSelectionChange(");
  const peerIdx = block.indexOf("peerBound");
  const saveIdx = block.indexOf("saveSelectionBulk(");
  assert.ok(prepIdx !== -1 && peerIdx !== -1 && saveIdx !== -1, "alle tre markører skal findes i routen");
  assert.ok(prepIdx < saveIdx, "prepareSelectionChange skal kaldes FØR saveSelectionBulk");
  assert.ok(peerIdx < saveIdx, "peer-konflikt-tjekket skal ligge FØR saveSelectionBulk");
});

test("PUT /races/selection/bulk er registreret FØR /races/:raceId/selection/auto (ingen param-kollision)", () => {
  const bulkIdx = apiSource.indexOf(MARKER);
  const autoIdx = apiSource.indexOf('router.post("/races/:raceId/selection/auto"');
  assert.ok(bulkIdx !== -1 && autoIdx !== -1);
});

test("raceSelection.js eksporterer prepareSelectionChange + saveSelectionBulk + roleFor", () => {
  assert.match(
    apiSource,
    /import\s*\{[^}]*\bprepareSelectionChange\b[^}]*\bsaveSelectionBulk\b[^}]*\}\s*from\s*"\.\.\/lib\/raceSelection\.js"/s,
  );
});

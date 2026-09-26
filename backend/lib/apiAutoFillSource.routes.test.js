// #5246 rettelse 23/9 (c): managerens egne auto-knapper maa ikke ende som
// assistentens late_fill i maalingen. De to endpoints skriver derfor kilden
// manager_auto eksplicit, og (a) skriver gennem den tolerante helper, saa et
// klik i vinduet mellem backend-deploy og migrationen ikke efterlader et tomt
// loeb (begge endpoints sletter holdets raekker FOER insert'en).
//
// Route-wiring daekkes via kilde-scanning (samme moenster som
// apiSelectionWithdrawalGate.routes.test.js) - der er ingen supertest-harness i
// denne kodebase til at eksekvere Express-handlere mod en mocket supabase-klient.
// Selve helperens adfaerd er testet i raceEntryAutoFillSource.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

// Handlerens krop: fra router-markoeren til den naeste router.-registrering.
function routeBody(marker) {
  const start = apiSource.indexOf(marker);
  assert.ok(start !== -1, `${marker} skal findes i api.js`);
  const next = apiSource.indexOf("\nrouter.", start + marker.length);
  return apiSource.slice(start, next === -1 ? undefined : next);
}

// #5789: regenerate-skrivningen er flyttet til lib/raceHubAutofill.js
// (writeRegeneratedLineups); kilde-kravene scannes dér i stedet for i route-kroppen.
const hubAutofillSource = readFileSync(resolve(__dirname, "raceHubAutofill.js"), "utf8");
const ROUTES = [
  { marker: 'router.post("/races/:raceId/selection/auto"', writer: (body) => body },
  { marker: 'router.post("/races/distribution/regenerate"', writer: () => hubAutofillSource },
];

for (const { marker, writer } of ROUTES) {
  test(`${marker}: raekkerne faar kilden manager_auto (ikke late_fill som standard)`, () => {
    const body = writer(routeBody(marker));
    assert.match(body, /auto_filled_source:\s*AUTO_FILL_SOURCES\.MANAGER_AUTO/);
    assert.doesNotMatch(body, /auto_filled_source:\s*["']late_fill["']/);
  });

  test(`${marker}: race_entries skrives via writeRaceEntriesWithSource (deploy-vinduet), ikke en raa insert`, () => {
    const body = writer(routeBody(marker));
    assert.match(body, /writeRaceEntriesWithSource\(\{\s*supabase,\s*rows\s*\}\)/);
    assert.doesNotMatch(body, /from\("race_entries"\)\.insert\(/);
    assert.doesNotMatch(routeBody(marker), /from\("race_entries"\)\.insert\(/);
  });
}

test("regenerate-routen skriver via writeRegeneratedLineups (#5789)", () => {
  assert.match(routeBody('router.post("/races/distribution/regenerate"'), /await writeRegeneratedLineups\(\{/);
});

test("api.js importerer kilderne og helperen fra raceEntryAutoFillSource.js", () => {
  assert.match(
    apiSource,
    /import \{ AUTO_FILL_SOURCES, writeRaceEntriesWithSource \} from "\.\.\/lib\/raceEntryAutoFillSource\.js";/,
  );
});

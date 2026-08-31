// #4306 - "man kan gemme en udtagelse til et løb man har afmeldt sig fra". PUT
// /races/:raceId/selection manglede den samme race_withdrawals-gate som auto-
// endpointet (POST /races/:raceId/selection/auto) allerede havde (409
// selection_withdrawn). Uden gaten kunne en manager afmelde, redigere kladden,
// og "Gem" ind i et løb holdet netop har trukket sig fra.
//
// Route-wiring dækkes via kilde-scanning (samme mønster som
// apiTrainingMeRaceDay.routes.test.js/silentFailureContract-testene) - der er
// ingen supertest-harness i denne kodebase til at eksekvere Express-handlere
// direkte mod en mocket supabase-klient.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker, len = 12000) {
  const start = apiSource.indexOf(marker);
  assert.ok(start !== -1, `${marker} skal findes i api.js`);
  return apiSource.slice(start, start + len);
}

test("PUT /races/:raceId/selection har samme race_withdrawals-gate som POST .../selection/auto (#4306)", () => {
  const putBlock = routeBlock('router.put("/races/:raceId/selection"');
  const autoBlock = routeBlock('router.post("/races/:raceId/selection/auto"');

  // Auto-endpointets eksisterende gate - kontrol for at markøren rammer rigtigt.
  assert.match(
    autoBlock,
    /if \(withdrawal\) return res\.status\(409\)\.json\(\{ error: "selection_withdrawn" \}\);/,
  );

  // PUT /selection skal have den SAMME gate: opslag på race_withdrawals for
  // (race.id, req.team.id), og en 409 selection_withdrawn hvis rækken findes.
  assert.match(
    putBlock,
    /\.from\("race_withdrawals"\)\.select\("race_id"\)\s*\n\s*\.eq\("race_id", race\.id\)\.eq\("team_id", req\.team\.id\)\.maybeSingle\(\)/,
    "PUT /selection skal slå op i race_withdrawals for netop dette løb+hold",
  );
  assert.match(
    putBlock,
    /if \(withdrawal\) return res\.status\(409\)\.json\(\{ error: "selection_withdrawn" \}\);/,
    "PUT /selection skal svare 409 selection_withdrawn for et afmeldt hold",
  );
});

test("PUT /races/:raceId/selection: withdrawal-gaten ligger FØR saveSelection (afviser inden noget skrives)", () => {
  const putBlock = routeBlock('router.put("/races/:raceId/selection"');
  const gateIdx = putBlock.indexOf('res.status(409).json({ error: "selection_withdrawn" })');
  const saveIdx = putBlock.indexOf("await saveSelection(");
  assert.ok(gateIdx !== -1 && saveIdx !== -1, "begge markører skal findes i PUT-blokken");
  assert.ok(gateIdx < saveIdx, "withdrawal-gaten skal afvise FØR saveSelection kaldes");
});

// #1146 aendrede denne test: pulje-gaten (selection_wrong_pool) er flyttet ud af
// handleren til den DELTE prepareSelectionChange (backend/lib/raceSelection.js), som
// baade single- og bulk-endpointet kalder. Den oprindelige raekkefoelge-assertion
// (pool FOER withdrawn, spejlet fra auto-endpointet) kan derfor ikke laengere maales i
// handler-blokken — og den var reelt uobserverbar: et hold kan kun afmelde loeb i sin
// egen pulje, saa selection_wrong_pool og selection_withdrawn kan aldrig vaere sande
// samtidig. Det #4306 faktisk kraever bevares og testes her: gaten findes, den afviser
// FOER der valideres/skrives, og pulje-gaten bestaar i den delte funktion.
test("PUT /races/:raceId/selection: withdrawal-gaten ligger FØR den delte validering, og pulje-gaten består i prepareSelectionChange", () => {
  const putBlock = routeBlock('router.put("/races/:raceId/selection"');
  const withdrawnIdx = putBlock.indexOf('res.status(409).json({ error: "selection_withdrawn" })');
  const preparedIdx = putBlock.indexOf("await prepareSelectionChange(");
  assert.ok(withdrawnIdx !== -1 && preparedIdx !== -1, "begge markører skal findes i PUT-blokken");
  assert.ok(withdrawnIdx < preparedIdx, "withdrawal-gaten skal afvise FØR den delte validering kaldes");

  const selectionSource = readFileSync(resolve(__dirname, "raceSelection.js"), "utf8");
  assert.match(selectionSource, /selection_wrong_pool/, "pulje-gaten skal bestå i den delte prepareSelectionChange");
});

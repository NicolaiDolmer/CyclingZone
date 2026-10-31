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

test("#7153: only manager saves can rejoin, auto retains its withdrawal gate", () => {
 const put=routeBlock('router.put("/races/:raceId/selection"');
 const bulk=routeBlock('router.put("/races/selection/bulk"',16000);
 const auto=routeBlock('router.post("/races/:raceId/selection/auto"');
 assert.match(auto,/if \(withdrawal\) return res\.status\(409\)\.json\(\{ error: "selection_withdrawn" \}\);/);
 for(const block of [put,bulk]) {
  assert.match(block,/withdrawn_reason/);
  assert.match(block,/DID_NOT_START_REASON/);
  assert.match(block,/selection_withdrawn_locked/);
  assert.match(block,/findRejoinConflicts/);
  assert.match(block,/managerSave: true/);
 }
});

// #6959 (Codex P1): starter loebet mens auto-frigivelserne koerer, afvises gemningen ved
// den sidste laase-kontrol. De frigivne auto-entries skal da laegges tilbage, ellers efterlader
// en afvist gemning et hul i kildeloebene.
test("#7153 single save releases only inside the replacement transaction",()=>{
 const block=routeBlock('router.put("/races/:raceId/selection"');
 assert.ok(block.indexOf('const finalLocked = await loadLockedRaceIds(')<block.indexOf('await saveSelection('));
 assert.match(block,/autoReleases: releasable\.map/);
 assert.doesNotMatch(block,/from\("race_entries"\)\.delete\(/);
});

// #6959 (Codex P1): "Ryd" skal laese laasen frisk (status, stages_completed, etape 1's start)
// lige foer sletningen, ikke fra requestens tidlige races-snapshot.
test("POST /races/distribution/clear laeser laasen frisk foer sletningen (#6959)", () => {
  const block = routeBlock('router.post("/races/distribution/clear"');
  const lockIdx = block.indexOf("await loadLockedRaceIds({ supabase, raceIds: cols.map((r) => r.id), now: new Date() })");
  const delIdx = block.indexOf('.from("race_entries")');
  assert.ok(lockIdx !== -1, "clear skal bruge loadLockedRaceIds");
  assert.ok(lockIdx < delIdx, "laasen laeses foer sletningen");
  assert.ok(!block.slice(0, delIdx).includes("withLineupLocked("), "intet foraeldet snapshot til laasen");
});

// #6959 (Codex P1, runde 2): kildeloebene for frigivelserne er med i den sidste laase-kontrol.
test("PUT /races/:raceId/selection: sidste laase-kontrol omfatter frigivelsernes kildeloeb (#6959)", () => {
  const putBlock = routeBlock('router.put("/races/:raceId/selection"');
  assert.match(putBlock, /loadLockedRaceIds\(\{ supabase, raceIds: \[race\.id, \.\.\.releasedRaceIds\], now: new Date\(\) \}\)/);
  assert.match(putBlock, /if \(finalLocked\.has\(race\.id\) \|\| sourceLocked\.length\)/);
});

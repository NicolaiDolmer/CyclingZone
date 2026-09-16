// #5301 — "jeg meldte fra, men spillet viser stadig mit hold" (Discord 16/9,
// egomadsen, Tour du Hedjaz).
//
// race_entries BEVARES bevidst ved afmelding (#4306), saa gen-deltag kan gendanne
// opstillingen. Motoren har altid respekteret afmeldingen (raceRunner.js filtrerer
// afmeldte hold FOER autopick og FOER 6-mands-gulvet), men FIRE laeseflader udledte
// "deltager" af race_entries ALENE:
//
//   1. GET /races/distribution/browse   — divisionens startlister (ANDRE managers saa
//                                          et fantom-hold og lagde taktik efter det)
//   2. GET /races/selection/season      — saesonmatrixen laaste ryttere ude af loeb
//                                          Race Hub-tavlen samtidig tillod dem i
//   3. GET /races/:raceId/selection     — panelet viste en redigerbar opstilling, men
//                                          PUT svarer 409 selection_withdrawn
//   4. Dashboard-nudgen                 — arver #3 via isSquadSelectionMissing
//
// Plus en femte, latent: DELETE .../withdrawal kunne dobbeltbooke, fordi
// trg_race_withdrawals_resync_binding genberegner binding_span paa de bevarede
// entries og saa rammer exclusion-constrainten med en raa Postgres-fejl.
//
// Route-wiring daekkes via kilde-scanning (samme moenster som
// apiSelectionWithdrawalGate.routes.test.js) — der er ingen supertest-harness i denne
// kodebase til at eksekvere Express-handlere mod en mocket supabase-klient.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker, len = 14000) {
  const start = apiSource.indexOf(marker);
  assert.ok(start !== -1, `${marker} skal findes i api.js`);
  return apiSource.slice(start, start + len);
}

test("#5301/1: divisions-startlisterne filtrerer afmeldte hold ud af race_entries", () => {
  const block = routeBlock('router.get("/races/distribution/browse"');
  assert.match(
    block, /loadWithdrawnPairs\(\{ supabase, raceIds: visibleIds \}\)/,
    "browse skal hente afmeldingerne for PRAECIS de loeb den viser startlister for"
  );
  assert.match(
    block, /\.filter\(\s*\(e\) => !withdrawnPairs\.has\(withdrawalKey\(e\.race_id, e\.team_id\)\)\s*\)/,
    "entry-raekker fra et afmeldt hold maa ikke naa groupGrossSquads"
  );

  // Filtret skal ligge FOER rytter-/holdopslagene — ellers slaar vi navne op paa
  // ryttere vi alligevel kasserer, og et loeb hvor alle har trukket sig koster to
  // tomme kald.
  const filterIdx = block.indexOf("withdrawnPairs.has");
  const ridersIdx = block.indexOf('supabase.from("riders")');
  assert.ok(filterIdx !== -1 && ridersIdx !== -1, "begge markoerer skal findes");
  assert.ok(filterIdx < ridersIdx, "afmeldings-filtret skal koere FOER rytteropslaget");
});

test("#5301/2: saeson-matrixens endpoint returnerer holdets afmeldte loeb", () => {
  const block = routeBlock('router.get("/races/selection/season"');
  assert.match(
    block, /loadWithdrawnRaceIdsForTeam\(\{\s*\n?\s*supabase, teamId: req\.team\.id, raceIds: ownRaceIds,\s*\n?\s*\}\)/,
    "matrixen skal kende holdets egne afmeldinger, scopet til egne loeb"
  );
  assert.match(
    block, /withdrawnRaceIds: \[\.\.\.withdrawnRaceIds\]/,
    "feltet skal med i svaret — matrixen kan ikke udlede det af entries (#4306 bevarer dem)"
  );

  // Tom-saeson-grenen returnerer tidligt; den skal have samme felt, ellers er
  // kontrakten betinget af data og klienten maa gaette.
  assert.match(
    block, /season: null, ownPoolId, readOnly: false, races: \[\], riders: \[\], entries: \[\], withdrawnRaceIds: \[\]/,
    "ogsaa den tidlige tom-saeson-gren skal bære feltet"
  );
});

test("#5301/3: loebssidens selection-endpoint fortaeller om holdet har trukket sig", () => {
  const block = routeBlock('router.get("/races/:raceId/selection"');
  assert.match(
    block, /\.from\("race_withdrawals"\)\.select\("race_id"\)\s*\n\s*\.eq\("race_id", race\.id\)\.eq\("team_id", req\.team\.id\)\.maybeSingle\(\)/,
    "GET skal slaa op i race_withdrawals for netop dette loeb+hold"
  );
  assert.match(block, /const withdrawn = Boolean\(withdrawalRow\);/);
  assert.match(
    block, /res\.json\(\{ enabled: true, eligible, withdrawn, race,/,
    "flaget skal med i svaret — Dashboard-nudgen og panelet laeser begge denne payload"
  );

  // Samme opslag som PUT's gate (#4306), saa visning og gem ikke kan drive fra
  // hinanden — #3410's postmortem: to separate udledninger af samme tilstand
  // ender altid med at sige to forskellige ting.
  const putBlock = routeBlock('router.put("/races/:raceId/selection"');
  assert.match(putBlock, /\.from\("race_withdrawals"\)\.select\("race_id"\)/);
});

test("#5301/5: gen-deltag afviser i stedet for at dobbeltbooke", () => {
  const block = routeBlock('router.delete("/races/:raceId/withdrawal"');

  // season_id + id SKAL med i race-opslaget: loadTeamBindingContext kraever begge
  // (saeson-filteret i #3070 er ikke valgfrit).
  assert.match(
    block, /\.select\("id, status, stages_completed, season_id"\)/,
    "DELETE skal hente id + season_id, ellers kan binding-konteksten ikke bygges"
  );
  assert.match(
    block, /loadTeamBindingContext\(\{ supabase, race, teamId: req\.team\.id \}\)/,
    "gen-deltag skal bruge SAMME binding-maskineri som PUT /selection's gate"
  );
  assert.match(block, /mapRiderBindingDetails\(\{/);
  assert.match(
    block, /res\.status\(409\)\.json\(\{\s*\n\s*error: "rejoin_rider_bound",/,
    "en konflikt skal give en forklarende 409, ikke en raa DB-fejl"
  );
  assert.match(
    block, /bound_race_name: raceNameById\.get\(raceId\) \?\? null,/,
    "409'en skal NAVNGIVE det bindende loeb — et antal er lige saa ubrugeligt som DB-fejlen"
  );
  assert.match(block, /rider_name:/, "409'en skal navngive rytteren");

  // Guarden skal ligge FOER sletningen: efter er for sent, saa har trigger'en
  // allerede genberegnet binding_span og constrainten allerede fejlet.
  const guardIdx = block.indexOf('error: "rejoin_rider_bound"');
  const deleteIdx = block.indexOf('.from("race_withdrawals").delete()');
  assert.ok(guardIdx !== -1 && deleteIdx !== -1, "begge markoerer skal findes");
  assert.ok(guardIdx < deleteIdx, "konflikt-guarden skal afvise FOER afmeldingen slettes");
});

test("#5301: afmeldings-opslagene deles fra raceWithdrawal.js (ingen femte kopi)", () => {
  assert.match(
    apiSource,
    /import \{ loadWithdrawnPairs, loadWithdrawnRaceIdsForTeam, withdrawalKey \} from "\.\.\/lib\/raceWithdrawal\.js";/,
    "hver flade der ruller sit eget race_withdrawals-opslag er en ny chance for at glemme det — det var rod-aarsagen i #5301"
  );
});

// #5843 — managers kunne hverken se eller ændre udtagelsen til U23-/juniorløb.
//
// Rodårsag i ruterne: GET/PUT /races/:raceId/selection, auto-udtagelsen, bulk og
// afmeldingen hentede løbet UDEN races.squad og sammenlignede løbets pulje med
// holdets SENIORpulje. Et ungdomsløb ligger i en ungdomspulje, så holdet var
// aldrig "i puljen": panelet viste "ikke dit løb", og gem svarede 409
// selection_wrong_pool, også for AI'ens auto-udtagelse.
//
// Logikken (teamInRaceSquadPool, getSelectionContext's trup-filter) er eksekveret i
// raceBinding.test.js og raceSelection-testene. Her bindes kun wiringen, samme
// kilde-scan-mønster som apiWithdrawalVisibility.routes.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { teamInRaceSquadPool } from "./raceBinding.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker, len = 6000) {
  const start = apiSource.indexOf(marker);
  assert.ok(start !== -1, `${marker} skal findes i api.js`);
  return apiSource.slice(start, start + len);
}

const RACE_SELECT_WITH_SQUAD = /\.from\("races"\)[\s\S]{0,600}?\.select\("[^"]*\bsquad\b[^"]*"\)/;

test("#5843: GET selection henter races.squad og matcher truppens pulje", () => {
  const block = routeBlock('router.get("/races/:raceId/selection"');
  assert.match(block, RACE_SELECT_WITH_SQUAD, "uden squad er ethvert løb et seniorløb");
  assert.match(block, /const eligible = teamInRaceSquadPool\(\{ team: req\.team, race \}\);/);
});

test("#5843: PUT selection sender holdet med til prepareSelectionChange", () => {
  const block = routeBlock('router.put("/races/:raceId/selection"');
  assert.match(block, RACE_SELECT_WITH_SQUAD);
  assert.match(block, /prepareSelectionChange\(\{\s*\n?\s*supabase, race, teamId: req\.team\.id, teamDivisionId: req\.team\.league_division_id, team: req\.team,/);
});

test("#5843: bulk-gem sender holdet med til prepareSelectionChange", () => {
  const block = routeBlock('router.put("/races/selection/bulk"', 9000);
  assert.match(block, RACE_SELECT_WITH_SQUAD);
  assert.match(block, /teamDivisionId: req\.team\.league_division_id, team: req\.team, body: change/);
});

test("#5843: auto-udtagelse bruger truppens pulje og truppens ryttere", () => {
  const block = routeBlock('router.post("/races/:raceId/selection/auto"');
  assert.match(block, RACE_SELECT_WITH_SQUAD);
  assert.match(block, /teamInRaceSquadPool\(\{ team: req\.team, race \}\)/);
  assert.match(block, /applyRiderEligibilityFilter\([^\n]*\{ squad: raceSquadOf\(race\) \}\)/);
});

test("#5843: afmelding bruger truppens pulje", () => {
  const block = routeBlock('router.post("/races/:raceId/withdrawal"');
  assert.match(block, RACE_SELECT_WITH_SQUAD);
  assert.match(block, /teamInRaceSquadPool\(\{ team: req\.team, race \}\)/);
});

test("#5843: et hold i U23-pulje 901 er i feltet for et U23-løb i 901, ikke i et seniorløb i 901", () => {
  const team = { league_division_id: 3, u23_league_division_id: 901, junior_league_division_id: 911 };
  assert.equal(teamInRaceSquadPool({ team, race: { squad: "u23", league_division_id: 901 } }), true);
  assert.equal(teamInRaceSquadPool({ team, race: { squad: "junior", league_division_id: 911 } }), true);
  assert.equal(teamInRaceSquadPool({ team, race: { squad: "junior", league_division_id: 901 } }), false);
  // Uden squad (den gamle select) blev et U23-løb vurderet som seniorløb og afvist.
  assert.equal(teamInRaceSquadPool({ team, race: { league_division_id: 901 } }), false);
});

// #1146 sæsonmatrix — B4: routes forward-guard/contract-tests for
// GET /api/races/selection/season. api.js er ikke unit-testbar direkte (kræver
// live Supabase-client) — dette mønster (kildetekst-scan) spejler
// scoutAssignments.routes.test.js + raceSelectionBulk.routes.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "./api.js"), "utf8");

function routeBlock(needle, len = 4000) {
  const idx = apiSource.indexOf(needle);
  assert.ok(idx !== -1, `${needle} skal findes`);
  return apiSource.slice(idx, idx + len);
}

test("GET /api/races/selection/season er registreret + kræver auth + team", () => {
  const block = routeBlock('router.get("/races/selection/season"', 800);
  assert.match(block, /requireAuth/, "skal kræve auth");
  assert.match(block, /No team found/, "skal kræve et hold");
});

test("gates på isRaceEngineV2Enabled og svarer enabled:false når slukket", () => {
  const block = routeBlock('router.get("/races/selection/season"', 1200);
  assert.match(block, /isRaceEngineV2Enabled\(/, "skal respektere kill-switchen");
  assert.match(block, /enabled:\s*false/, "skal svare enabled:false når flaget er off");
});

// HARD INVARIANT (#1146 kontrakt-punkt 2): display-tal kommer KUN fra
// raceGameDaySpan (game_day/game_day_end-semantikken). bindingWindow/
// raceBindingWindow må ALDRIG bruges til at udlede løbsdags-tal i dette svar —
// den falder tilbage til CET-ordinaler (~20000) hvis game_day mangler.
test("bruger raceGameDaySpan til løbsdags-spænd, ALDRIG raceBindingWindow, i selection/season", () => {
  const block = routeBlock('router.get("/races/selection/season"', 6000);
  assert.match(block, /raceGameDaySpan\(rows\)/, "display skal komme fra raceGameDaySpan");
  assert.doesNotMatch(block, /raceBindingWindow/, "raceBindingWindow må ikke bruges til display her");
});

test("et løb uden gyldig game_day-spænd springes over (span==null → continue)", () => {
  const block = routeBlock('router.get("/races/selection/season"', 6000);
  assert.match(block, /if \(!span\) continue;/);
});

test("kun egen-pulje-løb (ownPoolId) indgår i races-listen", () => {
  const block = routeBlock('router.get("/races/selection/season"', 6000);
  assert.match(block, /league_division_id === ownPoolId/);
});

test("restGameDays regnes som huller i spændet (GT-hviledage, #3470/#4217)", () => {
  const block = routeBlock('router.get("/races/selection/season"', 6000);
  assert.match(block, /restGameDays/);
  assert.match(block, /!scheduledDays\.has\(gd\)/);
});

test("trupstørrelse pr. løb kommer fra selectionSizeForRace (samme klasser som autopick)", () => {
  const block = routeBlock('router.get("/races/selection/season"', 6000);
  assert.match(block, /selectionSizeForRace\(race\)/);
  assert.match(block, /sizeMin/);
  assert.match(block, /sizeMax/);
});

test("rute-match-demand kommer fra aggregateDemandVector (delt med peak-plans/board)", () => {
  const block = routeBlock('router.get("/races/selection/season"', 8000);
  assert.match(block, /aggregateDemandVector\(profByRace\.get\(race\.id\) \|\| \[\]\)/);
});

test("entries returnerer rider_id + race_role pr. løb (fetchTeamRaceEntriesWithRider)", () => {
  const block = routeBlock('router.get("/races/selection/season"', 8000);
  assert.match(block, /fetchTeamRaceEntriesWithRider\(supabase, req\.team\.id, ownRaceIds\)/);
});

test("dayDates dækker ALLE puljers schedule (buildGameDayDateMap på allRaceIds, ikke kun egen pulje)", () => {
  const block = routeBlock('router.get("/races/selection/season"', 3000);
  assert.match(block, /fetchAllScheduleRowsWithGameDay\(supabase, allRaceIds\)/);
  assert.match(block, /buildGameDayDateMap\(scheduleRows\)/);
});

test("?season_number= giver read-only browsing af en ikke-aktiv sæson (samme mønster som kalenderen #4102)", () => {
  const block = routeBlock('router.get("/races/selection/season"', 2200);
  assert.match(block, /season_number/);
  assert.match(block, /readOnly/);
});

test("fetchTeamRaceEntriesWithRider filtrerer på team_id og chunker via selectInChunks (#1307-mønster)", () => {
  const idx = apiSource.indexOf("async function fetchTeamRaceEntriesWithRider");
  assert.ok(idx !== -1, "helperen skal findes");
  const block = apiSource.slice(idx, idx + 700);
  assert.match(block, /selectInChunks\(/);
  assert.match(block, /q\.eq\("team_id", teamId\)/);
});

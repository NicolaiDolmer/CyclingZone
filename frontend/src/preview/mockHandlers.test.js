import test from "node:test";
import assert from "node:assert/strict";
import { restRows, restObject, apiResponse, parseRpc, rpcResponse } from "./mockHandlers.js";
import { TEST_TEAM, RIVAL_TEAM } from "./seedData.js";
import { normalizeHonours, topOf } from "../lib/seasonHonours.js";

test("races-tabel returnerer seed-løb", () => {
  const rows = restRows("races", "https://x/rest/v1/races?select=*");
  assert.ok(rows.length >= 3, "forventede seed-løb");
});

test("races id=eq filtrerer til ét løb", () => {
  const rows = restRows("races", "https://x/rest/v1/races?id=eq.race-up-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "race-up-1");
});

test("races .single() (restObject) returnerer ét seed-løb", () => {
  const row = restObject("races", "https://x/rest/v1/races?id=eq.race-up-1");
  assert.equal(row.id, "race-up-1");
  assert.equal(row.name, "Tour de Preview");
});

test("race_stage_profiles race_id=eq filtrerer til løbets etaper", () => {
  const rows = restRows("race_stage_profiles", "https://x/rest/v1/race_stage_profiles?race_id=eq.race-up-1");
  assert.ok(rows.length >= 1, "forventede stage-profiler for race-up-1");
  assert.ok(rows.every(p => p.race_id === "race-up-1"));
});

test("race_results returnerer seed for den race-scopede query", () => {
  const rows = restRows("race_results", "https://x/rest/v1/race_results?race_id=eq.race-done-1");
  assert.ok(rows.length >= 1, "forventede resultater for race-done-1");
  assert.ok(rows.every(r => r.race_id === "race-done-1"));
});

test("race_results uden race_id-filter → tom (uændret dashboard-adfærd)", () => {
  const rows = restRows("race_results", "https://x/rest/v1/race_results?select=*");
  assert.equal(rows.length, 0);
});

// #1997 S1 — Palmarès-fanens rytter-scopede query (RiderStatsPage.fetchAllRiderSeasonRows).
test("race_results rider_id=eq.rider-1 → palmarès-seed med race:-embed + team_name", () => {
  const rows = restRows("race_results", "https://x/rest/v1/race_results?rider_id=eq.rider-1&select=rank,team_name");
  assert.ok(rows.length >= 1, "forventede palmarès-resultater for rider-1");
  assert.ok(rows.every(r => r.race && r.race.id), "hver række har et race:-embed (ikke rider:-embed)");
  assert.ok(rows.every(r => typeof r.team_name === "string" && r.team_name.length > 0), "hver række har et holdnavn (#1993-snapshot)");
  assert.ok(rows.some(r => r.result_type === "gc" && r.rank === 1), "mindst én GC-/endagssejr");
});

test("race_results rider_id=eq.<ukendt> → tom (kun rider-1 har palmarès-seed)", () => {
  const rows = restRows("race_results", "https://x/rest/v1/race_results?rider_id=eq.rider-2");
  assert.equal(rows.length, 0);
});

test("/api/races/distribution returnerer board-payload", () => {
  const r = apiResponse("/api/races/distribution");
  assert.ok(r && r.enabled === true);
  assert.ok(Array.isArray(r.columns) && r.columns.length >= 1);
});

test("/api/races/strategy returnerer strategi-payload", () => {
  const r = apiResponse("/api/races/strategy");
  assert.ok(r && typeof r === "object");
  assert.equal(r.enabled, true);
  assert.ok(Array.isArray(r.roster));
});

// S6 (#1835): browse-routen er mere specifik end /distribution → må ikke fanges af den.
test("/api/races/distribution/browse returnerer read-only browse-payload (ikke board)", () => {
  const r = apiResponse("/api/races/distribution/browse");
  assert.ok(r && r.enabled === true);
  assert.ok(Array.isArray(r.pools) && r.pools.length >= 1, "pulje-vælger har puljer");
  assert.ok(r.pool && r.horizonDays === 7);
  assert.ok(Array.isArray(r.columns) && r.columns.length >= 1);
  // Bruttotrup: ryttere bærer KUN navn + nationalitet, ingen roller/form/træthed.
  const withTeams = r.columns.find((c) => c.visible && c.teams.length);
  assert.ok(withTeams, "mindst ét synligt løb med hold");
  const rider = withTeams.teams[0].riders[0];
  assert.deepEqual(Object.keys(rider).sort(), ["firstname", "id", "lastname", "nationality_code"]);
  // Mindst ét låst løb (uden for 7-dages-vinduet) uden hold-data.
  assert.ok(r.columns.some((c) => c.visible === false && c.teams.length === 0));
});

// #2917: managerprofilen havde ingen mock-handler — siden kunne ikke klik-testes
// på preview før noget gik live.
test("/api/managers/:id returnerer managerprofilens fulde kontrakt", () => {
  const r = apiResponse(`/api/managers/${TEST_TEAM.id}`);
  assert.deepEqual(
    Object.keys(r).sort(),
    ["achievements", "riders", "season_history", "team", "transfer_activity", "user"]
  );
  assert.equal(r.team.id, TEST_TEAM.id);
  assert.equal(typeof r.team.division, "number");
  assert.ok(r.user.username, "manager-navn skal være sat");
  assert.ok(r.riders.length >= 1, "profilen skal have ryttere");
  assert.ok(r.season_history.length >= 1, "profilen skal have sæsonhistorik");
  // #2917: kolonnen læser rank_in_division (final_rank fandtes ikke).
  assert.ok(r.season_history.every((s) => Number.isInteger(s.rank_in_division)));
});

test("/api/managers/:id — achievements dækker låst, oplåst, hemmelig og progress", () => {
  const { achievements } = apiResponse(`/api/managers/${TEST_TEAM.id}`);
  assert.ok(achievements.some((a) => a.unlocked), "mindst én oplåst");
  assert.ok(achievements.some((a) => !a.unlocked), "mindst én låst");
  assert.ok(achievements.some((a) => a.progress), "mindst én med progress");
  // #1666: låste hemmeligheder må ALDRIG bære titel/beskrivelse i payloaden.
  const hiddenSecret = achievements.find((a) => a.is_secret && !a.unlocked);
  assert.ok(hiddenSecret, "mindst én låst hemmelighed");
  assert.equal(hiddenSecret.title, null);
  assert.equal(hiddenSecret.description, null);
  // #1008: progress sendes aldrig for hemmeligheder (ville lække indholdet).
  assert.ok(achievements.every((a) => !(a.is_secret && a.progress)));
  // #2917: de nye sæson-achievements skal være med, ellers tester preview ikke fixet.
  for (const id of ["season_top10", "season_winner", "team_promotion", "team_relegation"]) {
    assert.ok(achievements.some((a) => a.id === id), `mangler ${id}`);
  }
});

test("/api/managers/:id — rival-holdet har nul oplåste (tomtilstand kan ses)", () => {
  const r = apiResponse(`/api/managers/${RIVAL_TEAM.id}`);
  assert.equal(r.team.id, RIVAL_TEAM.id);
  assert.equal(r.achievements.filter((a) => a.unlocked).length, 0);
  assert.deepEqual(r.transfer_activity, []);
});

// ── #2863 · RPC-routing + honours-seed ───────────────────────────────────────

test("#2863 parseRpc genkender rpc-stier og kun dem", () => {
  assert.equal(parseRpc("https://x/rest/v1/rpc/get_season_honours"), "get_season_honours");
  assert.equal(parseRpc("https://x/rest/v1/rpc/get_season_honours?foo=1"), "get_season_honours");
  // Almindelige tabel-POSTs må IKKE fanges — de skal stadig svare optimistisk.
  assert.equal(parseRpc("https://x/rest/v1/teams?id=eq.1"), null);
  assert.equal(parseRpc("https://x/rest/v1/rpc"), null);
});

test("#2863 rpcResponse svarer kun på seedede RPC'er", () => {
  assert.ok(rpcResponse("get_season_honours"), "honours-RPC har seed");
  assert.equal(
    rpcResponse("get_season_recap"),
    undefined,
    "useedede RPC'er skal falde tilbage til den gamle mutations-adfærd",
  );
  assert.equal(rpcResponse(null), undefined);
});

test("#2863 honours-seedet overlever normalizeHonours med begge fælder intakte", () => {
  const { points, wins } = normalizeHonours(rpcResponse("get_season_honours"));
  assert.equal(points.length, 5);
  assert.equal(wins.length, 5);

  // Fælde 1: flest point er en AI-ejet rytter → badget skal kunne vises.
  const onPoints = topOf(points, "points");
  assert.equal(onPoints.leader.isAi, true);

  // Fælde 2: toppen af sejrs-listen er delt → tie-break-noten skal kunne vises.
  const onWins = topOf(wins, "wins");
  assert.equal(onWins.shared, true);
  assert.equal(onWins.leader.wins, onWins.runnersUp[0].wins);

  // Tallene er strenge i seedet (som PostgREST' bigint) og skal være tal bagefter.
  assert.equal(typeof onPoints.leader.points, "number");
  assert.ok(points.every((e) => e.riderId && e.name));
});

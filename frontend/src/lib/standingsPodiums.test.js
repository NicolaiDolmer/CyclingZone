import { test } from "node:test";
import assert from "node:assert/strict";
import { countTeamPodiums } from "./standingsPodiums.js";

// #1093 — Ranglisten viste 0 podier for alle hold. Rod-årsag: kolonnen læste
// `s.podiums` fra season_standings, men den kolonne findes ikke i DB'en og
// backend-aggregeringen (updateStandings) tæller den ikke. Podier beregnes nu
// client-side fra race_results — semantik matcher rytter-ranglistens
// "Top 3"-kolonne (RiderRankingsPage): kun stage + gc med rank <= 3.

const ME = "team-me";
const RIVAL = "team-rival";

const row = (overrides = {}) => ({
  result_type: "stage",
  rank: 1,
  team_id: ME,
  rider: { team_id: ME },
  ...overrides,
});

test("countTeamPodiums — etape-top-3 tæller som podie (rank 1, 2, 3)", () => {
  const counts = countTeamPodiums([
    row({ rank: 1 }),
    row({ rank: 2 }),
    row({ rank: 3 }),
  ]);
  assert.equal(counts[ME], 3);
});

test("countTeamPodiums — gc-top-3 tæller (etapeløb-samlet OG klassiker bruger result_type='gc')", () => {
  const counts = countTeamPodiums([
    row({ result_type: "gc", rank: 2 }),
    row({ result_type: "gc", rank: 3 }),
  ]);
  assert.equal(counts[ME], 2);
});

test("countTeamPodiums — rank 4+ tæller ikke", () => {
  const counts = countTeamPodiums([
    row({ rank: 4 }),
    row({ result_type: "gc", rank: 10 }),
  ]);
  assert.equal(counts[ME], undefined);
});

test("countTeamPodiums — trøje-klassementer og dags-resultater tæller ikke, selv ved rank 1", () => {
  const counts = countTeamPodiums([
    row({ result_type: "points" }),
    row({ result_type: "mountain" }),
    row({ result_type: "young" }),
    row({ result_type: "leader" }),
    row({ result_type: "points_day" }),
  ]);
  assert.equal(counts[ME], undefined);
});

test("countTeamPodiums — holdkonkurrence (result_type='team') tæller ikke (har egen kolonne)", () => {
  const counts = countTeamPodiums([
    row({ result_type: "team", rank: 1, rider: null }),
  ]);
  assert.equal(counts[ME], undefined);
});

test("countTeamPodiums — attribution: team_id-snapshot foretrækkes, rider.team_id som fallback (samme regel som backend updateStandings)", () => {
  const counts = countTeamPodiums([
    // Snapshot på resultatet vinder over rytterens nuværende hold.
    row({ team_id: ME, rider: { team_id: RIVAL } }),
    // Mangler snapshot → fald tilbage til rytterens hold.
    row({ team_id: null, rider: { team_id: RIVAL } }),
    // Hverken snapshot eller rytter-hold → ignoreres.
    row({ team_id: null, rider: null }),
  ]);
  assert.equal(counts[ME], 1);
  assert.equal(counts[RIVAL], 1);
});

test("countTeamPodiums — flere hold tælles uafhængigt", () => {
  const counts = countTeamPodiums([
    row({ rank: 1 }),
    row({ rank: 2, team_id: RIVAL, rider: { team_id: RIVAL } }),
    row({ result_type: "gc", rank: 1 }),
  ]);
  assert.equal(counts[ME], 2);
  assert.equal(counts[RIVAL], 1);
});

test("countTeamPodiums — tom/null input giver tomt resultat", () => {
  assert.deepEqual(countTeamPodiums([]), {});
  assert.deepEqual(countTeamPodiums(null), {});
  assert.deepEqual(countTeamPodiums(undefined), {});
});

test("countTeamPodiums — rank som string-tal tæller stadig (defensiv coercion)", () => {
  const counts = countTeamPodiums([row({ rank: "2" })]);
  assert.equal(counts[ME], 1);
});

test("countTeamPodiums — rank null/0/negativ tæller ikke", () => {
  const counts = countTeamPodiums([
    row({ rank: null }),
    row({ rank: 0 }),
    row({ rank: -1 }),
  ]);
  assert.equal(counts[ME], undefined);
});

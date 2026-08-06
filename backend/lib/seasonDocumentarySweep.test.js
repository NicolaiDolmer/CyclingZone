import test from "node:test";
import assert from "node:assert/strict";
import { runSeasonDocumentarySweep } from "./seasonDocumentarySweep.js";

const SEASONS = [
  { id: "season-2", number: 2 },
  { id: "season-1", number: 1 },
];

const TEAMS_BY_SEASON = {
  "season-2": [
    { teamId: "team-a", teamName: "Team A" },
    { teamId: "team-b", teamName: "Team B" },
  ],
  "season-1": [
    { teamId: "team-a", teamName: "Team A" },
  ],
};

function makeHarness({ existingBySeasonId = {}, generateImpl } = {}) {
  const generatedCalls = [];
  const generate = generateImpl || (async (args) => {
    generatedCalls.push(args);
    return {};
  });
  return {
    generatedCalls,
    fetchRecentCompletedSeasons: async () => SEASONS,
    fetchHumanTeamsForSeason: async ({ seasonId }) => TEAMS_BY_SEASON[seasonId] || [],
    fetchExistingDocumentaryTeamIds: async ({ seasonId }) => existingBySeasonId[seasonId] || new Set(),
    generate,
  };
}

test("runSeasonDocumentarySweep generates for every human team missing a row, across the recent seasons", async () => {
  const h = makeHarness();
  const result = await runSeasonDocumentarySweep({ supabase: {}, ...h });
  assert.equal(result.seasonsChecked, 2);
  assert.equal(result.generated, 3); // 2 teams in season-2 + 1 team in season-1
  assert.equal(result.failed, 0);
  assert.deepEqual(
    h.generatedCalls.map((c) => `${c.seasonId}:${c.teamId}`).sort(),
    ["season-1:team-a", "season-2:team-a", "season-2:team-b"]
  );
});

test("runSeasonDocumentarySweep skips teams that already have a documentary row (idempotent — no regeneration)", async () => {
  const h = makeHarness({
    existingBySeasonId: { "season-2": new Set(["team-a"]) },
  });
  const result = await runSeasonDocumentarySweep({ supabase: {}, ...h });
  assert.equal(result.generated, 2); // season-2:team-b + season-1:team-a
  assert.deepEqual(
    h.generatedCalls.map((c) => `${c.seasonId}:${c.teamId}`).sort(),
    ["season-1:team-a", "season-2:team-b"]
  );
});

test("runSeasonDocumentarySweep is a no-op when every team already has a row", async () => {
  const h = makeHarness({
    existingBySeasonId: {
      "season-2": new Set(["team-a", "team-b"]),
      "season-1": new Set(["team-a"]),
    },
  });
  const result = await runSeasonDocumentarySweep({ supabase: {}, ...h });
  assert.equal(result.generated, 0);
  assert.equal(h.generatedCalls.length, 0);
});

test("runSeasonDocumentarySweep continues past a single team's failure and reports it (partial failure isolation)", async () => {
  const h = makeHarness({
    generateImpl: async ({ teamId }) => {
      if (teamId === "team-b") throw new Error("boom");
      return {};
    },
  });
  const result = await runSeasonDocumentarySweep({ supabase: {}, ...h });
  assert.equal(result.generated, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].teamId, "team-b");
  assert.match(result.errors[0].message, /boom/);
});

test("runSeasonDocumentarySweep with no completed seasons is a clean no-op", async () => {
  const result = await runSeasonDocumentarySweep({
    supabase: {},
    fetchRecentCompletedSeasons: async () => [],
    fetchHumanTeamsForSeason: async () => { throw new Error("should not be called"); },
    fetchExistingDocumentaryTeamIds: async () => { throw new Error("should not be called"); },
  });
  assert.deepEqual(result, { seasonsChecked: 0, generated: 0, failed: 0, errors: [] });
});

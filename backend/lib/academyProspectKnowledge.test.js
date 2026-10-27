import test from "node:test";
import assert from "node:assert/strict";

import { KNOWLEDGE_DAYS, knowledgeStage, learningSpeed, loadTrainingDaysOnTeam } from "./academyProspectKnowledge.ts";
import { SCOUTING_CONFIG } from "./scouting.js";

test("knowledgeStage: intet baand foer de foerste traeningsloebsdage", () => {
  const s = knowledgeStage(0);
  assert.equal(s.stage, "learning");
  assert.equal(s.level, null);
  assert.equal(s.nextStageDays, KNOWLEDGE_DAYS.broad);
});

test("knowledgeStage: bredt, smalt, endeligt i den raekkefoelge", () => {
  assert.equal(knowledgeStage(KNOWLEDGE_DAYS.broad).stage, "broad");
  assert.equal(knowledgeStage(KNOWLEDGE_DAYS.narrow).stage, "narrow");
  assert.equal(knowledgeStage(KNOWLEDGE_DAYS.final).stage, "final");
  assert.equal(knowledgeStage(KNOWLEDGE_DAYS.final).level, SCOUTING_CONFIG.maxLevel);
  const levels = [KNOWLEDGE_DAYS.broad, KNOWLEDGE_DAYS.narrow, KNOWLEDGE_DAYS.final].map((d) => knowledgeStage(d).level);
  assert.ok(levels[0] < levels[1] && levels[1] < levels[2], "baandet snaevrer ind trin for trin");
});

test("learningSpeed: traener og facilitet giver hurtigere sikkerhed, aldrig langsommere", () => {
  assert.equal(learningSpeed({}), 1);
  const fac = learningSpeed({ facilityTier: 3 });
  const coach = learningSpeed({ staff: { overall: 80 } });
  const both = learningSpeed({ facilityTier: 5, staff: { overall: 99 } });
  assert.ok(fac > 1 && coach > 1 && both > fac && both > coach);
  // Hurtigere: samme antal dage naar laengere med en bedre stab.
  assert.equal(knowledgeStage(8, 1).stage, "learning");
  assert.equal(knowledgeStage(8, both).stage, "broad");
});

function trainingCountMock({ scores = [], riders = [], error = null } = {}) {
  const calls = [];
  return { calls, sb: {
    from(table) {
      assert.equal(table, "riders");
      let ids = [], teamId;
      const api = {
        select(cols) { assert.equal(cols, "id, rider_training_scores(count)"); return api; },
        in(col, val) { assert.equal(col, "id"); ids = val; return api; },
        eq(col, val) { assert.equal(col, "rider_training_scores.team_id"); teamId = val; return api; },
        order(col) { assert.equal(col, "id"); return api; },
        range(from, to) {
          calls.push({ ids, teamId, from, to });
          const data = riders.filter((r) => ids.includes(r.id)).sort((a, b) => a.id.localeCompare(b.id)).slice(from, to + 1).map((r) => ({
            id: r.id,
            rider_training_scores: [{ count: scores.filter((s) => s.rider_id === r.id && s.team_id === teamId).length }],
          }));
          return Promise.resolve({ data: error ? null : data, error });
        },
      };
      return api;
    },
  } };
}

test("loadTrainingDaysOnTeam: matches former per-rider counts in one request, including long and transferred history", async () => {
  const riders = Array.from({ length: 24 }, (_, i) => ({ id: `r${i}`, team_id: i === 0 ? "other-current-team" : "t1" }));
  const scores = riders.flatMap((r, i) => Array.from({ length: i === 0 ? 2405 : i }, (_, n) => ({
    rider_id: r.id, team_id: n % 2 ? "other-history-team" : "t1",
  })));
  const { sb, calls } = trainingCountMock({ riders, scores });
  const riderIds = [...riders.map((r) => r.id), "r0", "missing", null, undefined];
  const expected = new Map([...new Set(riderIds.filter(Boolean))].map((id) => [id,
    scores.filter((s) => s.rider_id === id && s.team_id === "t1").length,
  ]));
  const result = await loadTrainingDaysOnTeam(sb, { teamId: "t1", riderIds });
  assert.deepEqual(result, expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ids.length, 25, "duplicate and empty IDs excluded");
  assert.equal(calls[0].teamId, "t1");
});

test("loadTrainingDaysOnTeam: empty input needs no request", async () => {
  const { sb, calls } = trainingCountMock();
  for (const riderIds of [[], null, undefined, [null, undefined]]) {
    assert.deepEqual(await loadTrainingDaysOnTeam(sb, { teamId: "t1", riderIds }), new Map());
  }
  assert.equal(calls.length, 0);
});

test("loadTrainingDaysOnTeam: large rider lists keep bounded filters and zero-day entries", async () => {
  const riders = Array.from({ length: 1205 }, (_, i) => ({ id: `r${String(i).padStart(4, "0")}` }));
  const scores = [{ rider_id: riders.at(-1).id, team_id: "t1" }];
  const { sb, calls } = trainingCountMock({ riders, scores });
  const result = await loadTrainingDaysOnTeam(sb, { teamId: "t1", riderIds: riders.map((r) => r.id) });
  assert.equal(result.size, riders.length);
  assert.equal(result.get(riders[0].id), 0);
  assert.equal(result.get(riders.at(-1).id), 1);
  assert.ok(calls.every((c) => c.ids.length <= 100));
});

test("loadTrainingDaysOnTeam: read errors fail closed with context", async () => {
  const { sb } = trainingCountMock({ error: { message: "permission denied", code: "42501" } });
  await assert.rejects(loadTrainingDaysOnTeam(sb, { teamId: "t1", riderIds: ["r1"] }), /academy-knowledge training days:.*permission denied/);
});

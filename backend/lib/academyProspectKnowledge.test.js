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

test("loadTrainingDaysOnTeam: taeller pr. rytter paa holdet uden at hente raekker", async () => {
  const calls = [];
  const sb = {
    from(table) {
      assert.equal(table, "rider_training_scores");
      const filters = {};
      const api = {
        select(cols, opts) { assert.equal(opts.head, true); return api; },
        eq(col, val) {
          filters[col] = val;
          if (filters.rider_id && filters.team_id) {
            calls.push({ ...filters });
            return Promise.resolve({ count: filters.rider_id === "r1" ? 12 : 0, error: null });
          }
          return api;
        },
      };
      return api;
    },
  };
  const m = await loadTrainingDaysOnTeam(sb, { teamId: "t1", riderIds: ["r1", "r2", "r1"] });
  assert.equal(m.get("r1"), 12);
  assert.equal(m.get("r2"), 0);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.team_id === "t1"));
});

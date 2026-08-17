import test from "node:test";
import assert from "node:assert/strict";

import {
  allocateNegotiationPower,
  applyMilestoneDeltas,
  computeRelationUpdateFromEvaluation,
  evaluateDueMilestones,
  loadRelation,
  persistConfidenceChange,
  unlockExtraordinaryRequest,
} from "./boardMandateEngine.js";

// ── Fake-supabase, samme mønster som boardWeekendFinalization.test.js ─────────
function makeSupabase({ flagValue = "off", relation = null, captures = {} } = {}) {
  captures.updates = captures.updates || [];
  captures.inserts = captures.inserts || [];

  return {
    from(table) {
      if (table === "app_config") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: flagValue }, error: null }) }) }),
        };
      }
      if (table === "board_relations") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: relation, error: null }) }) }),
          update: (payload) => ({
            eq: async (col, value) => {
              captures.updates.push({ table, payload, col, value });
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === "board_satisfaction_events") {
        return {
          insert: async (payload) => {
            captures.inserts.push({ table, payload });
            return { data: null, error: null };
          },
        };
      }
      if (table === "board_mandates") {
        const chain = {
          _filters: {},
          eq(col, value) { this._filters[col] = value; return this; },
          select: async () => {
            captures.updates.push({ table, filters: chain._filters, payload: chain._payload });
            // Simulerer at "allerede låst op" ikke matcher nogen række.
            const alreadyUnlocked = chain._filters.extraordinary_request_unlocked === false
              && captures.unlockedOnce === true;
            captures.unlockedOnce = true;
            return { data: alreadyUnlocked ? [] : [{ id: chain._filters.id }], error: null };
          },
        };
        return {
          update(payload) { chain._payload = payload; return chain; },
        };
      }
      throw new Error(`uventet tabel i test: ${table}`);
    },
  };
}

const teamWithRiders = { riders: [] };

// ── Milepæls-evaluering ──────────────────────────────────────────────────────

const milestone = (over) => ({
  id: "m1",
  milestone_key: "3yr:s3:stage_wins:5:0",
  status: "pending",
  target_season_number: 3,
  weight: 1,
  is_headline: true,
  goal: {
    type: "stage_wins", target: 5, weight: 1, category: "results",
    importance: "required", satisfaction_bonus: 10, satisfaction_penalty: 8,
  },
  ...over,
});

test("kun milepæle der forfalder i DENNE sæson evalueres", () => {
  const outcomes = evaluateDueMilestones({
    milestones: [milestone(), milestone({ id: "m2", target_season_number: 5 })],
    seasonNumber: 3,
    standing: { stage_wins: 9 },
    team: teamWithRiders,
    context: { cumulativeStats: { stageWins: 9 } },
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].milestone_id, "m1");
});

test("allerede evalueret milepæl tages ikke igen (ingen dobbelt-straf)", () => {
  const outcomes = evaluateDueMilestones({
    milestones: [milestone({ status: "missed" }), milestone({ id: "m2", status: "achieved" })],
    seasonNumber: 3,
    standing: {},
    team: teamWithRiders,
  });
  assert.equal(outcomes.length, 0);
});

test("nået milepæl giver plus, misset giver minus - og begge har en kvitterings-kode", () => {
  const hit = evaluateDueMilestones({
    milestones: [milestone()],
    seasonNumber: 3,
    standing: { stage_wins: 9 },
    team: teamWithRiders,
    context: { cumulativeStats: { stageWins: 9 } },
  })[0];
  assert.equal(hit.status, "achieved");
  assert.ok(hit.confidence_delta > 0);
  assert.equal(hit.chairman_beat_key, "mandate.milestone.achieved");

  const miss = evaluateDueMilestones({
    milestones: [milestone()],
    seasonNumber: 3,
    standing: { stage_wins: 0 },
    team: teamWithRiders,
    context: { cumulativeStats: { stageWins: 0 } },
  })[0];
  assert.equal(miss.status, "missed");
  assert.ok(miss.confidence_delta < 0);
  assert.equal(miss.chairman_beat_key, "mandate.milestone.missed");
});

test("ugyldigt sæsonnummer evaluerer ingenting frem for at evaluere alt", () => {
  assert.deepEqual(evaluateDueMilestones({ milestones: [milestone()], seasonNumber: null }), []);
});

// ── Clamp + kvittering ───────────────────────────────────────────────────────

test("kvitteringen viser det FAKTISKE slag efter clamp, ikke det teoretiske", () => {
  const { confidence, steps } = applyMilestoneDeltas(4, [
    { milestone_id: "m1", confidence_delta: -10 },
  ]);
  assert.equal(confidence, 0);
  assert.equal(steps[0].applied_delta, -4, "et hold på 4 tillid kan ikke tabe 10");
  assert.equal(steps[0].confidence_before, 4);
  assert.equal(steps[0].confidence_after, 0);
});

test("flere milepæle anvendes sekventielt så hver har sin egen kvittering", () => {
  const { confidence, steps } = applyMilestoneDeltas(50, [
    { milestone_id: "a", confidence_delta: -8 },
    { milestone_id: "b", confidence_delta: +12 },
  ]);
  assert.equal(confidence, 54);
  assert.deepEqual(steps.map((s) => s.applied_delta), [-8, 12]);
});

test("confidence kan aldrig gå over 100", () => {
  assert.equal(applyMilestoneDeltas(98, [{ confidence_delta: 15 }]).confidence, 100);
});

// ── Weekend-opdatering ───────────────────────────────────────────────────────

test("weekend-opdateringen giver ÉT tal plus kvittering i samme svar", () => {
  const result = computeRelationUpdateFromEvaluation({
    relation: { confidence: 60 },
    evaluation: {
      feedback: { satisfaction_delta: 7 },
      goalsMet: 3,
      goals: [1, 2, 3, 4],
      overallScore: 0.82,
      scoreBreakdown: { categories: { results: { score: 0.9 }, economy: { score: 0.5 } } },
    },
    raceId: "race-1",
    raceName: "Tour",
  });

  assert.equal(result.confidence, 67);
  assert.deepEqual(result.category_scores, { results: 90, economy: 50 });
  assert.equal(result.receipt.satisfaction_before, 60);
  assert.equal(result.receipt.satisfaction_after, 67);
  assert.equal(result.receipt.satisfaction_delta, 7);
  assert.equal(result.receipt.goals_total, 4);
  assert.equal(result.receipt.race_name, "Tour");
});

test("manglende delta flytter ikke tallet (fail-safe, ingen NaN i et spiller-vendt felt)", () => {
  const result = computeRelationUpdateFromEvaluation({ relation: { confidence: 55 }, evaluation: {} });
  assert.equal(result.confidence, 55);
  assert.equal(result.receipt.satisfaction_delta, 0);
});

// ── Tillids-trappen fryses ───────────────────────────────────────────────────

test("forhandlingsmagt fryses ved mødets start med det tal den blev tildelt efter", () => {
  const power = allocateNegotiationPower(78);
  assert.equal(power.adjustments_allowed, 3);
  assert.equal(power.trust_tier, "trusted");
  assert.equal(power.confidence_at_allocation, 78);
});

// ── Flag-gaten ───────────────────────────────────────────────────────────────

test("loadRelation returnerer null når kill-switchen er off", async () => {
  const supabase = makeSupabase({ flagValue: "off", relation: { id: "r1", confidence: 66 } });
  assert.equal(await loadRelation(supabase, "team-1"), null);
});

test("loadRelation læser relationen når flaget er on", async () => {
  const supabase = makeSupabase({ flagValue: "on", relation: { id: "r1", confidence: 66 } });
  const relation = await loadRelation(supabase, "team-1");
  assert.equal(relation.confidence, 66);
});

test("beta-flag åbner kun for beta-testere", async () => {
  const supabase = makeSupabase({ flagValue: "beta", relation: { id: "r1", confidence: 66 } });
  assert.equal(await loadRelation(supabase, "team-1"), null);
  assert.ok(await loadRelation(supabase, "team-1", { isBetaTester: true }));
});

// ── Skrivning ────────────────────────────────────────────────────────────────

test("et tal skrives ALDRIG uden sin kvittering", async () => {
  const captures = {};
  const supabase = makeSupabase({ flagValue: "on", captures });
  await persistConfidenceChange(supabase, {
    relationId: "r1",
    teamId: "team-1",
    seasonId: "season-1",
    boardId: null,
    milestoneId: "m1",
    confidence: 61,
    categoryScores: { results: 80 },
    confidenceSource: { method: "milestone" },
    receipt: {
      satisfaction_before: 69, satisfaction_after: 61, satisfaction_delta: -8,
      goals_met: 2, goals_total: 4, reason_category: "milestone",
    },
  });

  assert.equal(captures.updates.length, 1);
  assert.equal(captures.updates[0].payload.confidence, 61);
  assert.equal(captures.inserts.length, 1);
  assert.equal(captures.inserts[0].payload.milestone_id, "m1");
  assert.equal(captures.inserts[0].payload.board_id, null);
  assert.equal(captures.inserts[0].payload.satisfaction_delta, -8);
});

test("tomme kategoriscorer overskriver ikke eksisterende metre med tomhed", async () => {
  const captures = {};
  const supabase = makeSupabase({ flagValue: "on", captures });
  await persistConfidenceChange(supabase, {
    relationId: "r1", teamId: "t", seasonId: "s", confidence: 50, categoryScores: {},
  });
  assert.equal("category_scores" in captures.updates[0].payload, false);
});

test("mid-season check-in låser den ekstraordinære samtale op én gang", async () => {
  const captures = {};
  const supabase = makeSupabase({ flagValue: "on", captures });
  assert.equal((await unlockExtraordinaryRequest(supabase, { mandateId: "m1" })).unlocked, true);
  assert.equal((await unlockExtraordinaryRequest(supabase, { mandateId: "m1" })).unlocked, false);
});

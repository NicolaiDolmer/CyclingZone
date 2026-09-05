import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceMandateAtSeasonEnd,
  allocateNegotiationPower,
  applyMilestoneDeltas,
  applySeasonEndSync,
  applyWeekendSync,
  buildGoalStatesFromEvaluation,
  completeActiveMandate,
  computeRelationUpdateFromEvaluation,
  ensureRelationForTeam,
  evaluateDueMilestones,
  evaluateEarlyMilestones,
  loadRelation,
  persistConfidenceChange,
  proposeMandateForNewTeam,
  proposeNextMandate,
  unlockExtraordinaryRequest,
  unlockExtraordinaryRequestForTeam,
} from "./boardMandateEngine.js";
import { buildGoalKey } from "./boardGoals.js";

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

// ── #4578: goal_states-snapshot til kvitteringen ────────────────────────────

const goalEvaluationFixture = (over) => ({
  type: "stage_wins", target: 5, cumulative: false, nationality_code: null, race_scope: null,
  status: "on_track", met: false, score_pct: 60, actual: 3,
  ...over,
});

test("buildGoalStatesFromEvaluation: ét element pr. goalEvaluation, goal_key = buildGoalKey", () => {
  const evaluation = {
    goalEvaluations: [
      goalEvaluationFixture(),
      goalEvaluationFixture({ type: "min_riders", target: 20, met: true, status: "ahead", score_pct: 100, actual: 22 }),
    ],
  };
  const states = buildGoalStatesFromEvaluation(evaluation);
  assert.equal(states.length, 2);
  assert.equal(states[0].goal_key, buildGoalKey(goalEvaluationFixture()));
  assert.equal(states[0].type, "stage_wins");
  assert.equal(states[0].status, "on_track");
  assert.equal(states[0].met, false);
  assert.equal(states[0].score_pct, 60);
  assert.equal(states[0].actual, 3);
  assert.equal(states[0].target, 5);
  assert.equal(states[1].goal_key, buildGoalKey({ type: "min_riders", target: 20 }));
  assert.equal(states[1].met, true);
});

test("buildGoalStatesFromEvaluation: evaluation uden goalEvaluations -> tomt array, ikke et kast", () => {
  assert.deepEqual(buildGoalStatesFromEvaluation({}), []);
  assert.deepEqual(buildGoalStatesFromEvaluation(null), []);
  assert.deepEqual(buildGoalStatesFromEvaluation({ goalEvaluations: [] }), []);
});

test("buildGoalStatesFromEvaluation: manglende actual/target/score_pct bliver null, ikke NaN", () => {
  const [state] = buildGoalStatesFromEvaluation({
    goalEvaluations: [{ type: "sponsor_growth", target: 20, status: "awaiting_data", met: false, actual: null, score_pct: null }],
  });
  assert.equal(state.actual, null);
  assert.equal(state.target, 20);
  assert.equal(state.score_pct, null);
});

test("computeRelationUpdateFromEvaluation: receipt.goal_states udfyldes fra evaluation.goalEvaluations", () => {
  const result = computeRelationUpdateFromEvaluation({
    relation: { confidence: 50 },
    evaluation: {
      feedback: { satisfaction_delta: 2 },
      goalsMet: 1,
      goals: [1],
      goalEvaluations: [goalEvaluationFixture({ met: true, status: "ahead" })],
    },
  });
  assert.equal(result.receipt.goal_states.length, 1);
  assert.equal(result.receipt.goal_states[0].met, true);
  assert.equal(result.receipt.goal_states[0].goal_key, buildGoalKey(goalEvaluationFixture()));
});

test("computeRelationUpdateFromEvaluation: evaluation uden goalEvaluations giver tomt goal_states, aldrig undefined", () => {
  const result = computeRelationUpdateFromEvaluation({ relation: { confidence: 50 }, evaluation: {} });
  assert.deepEqual(result.receipt.goal_states, []);
});

test("persistConfidenceChange: goal_states fra receipt lander i board_satisfaction_events-insertet", async () => {
  const captures = {};
  const supabase = makeSupabase({ flagValue: "on", captures });
  const goalStates = [{ goal_key: "stage_wins|5|||0", type: "stage_wins", status: "ahead", met: true, score_pct: 100, actual: 5, target: 5 }];
  await persistConfidenceChange(supabase, {
    relationId: "r1", teamId: "t", seasonId: "s", confidence: 60,
    receipt: {
      satisfaction_before: 50, satisfaction_after: 60, satisfaction_delta: 10,
      goals_met: 1, goals_total: 1, reason_category: "weekend_update",
      goal_states: goalStates,
    },
  });
  assert.deepEqual(captures.inserts[0].payload.goal_states, goalStates);
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

// ── A7: milepæl nået FØR sin mål-sæson ("fejr straks + fyld op") ────────────
// Addendum 1/9, ejer-valg A7. En misset milepæl rammes ALDRIG her — kun tidlig
// SUCCES fejres tidligt, en misset milepæl venter til sin egen mål-sæson.

test("A7: en milepæl der er opfyldt FØR sin mål-sæson fejres med det samme og åbner et slot", () => {
  const early = evaluateEarlyMilestones({
    milestones: [milestone({ target_season_number: 5 })],
    seasonNumber: 3,
    standing: { stage_wins: 9 },
    team: teamWithRiders,
    context: { cumulativeStats: { stageWins: 9 } },
  });
  assert.equal(early.length, 1);
  assert.equal(early[0].status, "achieved");
  assert.equal(early[0].achieved_early, true);
  assert.equal(early[0].slot_open, true);
  assert.equal(early[0].chairman_beat_key, "mandate.milestone.achieved_early");
  assert.ok(early[0].confidence_delta > 0);
});

test("A7: en milepæl der IKKE er nået endnu rapporteres aldrig som tidligt misset", () => {
  const early = evaluateEarlyMilestones({
    milestones: [milestone({ target_season_number: 5 })],
    seasonNumber: 3,
    standing: { stage_wins: 0 },
    team: teamWithRiders,
    context: { cumulativeStats: { stageWins: 0 } },
  });
  assert.deepEqual(early, [], "ingen tidlig straf findes — kun tidlig succes fejres tidligt");
});

test("A7: en milepæl i sin EGEN mål-sæson er ikke 'tidlig' (den hører til evaluateDueMilestones)", () => {
  const early = evaluateEarlyMilestones({
    milestones: [milestone({ target_season_number: 3 })],
    seasonNumber: 3,
    standing: { stage_wins: 9 },
    team: teamWithRiders,
    context: { cumulativeStats: { stageWins: 9 } },
  });
  assert.deepEqual(early, []);
});

test("A7: en allerede afgjort milepæl (achieved/missed) evalueres ikke igen som tidlig", () => {
  const early = evaluateEarlyMilestones({
    milestones: [milestone({ target_season_number: 5, status: "achieved" })],
    seasonNumber: 3,
    standing: { stage_wins: 9 },
    team: teamWithRiders,
    context: { cumulativeStats: { stageWins: 9 } },
  });
  assert.deepEqual(early, []);
});

test("rettidigt nået milepæl bærer IKKE achieved_early/slot_open (kun A7-stien gør)", () => {
  const due = evaluateDueMilestones({
    milestones: [milestone()],
    seasonNumber: 3,
    standing: { stage_wins: 9 },
    team: teamWithRiders,
    context: { cumulativeStats: { stageWins: 9 } },
  })[0];
  assert.equal(due.achieved_early, false);
  assert.equal(due.slot_open, false);
});

// ── Produktions-indgange: applyWeekendSync / applySeasonEndSync / unlock ────
// Egen fake-supabase: bredere tabel-dækning (board_mandates.select-kæde og
// board_vision_milestones) end den øverste makeSupabase, som kun dækker de
// rene delfunktioners egne behov.

function makeShadowSupabase({
  flagValue = "on",
  relation = { id: "r1", confidence: 60, category_scores: {}, confidence_source: {} },
  mandate = { id: "mandate-1" },
  milestones = [],
  captures = {},
} = {}) {
  captures.relationUpdates = captures.relationUpdates || [];
  captures.milestoneUpdates = captures.milestoneUpdates || [];
  captures.events = captures.events || [];

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
              captures.relationUpdates.push({ payload, col, value });
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === "board_mandates") {
        return {
          select: () => {
            const chain = { eq: () => chain, maybeSingle: async () => ({ data: mandate, error: null }) };
            return chain;
          },
          update(payload) {
            const chain = {
              _filters: {},
              eq(col, value) { this._filters[col] = value; return this; },
              select: async () => {
                captures.mandateUpdates = captures.mandateUpdates || [];
                captures.mandateUpdates.push({ payload, filters: chain._filters });
                return { data: [{ id: mandate?.id ?? chain._filters.id }], error: null };
              },
            };
            return chain;
          },
        };
      }
      if (table === "board_vision_milestones") {
        return {
          select: () => {
            const chain = {
              eq: () => chain,
              then: (resolve) => resolve({ data: milestones, error: null }),
            };
            return chain;
          },
          update: (payload) => ({
            eq: async (col, value) => {
              captures.milestoneUpdates.push({ payload, col, value });
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === "board_satisfaction_events") {
        return {
          insert: async (payload) => {
            captures.events.push(payload);
            return { data: null, error: null };
          },
        };
      }
      throw new Error(`uventet tabel i test: ${table}`);
    },
  };
}

const weekendEvaluation = {
  feedback: { satisfaction_delta: 5 },
  goalsMet: 2,
  goals: [1, 2, 3],
  overallScore: 0.7,
  scoreBreakdown: { categories: { results: { score: 0.8 } } },
};

test("applyWeekendSync: kill-switch off → intet læses eller skrives", async () => {
  const captures = {};
  const supabase = makeShadowSupabase({ flagValue: "off", captures });
  const result = await applyWeekendSync(supabase, { teamId: "t1", seasonId: "s1", evaluation: weekendEvaluation });
  assert.equal(result, null);
  assert.equal(captures.relationUpdates.length, 0);
  assert.equal(captures.events.length, 0);
});

test("applyWeekendSync: intet skygge-relation endnu (hold oprettet efter seneste rebuild) → tydeligt skip, ingen fejl", async () => {
  const supabase = makeShadowSupabase({ flagValue: "on", relation: null });
  const result = await applyWeekendSync(supabase, { teamId: "t1", seasonId: "s1", evaluation: weekendEvaluation });
  assert.equal(result.skipped, "no_shadow_relation");
});

test("applyWeekendSync: on → opdaterer confidence + skriver kvittering med mandate_id", async () => {
  const captures = {};
  const supabase = makeShadowSupabase({ flagValue: "on", captures });
  const result = await applyWeekendSync(supabase, {
    teamId: "t1", seasonId: "s1", evaluation: weekendEvaluation, raceId: "race-9", raceName: "Giro",
  });
  assert.equal(result.confidence, 65);
  assert.equal(captures.relationUpdates[0].payload.confidence, 65);
  assert.equal(captures.events[0].mandate_id, "mandate-1");
  assert.equal(captures.events[0].team_id, "t1");
  assert.equal(captures.events[0].race_name, "Giro");
});

test("applySeasonEndSync: kill-switch off → intet skrives", async () => {
  const captures = {};
  const supabase = makeShadowSupabase({ flagValue: "off", captures });
  const result = await applySeasonEndSync(supabase, {
    teamId: "t1", seasonId: "s1", seasonNumber: 3, standing: {}, team: teamWithRiders,
    mandateEvaluation: weekendEvaluation,
  });
  assert.equal(result, null);
  assert.equal(captures.relationUpdates.length, 0);
});

test("applySeasonEndSync: sæsonens evaluering FØRST, milepælen DEREFTER (bindende rækkefølge)", async () => {
  const captures = {};
  const supabase = makeShadowSupabase({
    flagValue: "on",
    captures,
    milestones: [milestone({ id: "m1", target_season_number: 3, origin: "3yr" })],
  });
  const result = await applySeasonEndSync(supabase, {
    teamId: "t1", seasonId: "s1", seasonNumber: 3,
    standing: { stage_wins: 9 }, team: teamWithRiders,
    mandateEvaluation: weekendEvaluation, // +5 → 60 → 65
    milestoneContexts: [{ planType: "3yr", context: { cumulativeStats: { stageWins: 9 } } }],
  });
  // 60 (relation) +5 (sæson) = 65, +10 (milepæl-hit) = 75.
  assert.equal(result.confidence, 75);
  assert.equal(result.milestones_evaluated, 1);
  // To relation-opdateringer skrevet i rækkefølge: sæson FØRST (65), milepæl DEREFTER (75).
  assert.equal(captures.relationUpdates.length, 2);
  assert.equal(captures.relationUpdates[0].payload.confidence, 65);
  assert.equal(captures.relationUpdates[1].payload.confidence, 75);
  // Milepælen selv er lukket med kvittering.
  assert.equal(captures.milestoneUpdates[0].payload.status, "achieved");
  assert.equal(captures.milestoneUpdates[0].payload.achieved_early, false);
  assert.equal(captures.events[1].milestone_id, "m1");
});

test("applySeasonEndSync (A7): en tidligt nået milepæl lukkes MED achieved_early + slot_open persisteret", async () => {
  const captures = {};
  const supabase = makeShadowSupabase({
    flagValue: "on",
    captures,
    milestones: [milestone({ id: "m2", target_season_number: 5, origin: "3yr" })],
  });
  const result = await applySeasonEndSync(supabase, {
    teamId: "t1", seasonId: "s1", seasonNumber: 3,
    standing: { stage_wins: 9 }, team: teamWithRiders,
    mandateEvaluation: null, // ingen ordinær sæson-evaluering denne gang, kun milepælen
    milestoneContexts: [{ planType: "3yr", context: { cumulativeStats: { stageWins: 9 } } }],
  });
  assert.equal(result.milestones_evaluated, 1);
  assert.equal(captures.milestoneUpdates[0].payload.achieved_early, true);
  assert.equal(captures.milestoneUpdates[0].payload.slot_open, true);
  assert.equal(captures.events[0].reason_category, "mandate.milestone.achieved_early");
});

test("unlockExtraordinaryRequestForTeam: kill-switch off → null, ingen kald", async () => {
  const supabase = makeShadowSupabase({ flagValue: "off" });
  assert.equal(await unlockExtraordinaryRequestForTeam(supabase, { teamId: "t1", seasonId: "s1" }), null);
});

test("unlockExtraordinaryRequestForTeam: ingen aktivt mandat → tydeligt skip", async () => {
  const supabase = makeShadowSupabase({ flagValue: "on", mandate: null });
  const result = await unlockExtraordinaryRequestForTeam(supabase, { teamId: "t1", seasonId: "s1" });
  assert.deepEqual(result, { unlocked: false, reason: "no_active_mandate" });
});

test("unlockExtraordinaryRequestForTeam: on + aktivt mandat → låser op", async () => {
  const supabase = makeShadowSupabase({ flagValue: "on" });
  const result = await unlockExtraordinaryRequestForTeam(supabase, { teamId: "t1", seasonId: "s1" });
  assert.equal(result.unlocked, true);
});

// =============================================================================
// #4557 S-M2c · Årsmødet: proposeNextMandate / completeActiveMandate /
// advanceMandateAtSeasonEnd / proposeMandateForNewTeam
// =============================================================================

function makeMandateLifecycleSupabase({ flagValue = "on", seasons = [], mandates = [], relations = [] } = {}) {
  const state = { mandates: [...mandates], relations: [...relations] };
  let mandateSeq = state.mandates.length;
  let relationSeq = state.relations.length;

  function matchAll(row, filters) {
    return Object.entries(filters).every(([k, v]) => row[k] === v);
  }

  function selectChain(rows) {
    const filters = {};
    const chain = {
      eq(col, value) { filters[col] = value; return chain; },
      maybeSingle: async () => ({ data: rows.find((r) => matchAll(r, filters)) ?? null, error: null }),
    };
    return chain;
  }

  return {
    _state: state,
    from(table) {
      if (table === "app_config") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: flagValue }, error: null }) }) }) };
      }
      if (table === "seasons") {
        return { select: () => selectChain(seasons) };
      }
      if (table === "board_relations") {
        return {
          select: () => selectChain(state.relations),
          insert: (payload) => ({
            select: () => ({
              single: async () => {
                relationSeq += 1;
                const row = { id: `rel-${relationSeq}`, ...payload };
                state.relations.push(row);
                return { data: row, error: null };
              },
            }),
          }),
        };
      }
      if (table === "board_mandates") {
        return {
          select: () => selectChain(state.mandates),
          insert: (payload) => ({
            select: () => ({
              single: async () => {
                mandateSeq += 1;
                const row = { id: `mand-${mandateSeq}`, ...payload };
                state.mandates.push(row);
                return { data: row, error: null };
              },
            }),
          }),
          update(payload) {
            const filters = {};
            const chain = {
              eq(col, value) { filters[col] = value; return chain; },
              select: async () => {
                const matched = state.mandates.filter((m) => matchAll(m, filters));
                matched.forEach((m) => Object.assign(m, payload));
                return { data: matched.map((m) => ({ id: m.id })), error: null };
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`uventet tabel i test: ${table}`);
    },
  };
}

test("proposeNextMandate: kill-switch off → null, intet skrives", async () => {
  const supabase = makeMandateLifecycleSupabase({ flagValue: "off" });
  const result = await proposeNextMandate(supabase, { teamId: "t1", targetSeasonNumber: 4, confidence: 60 });
  assert.equal(result, null);
  assert.equal(supabase._state.mandates.length, 0);
});

test("proposeNextMandate: sæsonen findes ikke endnu → skip, ingen gættet FK", async () => {
  const supabase = makeMandateLifecycleSupabase({ flagValue: "on", seasons: [] });
  const result = await proposeNextMandate(supabase, { teamId: "t1", targetSeasonNumber: 4, confidence: 60 });
  assert.deepEqual(result, { skipped: "target_season_not_found", season_number: 4 });
});

test("proposeNextMandate: opretter proposed mandat med 3-5 mål, tillids-trappen frosset, deadline fra resolveThresholds", async () => {
  const supabase = makeMandateLifecycleSupabase({
    flagValue: "on",
    seasons: [{ id: "season-4", number: 4 }],
  });
  const now = new Date("2026-09-03T12:00:00Z");
  const result = await proposeNextMandate(supabase, {
    teamId: "t1",
    targetSeasonNumber: 4,
    confidence: 80, // ≥75 → tillids-trappens "trusted"-trin
    previousFocus: "star_signing",
    now,
  });

  assert.equal(result.season_number, 4);
  assert.ok(result.goal_count >= 3 && result.goal_count <= 5);
  assert.equal(result.adjustments_allowed, 3, "confidence 80 → trusted-trinnet giver 3 justeringer");

  const row = supabase._state.mandates[0];
  assert.equal(row.status, "proposed");
  assert.equal(row.season_id, "season-4");
  assert.equal(row.focus, "star_signing");
  assert.equal(row.source.method, "annual_meeting");
  assert.equal(row.source.negotiation_power.trust_tier, "trusted");
  // #2463/#3579-tærsklen: uden last_seen falder resolveThresholds til den
  // KORTE default (5 dage) — se boardNegotiationThresholds.js.
  const deadlineDays = (new Date(row.auto_accept_deadline).getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(deadlineDays, 5);
});

test("proposeNextMandate: idempotent — allerede et mandat for (team, sæson) → no-op", async () => {
  const supabase = makeMandateLifecycleSupabase({
    flagValue: "on",
    seasons: [{ id: "season-4", number: 4 }],
    mandates: [{ id: "existing-1", team_id: "t1", season_id: "season-4", status: "proposed" }],
  });
  const result = await proposeNextMandate(supabase, { teamId: "t1", targetSeasonNumber: 4, confidence: 60 });
  assert.deepEqual(result, { skipped: "already_exists", mandate_id: "existing-1", status: "proposed" });
  assert.equal(supabase._state.mandates.length, 1, "intet nyt mandat oprettet");
});

test("completeActiveMandate: markerer det aktive mandat completed, rører ikke andre statusser", async () => {
  const supabase = makeMandateLifecycleSupabase({
    flagValue: "on",
    mandates: [
      { id: "m1", team_id: "t1", season_id: "s3", status: "active" },
      { id: "m2", team_id: "t1", season_id: "s2", status: "completed" },
    ],
  });
  const result = await completeActiveMandate(supabase, { teamId: "t1", seasonId: "s3" });
  assert.equal(result.updated, true);
  assert.equal(supabase._state.mandates.find((m) => m.id === "m1").status, "completed");
  assert.equal(supabase._state.mandates.find((m) => m.id === "m2").status, "completed", "uændret — var allerede completed");
});

test("ensureRelationForTeam: opretter confidence=50 for et hold uden relation, rører ALDRIG en eksisterende", async () => {
  const supabase = makeMandateLifecycleSupabase({ flagValue: "on" });
  const created = await ensureRelationForTeam(supabase, "t1");
  assert.equal(created.confidence, 50);
  assert.equal(created.confidence_source.method, "team_formation");

  const again = await ensureRelationForTeam(supabase, "t1");
  assert.equal(again.id, created.id, "anden kald finder samme række, opretter ikke en ny");
  assert.equal(supabase._state.relations.length, 1);
});

test("advanceMandateAtSeasonEnd: intet skyggerelation → skip (ingen skrivning)", async () => {
  const supabase = makeMandateLifecycleSupabase({ flagValue: "on", seasons: [{ id: "s5", number: 5 }] });
  const result = await advanceMandateAtSeasonEnd(supabase, {
    teamId: "t1", seasonId: "s4", currentSeasonNumber: 4,
  });
  assert.deepEqual(result, { skipped: "no_shadow_relation" });
});

test("advanceMandateAtSeasonEnd: fuld livscyklus — aktivt mandat completes, næste sæsons mandat proposed med FORRIGE fokus", async () => {
  const supabase = makeMandateLifecycleSupabase({
    flagValue: "on",
    seasons: [{ id: "s4", number: 4 }, { id: "s5", number: 5 }],
    relations: [{ id: "rel-1", team_id: "t1", confidence: 70 }],
    mandates: [{ id: "m-active", team_id: "t1", season_id: "s4", status: "active", focus: "youth_development" }],
  });
  const result = await advanceMandateAtSeasonEnd(supabase, {
    teamId: "t1", seasonId: "s4", currentSeasonNumber: 4,
  });

  assert.equal(result.completed_active, true);
  assert.equal(supabase._state.mandates.find((m) => m.id === "m-active").status, "completed");

  const proposed = supabase._state.mandates.find((m) => m.season_id === "s5");
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.focus, "youth_development", "fokus arves fra det AFSLUTTEDE mandat");
});

test("proposeMandateForNewTeam: nyt hold får confidence=50 + mandat for NUVÆRENDE sæson (ikke næste)", async () => {
  const supabase = makeMandateLifecycleSupabase({
    flagValue: "on",
    seasons: [{ id: "s3", number: 3 }],
  });
  const result = await proposeMandateForNewTeam(supabase, {
    teamId: "t-new", currentSeasonNumber: 3,
  });

  assert.equal(result.season_number, 3);
  assert.equal(supabase._state.relations[0].confidence, 50);
  const row = supabase._state.mandates[0];
  assert.equal(row.season_id, "s3");
  assert.equal(row.focus, "balanced", "intet forrige fokus → default balanced");
});

// =============================================================================
// #4839 · Skrive-gaten i beta: motoren bygger skyggedata for ALLE hold, mens
// læse-gaten (loadRelation / Boardroom) stadig kun er åben for beta-testere.
// =============================================================================

test("#4839 applyWeekendSync: beta uden viewer → skriver kvittering for alle hold", async () => {
  const captures = {};
  const supabase = makeShadowSupabase({ flagValue: "beta", captures });
  const result = await applyWeekendSync(supabase, {
    teamId: "t1", seasonId: "s1", evaluation: weekendEvaluation, raceId: "race-9", raceName: "Giro",
  });
  assert.equal(result.confidence, 65);
  assert.equal(captures.relationUpdates.length, 1, "board_relations.updated_at skal bevæge sig i beta");
  assert.equal(captures.events[0].mandate_id, "mandate-1");
});

test("#4839 applySeasonEndSync: beta uden viewer → skriver sæson-slut-kvittering", async () => {
  const captures = {};
  const supabase = makeShadowSupabase({ flagValue: "beta", captures });
  const result = await applySeasonEndSync(supabase, {
    teamId: "t1", seasonId: "s1", seasonNumber: 3, standing: {}, team: teamWithRiders,
    mandateEvaluation: weekendEvaluation,
  });
  assert.ok(result && !result.skipped);
  assert.ok(captures.events.length >= 1);
});

test("#4839 unlockExtraordinaryRequestForTeam: beta uden viewer → låser op", async () => {
  const supabase = makeShadowSupabase({ flagValue: "beta" });
  const result = await unlockExtraordinaryRequestForTeam(supabase, { teamId: "t1", seasonId: "s1" });
  assert.equal(result.unlocked, true);
});

test("#4839 proposeNextMandate: beta uden viewer → foreslår mandat", async () => {
  const supabase = makeMandateLifecycleSupabase({
    flagValue: "beta",
    seasons: [{ id: "season-4", number: 4 }],
  });
  const result = await proposeNextMandate(supabase, { teamId: "t1", targetSeasonNumber: 4, confidence: 60 });
  assert.equal(result.season_number, 4);
  assert.equal(supabase._state.mandates.length, 1);
});

test("#4839 proposeMandateForNewTeam: beta uden viewer → foreslår mandat", async () => {
  const supabase = makeMandateLifecycleSupabase({
    flagValue: "beta",
    seasons: [{ id: "season-4", number: 4 }],
  });
  const result = await proposeMandateForNewTeam(supabase, { teamId: "t1", currentSeasonNumber: 4 });
  assert.equal(result.season_number, 4);
});

test("#4839 kill-switch off slår stadig ALT fra, også motor-skrivninger", async () => {
  const captures = {};
  const off = makeShadowSupabase({ flagValue: "off", captures });
  assert.equal(await applyWeekendSync(off, { teamId: "t1", seasonId: "s1", evaluation: weekendEvaluation }), null);
  assert.equal(await applySeasonEndSync(off, {
    teamId: "t1", seasonId: "s1", seasonNumber: 3, standing: {}, team: teamWithRiders,
    mandateEvaluation: weekendEvaluation,
  }), null);
  assert.equal(await unlockExtraordinaryRequestForTeam(off, { teamId: "t1", seasonId: "s1" }), null);
  assert.equal(captures.relationUpdates.length, 0);
  assert.equal(captures.events.length, 0);

  const offLifecycle = makeMandateLifecycleSupabase({ flagValue: "off", seasons: [{ id: "season-4", number: 4 }] });
  assert.equal(await proposeNextMandate(offLifecycle, { teamId: "t1", targetSeasonNumber: 4, confidence: 60 }), null);
  assert.equal(await advanceMandateAtSeasonEnd(offLifecycle, { teamId: "t1", seasonId: "s3", currentSeasonNumber: 3 }), null);
  assert.equal(await proposeMandateForNewTeam(offLifecycle, { teamId: "t1", currentSeasonNumber: 4 }), null);
  assert.equal(offLifecycle._state.mandates.length, 0);
});

test("#4839 læse-gaten er UÆNDRET: beta + almindelig spiller læser ikke", async () => {
  const supabase = makeSupabase({ flagValue: "beta", relation: { id: "r1", confidence: 66 } });
  assert.equal(await loadRelation(supabase, "team-1"), null, "ingen viewer-flag → ingen læsning");
  assert.equal(await loadRelation(supabase, "team-1", { isBetaTester: false }), null);
  assert.ok(await loadRelation(supabase, "team-1", { isBetaTester: true }), "beta-tester læser stadig");
});

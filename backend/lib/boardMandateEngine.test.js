import test from "node:test";
import assert from "node:assert/strict";

import {
  allocateNegotiationPower,
  applyMilestoneDeltas,
  applySeasonEndSync,
  applyWeekendSync,
  computeRelationUpdateFromEvaluation,
  evaluateDueMilestones,
  evaluateEarlyMilestones,
  loadRelation,
  persistConfidenceChange,
  unlockExtraordinaryRequest,
  unlockExtraordinaryRequestForTeam,
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

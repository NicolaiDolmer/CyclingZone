// #7088 · Bestyrelsens tillid (board_relations.confidence) er ankret, ikke additiv.
//
// Før rettelsen lagde hver løbsafslutning `satisfaction_delta` (et MÅLNIVEAU i
// forhold til sæsonstart) oveni den løbende værdi igen, så tilliden mættede på
// 0 eller 100. Disse tests beviser:
//   1. Gentagne kald med samme evaluering når target og bliver dér (aldrig forbi).
//   2. Sæsonafslutningen lander på anker + delta, ikke oveni den løbende værdi.
//   3. En genkørsel af sæsonafslutningen (repair-stien) lægger intet på igen.
//   4. Ankeret overlever milepæls-skrivningerne og re-ankres ved sæsonskifte.
import test from "node:test";
import assert from "node:assert/strict";

import {
  applySeasonEndSync,
  applyWeekendSync,
  computeRelationUpdateFromEvaluation,
  isRelationSeasonFinalized,
  resolveRelationSeasonAnchor,
  stepConfidenceTowardTarget,
} from "./boardMandateEngine.js";
import { WEEKEND_SATISFACTION_CLAMP, WEEKEND_SATISFACTION_CLAMP_UP } from "./boardWeekendUpdate.js";

const evaluationWithDelta = (delta) => ({
  feedback: { satisfaction_delta: delta },
  goalsMet: 1,
  goals: [1, 2],
  overallScore: 0.6,
  scoreBreakdown: { categories: {} },
});

/** Stateful fake: relationens opdateringer persisteres, så næste kald ser dem. */
function makeStatefulSupabase({ relation, milestones = [] } = {}) {
  const state = {
    relation: { id: "r1", category_scores: {}, confidence_source: {}, ...relation },
    events: [],
    relationWrites: [],
    milestones: milestones.map((m) => ({ ...m })),
  };
  return {
    state,
    from(table) {
      if (table === "app_config") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "on" }, error: null }) }) }) };
      }
      if (table === "board_relations") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...state.relation }, error: null }) }) }),
          update: (payload) => ({
            eq: async () => {
              state.relationWrites.push(payload);
              state.relation = { ...state.relation, ...payload };
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === "board_mandates") {
        return {
          select: () => {
            const chain = { eq: () => chain, maybeSingle: async () => ({ data: { id: "mandate-1" }, error: null }) };
            return chain;
          },
        };
      }
      if (table === "board_vision_milestones") {
        return {
          select: () => {
            const chain = {
              eq: () => chain,
              then: (resolve) => resolve({ data: state.milestones.filter((m) => m.status === "pending"), error: null }),
            };
            return chain;
          },
          update: (payload) => ({
            eq: async (_col, id) => {
              const row = state.milestones.find((m) => m.id === id);
              if (row) Object.assign(row, payload);
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === "board_satisfaction_events") {
        return { insert: async (payload) => { state.events.push(payload); return { data: null, error: null }; } };
      }
      throw new Error(`uventet tabel i test: ${table}`);
    },
  };
}

// ── Rene funktioner ─────────────────────────────────────────────────────────

test("#7088 stepConfidenceTowardTarget: loft pr. kørsel genbruger board_profiles' asymmetriske loft", () => {
  assert.equal(stepConfidenceTowardTarget(50, 90), 50 + WEEKEND_SATISFACTION_CLAMP_UP);
  assert.equal(stepConfidenceTowardTarget(50, 10), 50 - WEEKEND_SATISFACTION_CLAMP);
  assert.equal(stepConfidenceTowardTarget(50, 52), 52, "et skridt under loftet lander præcist på target");
  assert.equal(stepConfidenceTowardTarget(52, 52), 52, "på target flytter intet");
});

test("#7088 gentagne weekend-kald med SAMME delta konvergerer mod target og overskyder aldrig", () => {
  const seasonId = "s4";
  let relation = { confidence: 40, confidence_source: {} };
  const seen = [];
  for (let i = 0; i < 20; i += 1) {
    const update = computeRelationUpdateFromEvaluation({ relation, evaluation: evaluationWithDelta(12), seasonId });
    relation = { confidence: update.confidence, confidence_source: update.confidence_source };
    seen.push(update.confidence);
  }
  // Ankeret er værdien ved første kørsel i sæsonen (40); target = 40 + 12.
  assert.equal(Math.max(...seen), 52, "aldrig forbi target");
  assert.equal(seen.at(-1), 52);
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), "monotont mod target, ingen pendul");
  // Den gamle additive fejl ville have nået 100 efter få kørsler.
  assert.notEqual(seen.at(-1), 100);
});

test("#7088 negativ delta mætter ikke på 0: target = anker + delta", () => {
  let relation = { confidence: 60, confidence_source: {} };
  for (let i = 0; i < 50; i += 1) {
    const update = computeRelationUpdateFromEvaluation({ relation, evaluation: evaluationWithDelta(-2), seasonId: "s4" });
    relation = { confidence: update.confidence, confidence_source: update.confidence_source };
  }
  assert.equal(relation.confidence, 58);
});

test("#7088 idempotent: samme evaluering to gange på target giver samme resultat", () => {
  const relation = {
    confidence: 70,
    confidence_source: { season_anchor: { season_id: "s4", confidence: 62 } },
  };
  const first = computeRelationUpdateFromEvaluation({ relation, evaluation: evaluationWithDelta(8), seasonId: "s4" });
  const second = computeRelationUpdateFromEvaluation({
    relation: { confidence: first.confidence, confidence_source: first.confidence_source },
    evaluation: evaluationWithDelta(8),
    seasonId: "s4",
  });
  assert.equal(first.confidence, 70);
  assert.equal(second.confidence, 70);
  assert.equal(second.receipt.satisfaction_delta, 0);
});

test("#7088 ankeret bevares mellem kørsler og re-ankres ved ny sæson", () => {
  const update = computeRelationUpdateFromEvaluation({
    relation: { confidence: 30, confidence_source: {} }, evaluation: evaluationWithDelta(5), seasonId: "s4",
  });
  assert.deepEqual(update.confidence_source.season_anchor, { season_id: "s4", confidence: 30 });

  const stored = { confidence: 77, confidence_source: { season_anchor: { season_id: "s4", confidence: 30 } } };
  assert.deepEqual(resolveRelationSeasonAnchor(stored, "s4"), { anchor: 30, reanchored: false });
  assert.deepEqual(resolveRelationSeasonAnchor(stored, "s5"), { anchor: 77, reanchored: true });
});

test("#7088 sæsonslut lander på anker + delta, ikke oveni den løbende værdi", () => {
  const relation = {
    confidence: 55, // weekend-kørslerne har bevæget sig mod 40 + 15
    confidence_source: { season_anchor: { season_id: "s4", confidence: 40 } },
  };
  const update = computeRelationUpdateFromEvaluation({
    relation, evaluation: evaluationWithDelta(15), reasonCategory: "season_end", seasonId: "s4",
  });
  assert.equal(update.confidence, 55, "dommen = 40 + 15, ikke 55 + 15");
  assert.equal(update.confidence_source.season_end_season_id, "s4");
  assert.equal(isRelationSeasonFinalized({ confidence_source: update.confidence_source }, "s4"), true);
});

test("#7088 sæsonslut uden weekend-kørsler (intet anker) = én gang anker + delta", () => {
  const update = computeRelationUpdateFromEvaluation({
    relation: { confidence: 50, confidence_source: {} },
    evaluation: evaluationWithDelta(-20),
    reasonCategory: "season_end",
    seasonId: "s4",
  });
  assert.equal(update.confidence, 30);
});

// ── Produktions-indgange (stateful) ─────────────────────────────────────────

test("#7088 applyWeekendSync x30 med samme evaluering: tilliden når target og bliver dér", async () => {
  const supabase = makeStatefulSupabase({ relation: { confidence: 20 } });
  for (let i = 0; i < 30; i += 1) {
    await applyWeekendSync(supabase, { teamId: "t1", seasonId: "s4", evaluation: evaluationWithDelta(25) });
  }
  assert.equal(supabase.state.relation.confidence, 45);
  assert.ok(supabase.state.relationWrites.every((w) => w.confidence <= 45));
  // Kvitteringerne summer til præcis den samlede bevægelse.
  const sum = supabase.state.events.reduce((acc, e) => acc + e.satisfaction_delta, 0);
  assert.equal(sum, 25);
});

test("#7088 sæsonslut efter konvergerede weekends lægger ikke delta på igen", async () => {
  const supabase = makeStatefulSupabase({ relation: { confidence: 50 } });
  for (let i = 0; i < 10; i += 1) {
    await applyWeekendSync(supabase, { teamId: "t1", seasonId: "s4", evaluation: evaluationWithDelta(10) });
  }
  assert.equal(supabase.state.relation.confidence, 60);

  const result = await applySeasonEndSync(supabase, {
    teamId: "t1", seasonId: "s4", seasonNumber: 4, standing: {}, team: { riders: [] },
    mandateEvaluation: evaluationWithDelta(10),
  });
  assert.equal(result.confidence, 60, "sæsonslut = anker (50) + delta (10), ikke 60 + 10");
  const seasonEndReceipt = supabase.state.events.at(-1);
  assert.equal(seasonEndReceipt.reason_category, "season_end");
  assert.equal(seasonEndReceipt.satisfaction_delta, 0);
});

test("#7088 genkørsel af sæsonslut (repair-stien) og sene weekend-kørsler flytter intet", async () => {
  const supabase = makeStatefulSupabase({
    relation: { confidence: 60, confidence_source: { season_anchor: { season_id: "s4", confidence: 50 } } },
  });
  const args = {
    teamId: "t1", seasonId: "s4", seasonNumber: 4, standing: {}, team: { riders: [] },
    mandateEvaluation: evaluationWithDelta(10),
  };
  await applySeasonEndSync(supabase, args);
  const writesAfterFirst = supabase.state.relationWrites.length;
  await applySeasonEndSync(supabase, args);
  assert.equal(supabase.state.relation.confidence, 60);
  assert.equal(supabase.state.relationWrites.length, writesAfterFirst, "anden kørsel skriver intet");

  const late = await applyWeekendSync(supabase, { teamId: "t1", seasonId: "s4", evaluation: evaluationWithDelta(40) });
  assert.deepEqual(late, { skipped: "season_finalized" });
  assert.equal(supabase.state.relation.confidence, 60);
});

test("#7088 milepæle lægges oveni dommen, ankeret overlever, og næste sæson ankres på resultatet", async () => {
  const supabase = makeStatefulSupabase({
    relation: { confidence: 60, confidence_source: { season_anchor: { season_id: "s4", confidence: 50 } } },
    milestones: [{
      id: "m1",
      milestone_key: "3yr:s4:stage_wins:5:0",
      goal: {
        type: "stage_wins", target: 5, weight: 1, category: "results",
        importance: "required", satisfaction_bonus: 10, satisfaction_penalty: 8,
      },
      target_season_number: 4,
      origin: "3yr",
      weight: 1,
      is_headline: false,
      status: "pending",
    }],
  });
  const result = await applySeasonEndSync(supabase, {
    teamId: "t1", seasonId: "s4", seasonNumber: 4,
    standing: { stage_wins: 9 }, team: { riders: [] },
    mandateEvaluation: evaluationWithDelta(10),
    milestoneContexts: [{ planType: "3yr", context: { cumulativeStats: { stageWins: 9 } } }],
  });
  assert.equal(result.milestones_evaluated, 1);
  const afterMilestone = supabase.state.relation.confidence;
  assert.equal(afterMilestone, result.confidence);
  assert.notEqual(afterMilestone, 60, "milepælen flyttede tilliden");
  // Milepæls-skrivningen bevarer ankeret og "dommen er afsagt"-mærket.
  assert.equal(supabase.state.relation.confidence_source.season_end_season_id, "s4");
  assert.deepEqual(supabase.state.relation.confidence_source.season_anchor, { season_id: "s4", confidence: 50 });

  // Ny sæson: første weekend ankrer på værdien efter dom + milepæl.
  await applyWeekendSync(supabase, { teamId: "t1", seasonId: "s5", evaluation: evaluationWithDelta(0) });
  assert.equal(supabase.state.relation.confidence, afterMilestone);
  assert.deepEqual(supabase.state.relation.confidence_source.season_anchor, { season_id: "s5", confidence: afterMilestone });
});

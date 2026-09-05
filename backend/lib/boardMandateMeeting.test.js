import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBoardMeetingPayload,
  buildVisionSlotProposal,
  MandateSignConflictError,
  resolveMeetingRequestOutcome,
  signMandate,
  writeLegacyOneYearBoard,
} from "./boardMandateMeeting.js";
import { MandateAdjustmentBudgetError } from "./boardMandate.js";
import { buildGoalKey } from "./boardGoals.js";

// ── Fake-supabase: samme mønster som boardMandateEngine.test.js, udvidet med
// de tabeller boardMandateMeeting.js læser/skriver (teams, riders,
// season_standings, team_board_members, board_vision_milestones,
// board_satisfaction_events, board_profiles). ────────────────────────────────
function makeMeetingSupabase({
  flagValue = "on",
  mandates = [],
  relations = [],
  members = [],
  team = { id: "t1", balance: 0, sponsor_income: 100, team_dna_key: null },
  boardProfiles = [],
} = {}) {
  const state = { mandates: [...mandates], relations: [...relations], boardProfiles: [...boardProfiles], events: [], milestones: [] };

  function matchAll(row, filters) {
    return Object.entries(filters).every(([k, v]) => row[k] === v);
  }
  function selectChain(rows) {
    const filters = {};
    const chain = {
      eq(col, value) { filters[col] = value; return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle: async () => {
        const list = rows.filter((r) => matchAll(r, filters));
        return { data: list[0] ?? null, error: null };
      },
      single: async () => {
        const list = rows.filter((r) => matchAll(r, filters));
        return { data: list[0] ?? null, error: null };
      },
    };
    return chain;
  }

  return {
    _state: state,
    from(table) {
      if (table === "app_config") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: flagValue }, error: null }) }) }) };
      }
      if (table === "teams") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: team, error: null }) }) }) };
      }
      if (table === "riders") {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      }
      if (table === "season_standings") {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return { select: () => chain };
      }
      if (table === "team_board_members") {
        return { select: () => ({ eq: async () => ({ data: members, error: null }) }) };
      }
      if (table === "seasons") {
        // buildBoardRoomPayload henter (a) den AKTIVE sæson og (b) hele
        // sæson-listen (til sinceSeason) — begge tomme/no-op er fint her.
        const chain = { eq: () => chain, order: () => ({ error: null, data: [] }), maybeSingle: async () => ({ data: null, error: null }) };
        return { select: () => chain };
      }
      if (table === "loans") {
        // .select("id", { count: "exact", head: true }).eq(...).eq(...) — awaitet direkte.
        const chain = { eq: () => chain, then: (resolve) => resolve({ count: 0, error: null }) };
        return { select: () => chain };
      }
      if (table === "board_relations") {
        return { select: () => selectChain(state.relations) };
      }
      if (table === "board_mandates") {
        return {
          select: () => selectChain(state.mandates),
          update(payload) {
            const filters = {};
            const chain = {
              eq(col, value) { filters[col] = value; return chain; },
              then: undefined,
            };
            chain.__apply = () => {
              const matched = state.mandates.filter((m) => matchAll(m, filters));
              matched.forEach((m) => Object.assign(m, payload));
              return matched;
            };
            // signMandate awaiter direkte på .eq(...).eq(...) (ingen .select()) —
            // simulér ved at gøre chain "thenable".
            chain.then = (resolve) => resolve({ error: null, data: chain.__apply() });
            return chain;
          },
        };
      }
      if (table === "board_vision_milestones") {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: state.milestones.find((m) => m.slot_open) ?? null, error: null }),
          then: (resolve) => resolve({ data: state.milestones, error: null }),
          insert: async (payload) => { state.milestones.push({ id: `vm-${state.milestones.length + 1}`, ...payload }); return { error: null }; },
          update(payload) {
            const filters = {};
            const upd = {
              eq(col, value) { filters[col] = value; return upd; },
              then: (resolve) => {
                state.milestones.filter((m) => matchAll(m, filters)).forEach((m) => Object.assign(m, payload));
                resolve({ error: null });
              },
            };
            return upd;
          },
        };
        return { select: () => chain };
      }
      if (table === "board_satisfaction_events") {
        const chain = {
          eq: () => chain,
          or: () => chain,
          order: () => chain,
          limit: () => chain,
          then: (resolve) => resolve({ data: state.events, error: null }),
        };
        return {
          select: () => chain,
          insert: async (payload) => { state.events.push(payload); return { error: null }; },
        };
      }
      if (table === "board_profiles") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.boardProfiles[0] ?? null, error: null }) }) }) }),
          upsert: (payload) => ({
            select: () => ({
              single: async () => {
                state.boardProfiles.push({ id: `bp-${state.boardProfiles.length + 1}`, ...payload });
                return { data: { id: `bp-${state.boardProfiles.length}` }, error: null };
              },
            }),
          }),
        };
      }
      // #4557 (overblik + faner) · boardRoom.js laeser nu ogsaa holdets lag
      // 6-raekker (bonustilbuddet) naar den bygger payloaden signMandate
      // returnerer. Ingen bonus-raekker i moede-fixturen: tom liste.
      if (table === "board_consequences") {
        const chain = {
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve) => resolve({ data: [], error: null }),
        };
        return { select: () => chain };
      }
      throw new Error(`uventet tabel i test: ${table}`);
    },
  };
}

const sampleGoal = { type: "top_n_finish", target: 4, satisfaction_bonus: 10, satisfaction_penalty: 6, owner_archetype_key: null };

// ── buildBoardMeetingPayload ─────────────────────────────────────────────────

test("buildBoardMeetingPayload: intet proposed mandat → { available: false }", async () => {
  const supabase = makeMeetingSupabase({ mandates: [] });
  const payload = await buildBoardMeetingPayload({ supabase, teamId: "t1" });
  assert.deepEqual(payload, { available: false });
});

test("buildBoardMeetingPayload: proposed mandat → goals bærer Easier/Keep/Stretch-options", async () => {
  const supabase = makeMeetingSupabase({
    mandates: [{
      id: "m1", team_id: "t1", season_number: 4, focus: "balanced",
      status: "proposed", goals: [sampleGoal],
      adjustments_allowed: 2, adjustments_used: 0, request_used: false,
      auto_accept_deadline: "2026-09-08T00:00:00Z",
      source: { negotiation_power: { trust_tier: "standard", counteroffer_generosity: 1.0 } },
    }],
    relations: [{ team_id: "t1", confidence: 60 }],
  });
  const payload = await buildBoardMeetingPayload({ supabase, teamId: "t1" });
  assert.equal(payload.available, true);
  assert.equal(payload.mandate.goals.length, 1);
  const [goal] = payload.mandate.goals;
  assert.equal(goal.goalKey, buildGoalKey(sampleGoal));
  assert.equal(goal.options.keep.target, 4);
  assert.ok(goal.options.easier);
  assert.ok(goal.options.stretch);
});

// ── resolveMeetingRequestOutcome (§4.3-garantien) ────────────────────────────

test("resolveMeetingRequestOutcome: en afvist anmodning bliver ALDRIG et rent 'rejected' — altid pakket som counter", () => {
  const mandate = { goals: [sampleGoal], focus: "balanced" };
  const relation = { confidence: 20 }; // under lower_results_pressure's tærskel (35) → afvises
  const outcome = resolveMeetingRequestOutcome({
    mandate, relation, requestType: "lower_results_pressure", team: {}, standing: null, context: {},
  });
  // `meeting_outcome` er kontrakten kaldere (routen, frontend) skal læse —
  // den er ALDRIG "rejected" (spec §4.3: et afslag er altid pakket som et
  // modtilbud). Det rå `outcome`-felt fra resolveBoardRequest bevares kun
  // som internt diagnostik-spor.
  assert.equal(outcome.meeting_outcome, "counter");
  assert.notEqual(outcome.meeting_outcome, "rejected");
  assert.equal(outcome.counter_kind, "tradeoff", "lower_results_pressure har en kendt TRADEOFF_PAYLOADS_BY_REQUEST-post");
});

// ── signMandate ───────────────────────────────────────────────────────────────

test("signMandate: kill-switch off → null", async () => {
  const supabase = makeMeetingSupabase({ flagValue: "off" });
  const result = await signMandate(supabase, { teamId: "t1", mandateId: "m1" });
  assert.equal(result, null);
});

test("signMandate: idempotent — allerede active → intet skrives igen, returnerer Boardroom-payload", async () => {
  const supabase = makeMeetingSupabase({
    mandates: [{ id: "m1", team_id: "t1", season_number: 4, status: "active", goals: [sampleGoal], focus: "balanced" }],
    relations: [{ id: "rel-1", team_id: "t1", confidence: 60, category_scores: {} }],
  });
  const before = JSON.stringify(supabase._state.mandates);
  const payload = await signMandate(supabase, { teamId: "t1", mandateId: "m1" });
  assert.equal(JSON.stringify(supabase._state.mandates), before, "ingen skrivning ved allerede-active");
  assert.ok(payload, "returnerer stadig en payload (Boardroom-shaped)");
});

test("signMandate: status hverken proposed eller active → MandateSignConflictError", async () => {
  const supabase = makeMeetingSupabase({
    mandates: [{ id: "m1", team_id: "t1", status: "completed" }],
  });
  await assert.rejects(
    () => signMandate(supabase, { teamId: "t1", mandateId: "m1" }),
    (err) => err instanceof MandateSignConflictError
  );
});

test("signMandate: budget-overskridelse propagerer MandateAdjustmentBudgetError", async () => {
  const goalA = { type: "top_n_finish", target: 4, satisfaction_bonus: 10, satisfaction_penalty: 6 };
  const goalB = { type: "stage_wins", target: 2, satisfaction_bonus: 10, satisfaction_penalty: 4 };
  const supabase = makeMeetingSupabase({
    mandates: [{
      id: "m1", team_id: "t1", season_number: 4, status: "proposed", focus: "balanced",
      goals: [goalA, goalB], adjustments_allowed: 1,
      source: { negotiation_power: { counteroffer_generosity: 1.0 } },
    }],
    relations: [{ id: "rel-1", team_id: "t1", confidence: 60 }],
  });
  await assert.rejects(
    () => signMandate(supabase, {
      teamId: "t1",
      mandateId: "m1",
      adjustments: [
        { goalKey: buildGoalKey(goalA), choice: "stretch" },
        { goalKey: buildGoalKey(goalB), choice: "easier" },
      ],
    }),
    (err) => err instanceof MandateAdjustmentBudgetError && err.used === 2 && err.allowed === 1
  );
});

test("signMandate: Keep-på-alt (auto-accept-formen) underskriver uden justeringer + dual-writer til board_profiles", async () => {
  const supabase = makeMeetingSupabase({
    mandates: [{
      id: "m1", team_id: "t1", season_number: 4, season_id: "s4", status: "proposed", focus: "balanced",
      goals: [sampleGoal], adjustments_allowed: 2,
      source: { negotiation_power: { counteroffer_generosity: 1.0 } },
    }],
    relations: [{ id: "rel-1", team_id: "t1", confidence: 55, category_scores: {} }],
    members: [{ team_id: "t1", archetype_key: "sponsoraten", is_chairman: true }],
  });
  const payload = await signMandate(supabase, {
    teamId: "t1", mandateId: "m1", adjustments: [], request: null, visionSlot: null, signedVia: "auto_accept",
  });
  assert.ok(payload);
  const mandate = supabase._state.mandates.find((m) => m.id === "m1");
  assert.equal(mandate.status, "active");
  assert.equal(mandate.adjustments_used, 0);
  assert.equal(mandate.request_used, false);
  assert.ok(mandate.signed_at);
  assert.equal(supabase._state.boardProfiles.length, 1, "dual-write til board_profiles (1yr) sket");
  assert.equal(supabase._state.boardProfiles[0].plan_type, "1yr");
  assert.ok(supabase._state.events.some((e) => e.reason_category === "mandate.auto_signed"));
});

// ── writeLegacyOneYearBoard (dual-write) ────────────────────────────────────

test("writeLegacyOneYearBoard: bevarer eksisterende satisfaction/budget_modifier ved fornyelse", async () => {
  const supabase = makeMeetingSupabase({
    boardProfiles: [{ id: "bp-existing", satisfaction: 72, budget_modifier: 1.1 }],
  });
  await writeLegacyOneYearBoard(supabase, {
    teamId: "t1", seasonId: "s4", seasonNumber: 4, focus: "balanced", goals: [sampleGoal], team: { balance: 1000, sponsor_income: 200 },
  });
  const written = supabase._state.boardProfiles[supabase._state.boardProfiles.length - 1];
  assert.equal(written.plan_type, "1yr");
  assert.equal(written.negotiation_status, "completed");
});

// ── buildVisionSlotProposal (A7) ────────────────────────────────────────────

test("buildVisionSlotProposal: intet åbent slot → null", () => {
  assert.equal(buildVisionSlotProposal({ openSlot: null }), null);
});

test("buildVisionSlotProposal: mål-sæson = slottets oprindelige sæson når den stadig ligger i fremtiden", () => {
  const proposal = buildVisionSlotProposal({
    openSlot: { id: "vm-1", origin: "3yr", target_season_number: 7 },
    focus: "balanced",
    team: null, riders: [], standing: null,
    currentSeasonNumber: 4,
  });
  assert.ok(proposal);
  assert.equal(proposal.target_season_number, 7);
  assert.equal(proposal.origin, "3yr");
});

test("buildVisionSlotProposal: sæsonen er allerede passeret → næste ledige (nu + plan-varighed)", () => {
  const proposal = buildVisionSlotProposal({
    openSlot: { id: "vm-1", origin: "3yr", target_season_number: 3 },
    focus: "balanced",
    team: null, riders: [], standing: null,
    currentSeasonNumber: 6,
  });
  assert.equal(proposal.target_season_number, 9, "6 (nu) + 3 (3yr-varighed)");
});

// ── #4839: signMandate — skrive-gate for cronen, læse-gate for manageren ─────

test("#4839 signMandate: beta + engineWrite (cron) → underskriver; beta uden viewer/engineWrite → null", async () => {
  const makeSupabase = () => makeMeetingSupabase({
    flagValue: "beta",
    mandates: [{
      id: "m1", team_id: "t1", season_number: 4, season_id: "s4", status: "proposed", focus: "balanced",
      goals: [sampleGoal], adjustments_allowed: 2,
      source: { negotiation_power: { counteroffer_generosity: 1.0 } },
    }],
    relations: [{ id: "rel-1", team_id: "t1", confidence: 55, category_scores: {} }],
    members: [{ team_id: "t1", archetype_key: "sponsoraten", is_chairman: true }],
  });

  const cronSupabase = makeSupabase();
  const payload = await signMandate(cronSupabase, {
    teamId: "t1", mandateId: "m1", adjustments: [], request: null, visionSlot: null,
    engineWrite: true, signedVia: "auto_accept",
  });
  assert.ok(payload);
  assert.equal(cronSupabase._state.mandates.find((m) => m.id === "m1").status, "active");

  const managerSupabase = makeSupabase();
  assert.equal(
    await signMandate(managerSupabase, { teamId: "t1", mandateId: "m1" }),
    null,
    "en spiller der ikke må se Boardroom i beta må heller ikke underskrive",
  );
  assert.equal(managerSupabase._state.mandates.find((m) => m.id === "m1").status, "proposed");
});

test("#4839 signMandate: off + engineWrite → stadig null (kill-switchen stopper alt)", async () => {
  const supabase = makeMeetingSupabase({ flagValue: "off" });
  assert.equal(await signMandate(supabase, { teamId: "t1", mandateId: "m1", engineWrite: true }), null);
});

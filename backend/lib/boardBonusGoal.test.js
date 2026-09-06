import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAcceptedBonusGoal,
  appendBonusGoalToActiveMandate,
  appendBonusGoalToBoardProfile,
  buildBonusExtraGoal,
  hasBonusGoalForOffer,
} from "./boardBonusGoal.js";
import { buildBoardRoomPayload } from "./boardRoom.js";

// #4856 · Regressionsdækning for kontraktsprækken: accept af et bonustilbud
// skrev ekstra-målet KUN til `board_profiles.current_goals`, mens Boardroom
// læser mål fra `board_mandates.goals` — så Bonus-målet blev aldrig vist.
// Testene nedenfor kører BEGGE ender: skrivningen (applyAcceptedBonusGoal) og
// læsningen (buildBoardRoomPayload) mod SAMME fake-supabase, så en fremtidig
// omskrivning af den ene ende ikke kan gå ubemærket forbi den anden.

// ── Fake-supabase med update-støtte ──────────────────────────────────────────
// Samme query-builder-mønster som boardRoom.test.js/boardMandateEngine.test.js,
// udvidet med .update() (som muterer rækkerne in-place) fordi denne test skal
// læse sine egne skrivninger tilbage.
function makeQueryBuilder(rows, { mode = "select", patch = null } = {}) {
  let filtered = [...rows];
  const builder = {
    eq(col, value) {
      filtered = filtered.filter((r) => r[col] === value);
      return builder;
    },
    in(col, values) {
      filtered = filtered.filter((r) => values.includes(r[col]));
      return builder;
    },
    or() {
      return builder;
    },
    order(col, opts = {}) {
      const ascending = opts.ascending !== false;
      filtered = [...filtered].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return ascending ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
      });
      return builder;
    },
    limit(n) {
      filtered = filtered.slice(0, n);
      return builder;
    },
    select() {
      return builder;
    },
    apply() {
      if (mode !== "update") return;
      for (const row of filtered) Object.assign(row, patch);
    },
    maybeSingle: async () => {
      builder.apply();
      return { data: filtered[0] ?? null, error: null };
    },
    single: async () => {
      builder.apply();
      return filtered[0]
        ? { data: filtered[0], error: null }
        : { data: null, error: { code: "PGRST116" } };
    },
    then(resolve, reject) {
      builder.apply();
      return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

function makeSupabase(tables) {
  return {
    from(table) {
      const rows = tables[table] || (tables[table] = []);
      return {
        select: () => makeQueryBuilder(rows),
        update: (patch) => makeQueryBuilder(rows, { mode: "update", patch }),
      };
    },
  };
}

const TEAM_ID = "team-1";
const OFFER_ID = "offer-1";
const EXTRA_GOAL = { type: "stage_wins", target: 2, label: "Two extra stage wins" };

const flagOn = async () => true;
const flagOff = async () => false;

function baseTables(overrides = {}) {
  return {
    board_relations: [{ id: "rel-1", team_id: TEAM_ID, confidence: 60, category_scores: {} }],
    team_board_members: [
      { team_id: TEAM_ID, archetype_key: "sponsoraten", selection_kind: "identity", alignment_score: 3, is_chairman: true },
      { team_id: TEAM_ID, archetype_key: "resultatjaegeren", selection_kind: "identity", alignment_score: 2, is_chairman: false },
    ],
    board_mandates: [{
      id: "mand-1",
      team_id: TEAM_ID,
      season_number: 3,
      status: "active",
      signed_at: "2026-08-01T00:00:00Z",
      goals: [{ type: "min_riders", target: 20, category: "economy", importance: "required" }],
    }],
    board_vision_milestones: [],
    teams: [{ id: TEAM_ID, team_dna_key: null, created_at: "2026-08-15T00:00:00Z", balance: 100000 }],
    seasons: [
      { id: "s3", number: 3, status: "active", start_date: "2026-07-31T00:00:00Z" },
    ],
    season_standings: [],
    riders: [],
    loans: [],
    board_satisfaction_events: [],
    board_consequences: [],
    board_profiles: [{
      id: "board-1",
      team_id: TEAM_ID,
      plan_type: "1yr",
      negotiation_status: "completed",
      current_goals: JSON.stringify([{ type: "min_riders", target: 20 }]),
    }],
    ...overrides,
  };
}

// ── Kernen i #4856 ───────────────────────────────────────────────────────────

test("#4856 accept skriver ekstra-maalet til board_mandates.goals (ikke kun board_profiles)", async () => {
  const tables = baseTables();
  const supabase = makeSupabase(tables);

  const result = await applyAcceptedBonusGoal({
    supabase,
    teamId: TEAM_ID,
    offerId: OFFER_ID,
    extraGoal: EXTRA_GOAL,
    isMandateModelEnabled: flagOn,
  });

  assert.equal(result.mandate.written, true);
  assert.equal(result.mandate.mandateId, "mand-1");

  const mandateGoals = tables.board_mandates[0].goals;
  assert.equal(mandateGoals.length, 2);
  const bonusGoal = mandateGoals.find((g) => g.source === "bonus_offer");
  assert.ok(bonusGoal, "mandatet skal baere bonus-maalet");
  assert.equal(bonusGoal.type, "stage_wins");
  assert.equal(bonusGoal.target, 2);
  assert.equal(bonusGoal.cumulative, false);
  assert.equal(bonusGoal.bonus_offer_id, OFFER_ID);
});

test("#4856 Boardroom-laesestien viser Bonus-maalet efter accept (end-to-end mod samme data)", async () => {
  const tables = baseTables();
  const supabase = makeSupabase(tables);

  const before = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });
  assert.equal(before.mandate.goals.length, 1);
  assert.equal(before.mandate.goals.some((g) => g.isBonus), false);

  await applyAcceptedBonusGoal({
    supabase,
    teamId: TEAM_ID,
    offerId: OFFER_ID,
    extraGoal: EXTRA_GOAL,
    isMandateModelEnabled: flagOn,
  });

  const after = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });
  assert.equal(after.mandate.goals.length, 2);
  const shown = after.mandate.goals.filter((g) => g.isBonus);
  assert.equal(shown.length, 1, "Boardroom skal vise praecis ét bonus-maal");
  assert.equal(shown[0].labelKey, "goalType.stage_wins");
  assert.equal(shown[0].labelParams.target, 2);
});

test("#4856 den gamle sti er uaendret: board_profiles.current_goals faar stadig maalet", async () => {
  const tables = baseTables();
  const supabase = makeSupabase(tables);

  const result = await applyAcceptedBonusGoal({
    supabase,
    teamId: TEAM_ID,
    offerId: OFFER_ID,
    extraGoal: EXTRA_GOAL,
    isMandateModelEnabled: flagOn,
  });

  assert.equal(result.profile.written, true);
  const profileGoals = JSON.parse(tables.board_profiles[0].current_goals);
  assert.equal(profileGoals.length, 2);
  assert.equal(profileGoals[1].source, "bonus_offer");
  assert.equal(profileGoals[1].label, "Two extra stage wins");
});

test("#4856 flag off: kun den gamle sti skrives (bit-for-bit adfaerd som foer)", async () => {
  const tables = baseTables();
  const supabase = makeSupabase(tables);

  const result = await applyAcceptedBonusGoal({
    supabase,
    teamId: TEAM_ID,
    offerId: OFFER_ID,
    extraGoal: EXTRA_GOAL,
    isMandateModelEnabled: flagOff,
  });

  assert.equal(result.profile.written, true);
  assert.equal(result.mandate.written, false);
  assert.equal(result.mandate.reason, "flag_off");
  assert.equal(tables.board_mandates[0].goals.length, 1);
});

test("#4856 dobbelt accept (retry/dobbeltklik) giver ikke to bonus-maal", async () => {
  const tables = baseTables();
  const supabase = makeSupabase(tables);

  const args = {
    supabase,
    teamId: TEAM_ID,
    offerId: OFFER_ID,
    extraGoal: EXTRA_GOAL,
    isMandateModelEnabled: flagOn,
  };
  await applyAcceptedBonusGoal(args);
  const second = await applyAcceptedBonusGoal(args);

  assert.equal(second.mandate.written, false);
  assert.equal(second.mandate.reason, "already_present");
  assert.equal(second.profile.written, false);
  assert.equal(second.profile.reason, "already_present");
  assert.equal(tables.board_mandates[0].goals.filter((g) => g.source === "bonus_offer").length, 1);
  assert.equal(JSON.parse(tables.board_profiles[0].current_goals).filter((g) => g.source === "bonus_offer").length, 1);
});

test("#4856 to FORSKELLIGE tilbud giver to bonus-maal", async () => {
  const tables = baseTables();
  const supabase = makeSupabase(tables);

  await applyAcceptedBonusGoal({
    supabase, teamId: TEAM_ID, offerId: "offer-a", extraGoal: EXTRA_GOAL, isMandateModelEnabled: flagOn,
  });
  await applyAcceptedBonusGoal({
    supabase,
    teamId: TEAM_ID,
    offerId: "offer-b",
    extraGoal: { type: "gc_wins", target: 1, label: "One GC win" },
    isMandateModelEnabled: flagOn,
  });

  assert.equal(tables.board_mandates[0].goals.filter((g) => g.source === "bonus_offer").length, 2);
});

test("#4856 intet aktivt mandat: profilen skrives, mandat-skrivningen er en ren no-op", async () => {
  const tables = baseTables({ board_mandates: [] });
  const supabase = makeSupabase(tables);

  const result = await applyAcceptedBonusGoal({
    supabase, teamId: TEAM_ID, offerId: OFFER_ID, extraGoal: EXTRA_GOAL, isMandateModelEnabled: flagOn,
  });

  assert.equal(result.profile.written, true);
  assert.equal(result.mandate.written, false);
  assert.equal(result.mandate.reason, "no_active_mandate");
});

test("#4856 et COMPLETED mandat roeres ikke (kun status='active')", async () => {
  const tables = baseTables();
  tables.board_mandates[0].status = "completed";
  const supabase = makeSupabase(tables);

  const result = await appendBonusGoalToActiveMandate({
    supabase,
    teamId: TEAM_ID,
    goal: buildBonusExtraGoal({ extraGoal: EXTRA_GOAL, offerId: OFFER_ID }),
    offerId: OFFER_ID,
  });

  assert.equal(result.written, false);
  assert.equal(result.reason, "no_active_mandate");
  assert.equal(tables.board_mandates[0].goals.length, 1);
});

// ── #3574-baselinen overlever flytningen fra api.js ──────────────────────────

test("#3574 signature_rider faar baseline = stjerne-antal paa accept-tidspunktet, i BEGGE tabeller", async () => {
  const tables = baseTables({
    riders: [
      { id: "r1", team_id: TEAM_ID, overall: 82 },
      { id: "r2", team_id: TEAM_ID, overall: 60 },
    ],
  });
  const supabase = makeSupabase(tables);

  const result = await applyAcceptedBonusGoal({
    supabase,
    teamId: TEAM_ID,
    offerId: OFFER_ID,
    extraGoal: { type: "signature_rider", target: 1, label: "One more star" },
    isMandateModelEnabled: flagOn,
  });

  assert.equal(typeof result.goal.baseline, "number");
  const mandateBonus = tables.board_mandates[0].goals.find((g) => g.source === "bonus_offer");
  const profileBonus = JSON.parse(tables.board_profiles[0].current_goals).find((g) => g.source === "bonus_offer");
  assert.equal(mandateBonus.baseline, result.goal.baseline);
  assert.equal(profileBonus.baseline, result.goal.baseline);
});

test("#3574 monument_podium faar baseline fra goal-konteksten, maalt mod 1yr-boardet", async () => {
  const tables = baseTables();
  const supabase = makeSupabase(tables);
  const seenBoardIds = [];

  const result = await applyAcceptedBonusGoal({
    supabase,
    teamId: TEAM_ID,
    offerId: OFFER_ID,
    extraGoal: { type: "monument_podium", target: 1, label: "One monument podium" },
    isMandateModelEnabled: flagOn,
    loadGoalContext: async ({ boardId }) => {
      seenBoardIds.push(boardId);
      return { cumulativeMonumentPodiums: 3 };
    },
  });

  assert.deepEqual(seenBoardIds, ["board-1"]);
  assert.equal(result.goal.baseline, 3);
  assert.equal(tables.board_mandates[0].goals.find((g) => g.source === "bonus_offer").baseline, 3);
});

test("maaltyper uden beholdning baerer ingen baseline (uaendret for DNA-tradition-maal)", async () => {
  const tables = baseTables();
  const supabase = makeSupabase(tables);

  const result = await applyAcceptedBonusGoal({
    supabase, teamId: TEAM_ID, offerId: OFFER_ID, extraGoal: EXTRA_GOAL, isMandateModelEnabled: flagOn,
  });

  assert.equal(result.goal.baseline, null);
});

// ── Rene enheds-asserts ──────────────────────────────────────────────────────

test("hasBonusGoalForOffer matcher legacy-maal uden bonus_offer_id paa type+target", () => {
  const legacy = [{ type: "stage_wins", target: 2, source: "bonus_offer" }];
  assert.equal(hasBonusGoalForOffer(legacy, { offerId: OFFER_ID, extraGoal: EXTRA_GOAL }), true);
  assert.equal(
    hasBonusGoalForOffer(legacy, { offerId: OFFER_ID, extraGoal: { type: "gc_wins", target: 2 } }),
    false,
  );
  assert.equal(hasBonusGoalForOffer(null, { offerId: OFFER_ID, extraGoal: EXTRA_GOAL }), false);
});

test("appendBonusGoalToBoardProfile: intet 1yr-board -> no-op uden kast", async () => {
  const tables = baseTables({ board_profiles: [] });
  const supabase = makeSupabase(tables);
  const result = await appendBonusGoalToBoardProfile({
    supabase,
    teamId: TEAM_ID,
    goal: buildBonusExtraGoal({ extraGoal: EXTRA_GOAL, offerId: OFFER_ID }),
    offerId: OFFER_ID,
  });
  assert.equal(result.written, false);
  assert.equal(result.reason, "no_board_profile");
});

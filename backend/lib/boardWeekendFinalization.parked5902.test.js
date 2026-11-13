// #5902 · Parkerede hold (#4592) er helt ude af den ugentlige bestyrelseskørsel.
// =============================================================================
// Ejer-regel 23/9 (#4592) + ejer-beslutning 4/10 (#5902, A): et parkeret hold
// får ingen bestyrelsesdom og ingen konsekvenser; bestyrelsen fryses, til holdet
// er tilbage. Sæsonafslutningen overholdt det, den ugentlige kørsel gjorde ikke:
// halvsæsonens konsekvens-tjek ramte parkerede hold i prod 12/11.
//
// Testene kører hold-løkken mod den delte, projektion-aware fake. Fake'en
// leverer kun de kolonner koden beder om, så glemmer hold-selectet `parked_at`,
// ser isParkedTeam et manglende felt (= ikke parkeret) og testene fejler.
//
// Integrationstesten bruger den ÆGTE konsekvens-motor (boardConsequences.js),
// så både "0 rækker for parkeret" og "aktivt hold uændret" måles på de rækker,
// motoren faktisk skriver (board_consequences, transfer_listings, beskeder).
// Tærskler læses fra CONSEQUENCE_CONSTANTS, aldrig som tal i testen.

import test from "node:test";
import assert from "node:assert/strict";

import { processBoardWeekendFinalization } from "./boardWeekendFinalization.js";
import { CHECKPOINT_KINDS } from "./boardWeekendUpdate.js";
import { CONSEQUENCE_CONSTANTS, CONSEQUENCE_LAYERS } from "./boardConsequences.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

const T = CONSEQUENCE_CONSTANTS.SATISFACTION_THRESHOLDS;
// Under alle straffe-tærskler (lønloft, købsstop, tvangssalg, sponsor-exit).
const CRISIS_SATISFACTION = T.SPONSOR_PULLOUT - 1;

const PARKED = "team-parked";
const ACTIVE = "team-active";

// Ingen krydsning af midten: almindelig weekend.
const WEEKEND_SEASON = { id: "season-5", number: 5, status: "active", race_days_completed: 12, race_days_total: 60 };
// Krydser midten (previousRaceDaysCompleted = 24 → 30 af 60): halvsæsonens tjek.
const MIDSEASON_SEASON = { ...WEEKEND_SEASON, race_days_completed: 30 };
const RACE = { id: "race-1", name: "Testløb", league_division_id: "pool-a" };
// Fast ur (AGENTS.md hard rule 16): lønloftets nybegynder-grace regnes mod `now`.
const NOW = new Date("2026-11-12T14:00:00.000Z");

/** @param {string} id @param {Record<string, any>} [extra] */
function makeTeam(id, extra = {}) {
  return {
    id, user_id: `user-${id}`, name: `Hold ${id}`, division: 3,
    sponsor_income: 1_000_000, balance: 100_000, season_1_identity_basis: null, team_dna_key: null,
    // Gammelt hold: ingen nybegynder-grace på lønloftet.
    created_at: "2026-01-01T00:00:00.000Z",
    is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
    parked_at: null,
    league_division_id: "pool-a",
    ...extra,
  };
}

/** @param {string} id @param {string} teamId @param {Record<string, any>} [extra] */
function makeBoard(id, teamId, extra = {}) {
  return {
    id, team_id: teamId, plan_type: "1yr", focus: "balanced",
    satisfaction: CRISIS_SATISFACTION, budget_modifier: 1.0, current_goals: [],
    negotiation_status: "completed", is_baseline: false,
    seasons_completed: 0, cumulative_stage_wins: 0, cumulative_gc_wins: 0,
    plan_start_season_number: 5, plan_start_sponsor_income: 1_000_000,
    season_start_satisfaction: null, season_start_anchor_season_id: null,
    ...extra,
  };
}

/** @param {string} teamId @param {string|null} pool */
function makeStanding(teamId, pool) {
  return {
    id: `standing-${teamId}`, team_id: teamId, season_id: "season-5", division: 3,
    league_division_id: pool, rank_in_division: 8, total_points: 10, stage_wins: 0, gc_wins: 0,
    team: { is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
  };
}

/** @param {string} teamId */
function makeRiders(teamId) {
  // Lav værdi og lav popularitet: tvangssalg har en kandidat.
  return [
    { id: `rider-${teamId}-1`, team_id: teamId, firstname: "Billig", lastname: "Rytter", is_u25: false, popularity: 1, market_value: 10_000, salary: 5_000 },
    { id: `rider-${teamId}-2`, team_id: teamId, firstname: "Anden", lastname: "Rytter", is_u25: false, popularity: 1, market_value: 20_000, salary: 5_000 },
  ];
}

/**
 * Parkeret hold (pulje-løs standing, som i prod) og aktivt hold med identiske
 * tal. Det parkerede hold har både et forhandlet 1yr-board og et baseline-board,
 * så begge grene i hold-løkken er dækket.
 */
function makeState() {
  return {
    teams: [
      makeTeam(PARKED, { parked_at: "2026-09-27T12:00:00.000Z", league_division_id: null }),
      makeTeam(ACTIVE),
    ],
    board_profiles: [
      makeBoard("board-parked", PARKED),
      makeBoard("board-parked-baseline", PARKED, { plan_type: "baseline", is_baseline: true }),
      makeBoard("board-active", ACTIVE),
    ],
    season_standings: [makeStanding(PARKED, null), makeStanding(ACTIVE, "pool-a")],
    riders: [...makeRiders(PARKED), ...makeRiders(ACTIVE)],
    loans: [],
    board_plan_snapshots: [],
    board_consequences: [],
    transfer_listings: [],
    board_satisfaction_events: [],
    app_config: [],
  };
}

function makeSupabase(state) {
  const supabase = createFakeSupabase(state);
  // Tro kopi af apply_board_weekend_writes (samme som boardWeekendFinalization.test.js).
  supabase.rpc = async (name, args = {}) => {
    if (name !== "apply_board_weekend_writes") {
      return { data: null, error: { code: "PGRST202", message: `unknown rpc ${name}` } };
    }
    let profiles = 0;
    for (const { id, ...patch } of args.p_profiles || []) {
      const row = state.board_profiles.find((r) => r.id === id);
      if (!row) continue;
      Object.assign(row, patch);
      profiles += 1;
    }
    for (const ev of args.p_events || []) {
      const existing = state.board_satisfaction_events.find((r) => r.board_id === ev.board_id && r.race_id === ev.race_id);
      if (existing) Object.assign(existing, ev);
      else state.board_satisfaction_events.push({ ...ev });
    }
    return { data: { profiles, events: (args.p_events || []).length, events_error: null }, error: null };
  };
  return supabase;
}

/** Deterministisk tilfredsheds-bevægelse: alle forhandlede boards lander i krise. */
function crisisUpdate(args) {
  return {
    previousSatisfaction: args.board.satisfaction,
    seasonStartSatisfaction: args.seasonStartSatisfaction,
    newSatisfaction: CRISIS_SATISFACTION,
    newModifier: 0.8,
    goalsMet: 0,
    goalsTotal: 3,
    appliedDelta: CRISIS_SATISFACTION - args.board.satisfaction,
    evaluation: { goals: [] },
  };
}

function recordingDeps(overrides = {}) {
  const calls = { goalContext: [], mandateSync: [], notify: [], baseline: [], update: [] };
  const deps = {
    isBoardTestModeActive: async () => false,
    loadGoalContext: async ({ teamId }) => { calls.goalContext.push(teamId); return { divisionManagerCount: 4 }; },
    computeWeekendUpdate: (args) => { calls.update.push(args.standing.team_id); return crisisUpdate(args); },
    computeBaselineWeekendUpdate: ({ board, teamId }) => {
      calls.baseline.push(teamId);
      return { previousSatisfaction: board.satisfaction, newSatisfaction: board.satisfaction - 1, appliedDelta: -1 };
    },
    applyMandateWeekendSync: async (_supabase, { teamId }) => { calls.mandateSync.push(teamId); return { skipped: false }; },
    notifyTeamOwner: async ({ teamId, type }) => { calls.notify.push({ teamId, type }); return { delivered: true }; },
    ...overrides,
  };
  return { deps, calls };
}

/** @param {any} state @param {string} teamId */
function rowsFor(state, teamId) {
  return {
    consequences: state.board_consequences.filter((r) => r.team_id === teamId),
    listings: state.transfer_listings.filter((r) => r.seller_team_id === teamId),
    events: state.board_satisfaction_events.filter((r) => r.team_id === teamId),
  };
}

test("#5902 · almindelig weekend: parkeret hold får ingen ny tilfredshed, ingen events og ingen mandat-sync", async () => {
  const state = makeState();
  const before = JSON.parse(JSON.stringify(state.board_profiles.filter((b) => b.team_id === PARKED)));
  const { deps, calls } = recordingDeps();

  const summary = await processBoardWeekendFinalization({
    supabase: makeSupabase(state),
    season: WEEKEND_SEASON,
    previousRaceDaysCompleted: 6,
    race: RACE,
    now: NOW,
    deps,
  });

  assert.equal(summary.checkpoint, null);
  assert.equal(summary.parked_teams_skipped, 1);
  assert.equal(summary.teams_checked, 1, "kun det aktive hold behandles");

  // Parkeret: board_profiles bit-for-bit uændret (tilfredshed, modifier, anker).
  assert.deepEqual(state.board_profiles.filter((b) => b.team_id === PARKED), before);
  assert.equal(rowsFor(state, PARKED).events.length, 0);
  assert.ok(!calls.goalContext.includes(PARKED));
  assert.ok(!calls.update.includes(PARKED));
  assert.ok(!calls.baseline.includes(PARKED), "baseline-boardet springes også over");
  assert.ok(!calls.mandateSync.includes(PARKED));

  // Aktivt hold: behandles som før.
  const active = state.board_profiles.find((b) => b.id === "board-active");
  assert.equal(active.satisfaction, CRISIS_SATISFACTION);
  assert.equal(active.season_start_anchor_season_id, WEEKEND_SEASON.id);
  assert.equal(rowsFor(state, ACTIVE).events.length, 1);
  assert.deepEqual(calls.mandateSync, [ACTIVE]);
});

test("#5902 · halvsæson-tjek: konsekvens-motoren kaldes aldrig for et parkeret hold", async () => {
  const state = makeState();
  const evaluated = [];
  const { deps } = recordingDeps({
    evaluateAndApplyConsequences: async ({ team }) => { evaluated.push(team.id); return { applied: [], skipped: [] }; },
  });

  const summary = await processBoardWeekendFinalization({
    supabase: makeSupabase(state),
    season: MIDSEASON_SEASON,
    previousRaceDaysCompleted: 24,
    race: RACE,
    now: NOW,
    deps,
  });

  assert.equal(summary.checkpoint, CHECKPOINT_KINDS.MID_SEASON);
  assert.deepEqual(evaluated, [ACTIVE]);
});

test("#5902 · halvsæson-tjek med ægte konsekvens-motor: parkeret hold får 0 konsekvenser, 0 salgslister og 0 beskeder", async () => {
  const state = makeState();
  const { deps, calls } = recordingDeps();

  const summary = await processBoardWeekendFinalization({
    supabase: makeSupabase(state),
    season: MIDSEASON_SEASON,
    previousRaceDaysCompleted: 24,
    race: RACE,
    now: NOW,
    deps,
  });

  assert.equal(summary.checkpoint, CHECKPOINT_KINDS.MID_SEASON);
  assert.equal(summary.errors, 0);

  const parked = rowsFor(state, PARKED);
  assert.equal(parked.consequences.length, 0, "ingen rækker i board_consequences");
  assert.equal(parked.listings.length, 0, "ingen rækker i transfer_listings");
  assert.equal(parked.events.length, 0);
  assert.equal(calls.notify.filter((n) => n.teamId === PARKED).length, 0, "ingen beskeder");

  // Aktivt hold med samme tal: samme straffe som i dag (lønloft, købsstop,
  // tvangssalg, sponsor-exit), én salgsliste og beskeder for tvangssalg og
  // sponsor-exit.
  const active = rowsFor(state, ACTIVE);
  assert.deepEqual(
    active.consequences.map((r) => r.layer).sort(),
    [
      CONSEQUENCE_LAYERS.SALARY_CAP,
      CONSEQUENCE_LAYERS.SIGNING_RESTRICTION,
      CONSEQUENCE_LAYERS.FORCED_LISTING,
      CONSEQUENCE_LAYERS.SPONSOR_PULLOUT,
    ].sort(),
  );
  assert.equal(active.listings.length, 1);
  assert.equal(active.listings[0].rider_id, `rider-${ACTIVE}-1`);
  assert.equal(calls.notify.filter((n) => n.teamId === ACTIVE).length, 2);
  assert.equal(summary.consequences_applied, 4);
});

test("#5902 · halvsæson-tjek: et parkeret holds eksisterende aktive rækker står urørte (frosset, ikke nulstillet)", async () => {
  const state = makeState();
  state.board_consequences.push(
    { id: "old-cap", team_id: PARKED, source_board_id: "board-parked", layer: CONSEQUENCE_LAYERS.SALARY_CAP, severity: 1, status: "active", resolved_at: null },
    { id: "old-stop", team_id: PARKED, source_board_id: "board-parked", layer: CONSEQUENCE_LAYERS.SIGNING_RESTRICTION, severity: 1, status: "active", resolved_at: null },
  );
  const before = JSON.parse(JSON.stringify(state.board_consequences));
  // Høj tilfredshed ville ellers udløbe lønloft og købsstop for holdet.
  const { deps } = recordingDeps({
    computeWeekendUpdate: (args) => ({ ...crisisUpdate(args), newSatisfaction: T.BONUS_OFFER + 1, goalsMet: 3, goalsTotal: 3 }),
  });

  await processBoardWeekendFinalization({
    supabase: makeSupabase(state),
    season: MIDSEASON_SEASON,
    previousRaceDaysCompleted: 24,
    race: RACE,
    now: NOW,
    deps,
  });

  assert.deepEqual(state.board_consequences.filter((r) => r.team_id === PARKED), before);
  // Heller intet bonustilbud til det parkerede hold.
  assert.equal(state.board_consequences.filter((r) => r.team_id === PARKED && r.layer === CONSEQUENCE_LAYERS.BONUS_OFFER).length, 0);
  // Det aktive hold får sit bonustilbud som i dag.
  assert.equal(state.board_consequences.filter((r) => r.team_id === ACTIVE && r.layer === CONSEQUENCE_LAYERS.BONUS_OFFER).length, 1);
});

test("#5902 · et hold der er vendt tilbage (parked_at nulstillet af comeback) dømmes igen som alle andre", async () => {
  const state = makeState();
  const parkedTeam = state.teams.find((t) => t.id === PARKED);
  parkedTeam.parked_at = null;
  parkedTeam.league_division_id = "pool-a";
  state.season_standings.find((s) => s.team_id === PARKED).league_division_id = "pool-a";
  const { deps } = recordingDeps();

  const summary = await processBoardWeekendFinalization({
    supabase: makeSupabase(state),
    season: MIDSEASON_SEASON,
    previousRaceDaysCompleted: 24,
    race: RACE,
    now: NOW,
    deps,
  });

  assert.equal(summary.parked_teams_skipped, 0);
  assert.ok(rowsFor(state, PARKED).consequences.length > 0);
});

test("#5902 · kun parkerede hold → ingen kørsel, ingen skrivning", async () => {
  const state = makeState();
  state.teams = state.teams.filter((t) => t.id === PARKED);
  const before = JSON.parse(JSON.stringify(state.board_profiles));
  const { deps, calls } = recordingDeps();

  const summary = await processBoardWeekendFinalization({
    supabase: makeSupabase(state),
    season: MIDSEASON_SEASON,
    previousRaceDaysCompleted: 24,
    race: RACE,
    now: NOW,
    deps,
  });

  assert.equal(summary.skipped_reason, "no_human_teams");
  assert.equal(summary.parked_teams_skipped, 1);
  assert.deepEqual(state.board_profiles, before);
  assert.equal(state.board_consequences.length, 0);
  assert.equal(state.transfer_listings.length, 0);
  assert.equal(calls.notify.length, 0);
});

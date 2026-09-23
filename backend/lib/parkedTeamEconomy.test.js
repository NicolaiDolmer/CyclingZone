// #4592 ejer-valg (b) = A med løn (23/9): et parkeret hold står økonomisk stille.
//
//   - Sæsonstart: ingen sponsor, ingen faldskærm, intet divisions-tillæg og ingen
//     nye bestyrelsesplaner. Lønnen betales som normalt (payroll er uændret).
//   - Sæson-slut: ingen bestyrelsesdom, ingen konsekvenser, intet mandat/årsmøde.
//   - Et ikke-parkeret hold er bit-identisk med før: hvert scenarie køres to
//     gange, én gang hvor Hold P er aktivt (kontrol) og én gang hvor Hold P er
//     parkeret. Hold A's skrivninger skal være ens i begge kørsler.
//
// Fixturen er en lille generisk in-memory-Supabase: eq/is/in filtrerer, alle
// andre filtre er no-ops, og ukendte tabeller er tomme. Den kører den ægte
// motor-kode (processSeasonStart med ægte defaultRunSeasonPayroll,
// processSeasonEnd med ægte board-evaluering) og optager alle skrivninger.

import test from "node:test";
import assert from "node:assert/strict";

import { processSeasonStart, processSeasonEnd, loadHumanSeasonEndTeams } from "./economyEngine.js";
import { isParkedTeam } from "./managerParking.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

function createFakeSupabase(initialTables) {
  const tables = new Map(Object.entries(clone(initialTables)));
  const writes = { rpc: [], inserts: [], updates: [], upserts: [] };
  const rowsOf = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  };

  function query(table) {
    const state = { op: "select", payload: null, filters: [], count: false, head: false, limit: null };
    const matches = (row) => state.filters.every((filter) => filter(row));

    const run = () => {
      const all = rowsOf(table);
      if (state.op === "insert") {
        const rows = [].concat(state.payload).map((row) => ({ ...row }));
        all.push(...rows);
        writes.inserts.push({ table, rows: clone(rows) });
        return { data: rows, error: null };
      }
      if (state.op === "update") {
        const hit = all.filter(matches);
        for (const row of hit) Object.assign(row, state.payload);
        writes.updates.push({ table, ids: hit.map((row) => row.id), payload: clone(state.payload) });
        return { data: hit, error: null };
      }
      if (state.op === "upsert") {
        writes.upserts.push({ table, rows: clone([].concat(state.payload)) });
        return { data: [].concat(state.payload), error: null };
      }
      let rows = all.filter(matches);
      if (state.count) return { data: state.head ? null : rows, count: rows.length, error: null };
      if (state.limit != null) rows = rows.slice(0, state.limit);
      return { data: rows, error: null };
    };

    const q = {
      select(_columns, options) {
        if (state.op === "select" && options?.count) {
          state.count = true;
          state.head = options.head === true;
        }
        return q;
      },
      insert(payload) { state.op = "insert"; state.payload = payload; return q; },
      update(payload) { state.op = "update"; state.payload = payload; return q; },
      upsert(payload) { state.op = "upsert"; state.payload = payload; return q; },
      eq(column, value) { state.filters.push((row) => row[column] === value); return q; },
      is(column, value) {
        state.filters.push((row) => (value === null ? row[column] == null : row[column] === value));
        return q;
      },
      in(column, values) {
        const set = new Set(values);
        state.filters.push((row) => set.has(row[column]));
        return q;
      },
      not() { return q; },
      neq() { return q; },
      gt() { return q; },
      gte() { return q; },
      lt() { return q; },
      lte() { return q; },
      or() { return q; },
      order() { return q; },
      limit(n) { state.limit = n; return q; },
      range(from, to) {
        const result = run();
        return Promise.resolve({ ...result, data: Array.isArray(result.data) ? result.data.slice(from, to + 1) : result.data });
      },
      single() {
        const result = run();
        return Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null });
      },
      maybeSingle() {
        const result = run();
        return Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null });
      },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return q;
  }

  return {
    tables,
    writes,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      const team = rowsOf("teams").find((row) => row.id === params.p_team_id);
      if (team) team.balance = (team.balance ?? 0) + params.p_delta;
      writes.rpc.push({ team_id: params.p_team_id, delta: params.p_delta, ...clone(params.p_finance_payload) });
      return Promise.resolve({ data: team?.balance ?? params.p_delta, error: null });
    },
    from(table) {
      return query(table);
    },
  };
}

// Aliaser, ingen rigtige hold: A er aktivt i begge kørsler, P skifter mellem
// aktivt (kontrol) og parkeret.
const TEAM_A = "team-a";
const TEAM_P = "team-p";
const PARKED_AT = "2026-09-27T20:00:00.000Z";

function humanTeam(id, overrides = {}) {
  return {
    id,
    name: `Hold ${id.slice(-1).toUpperCase()}`,
    user_id: `user-${id}`,
    is_ai: false,
    is_bank: false,
    is_frozen: false,
    is_test_account: false,
    balance: 5_000_000,
    sponsor_income: 400_000,
    parked_at: null,
    ...overrides,
  };
}

function writesForTeam(writes, teamId, boardIds = []) {
  const ownsRow = (row) => row.team_id === teamId || row.user_id === `user-${teamId}` || boardIds.includes(row.id);
  return {
    finance: writes.rpc.filter((row) => row.team_id === teamId),
    inserts: writes.inserts
      .map(({ table, rows }) => ({ table, rows: rows.filter(ownsRow) }))
      .filter(({ rows }) => rows.length > 0),
    updates: writes.updates
      .filter(({ ids }) => ids.includes(teamId) || ids.some((id) => boardIds.includes(id)))
      // updated_at er et vægur-tidsstempel; alt andet skal være identisk.
      .map(({ table, ids, payload }) => {
        const { updated_at: _ignored, ...rest } = payload;
        return { table, ids, payload: rest };
      }),
    upserts: writes.upserts
      .map(({ table, rows }) => ({ table, rows: rows.filter(ownsRow) }))
      .filter(({ rows }) => rows.length > 0),
  };
}

test("isParkedTeam: kun et sat parked_at tæller som parkeret", () => {
  assert.equal(isParkedTeam({ parked_at: PARKED_AT }), true);
  assert.equal(isParkedTeam({ parked_at: null }), false);
  assert.equal(isParkedTeam({}), false, "en select uden parked_at må aldrig stoppe et aktivt holds økonomi");
  assert.equal(isParkedTeam(null), false);
  assert.equal(isParkedTeam(undefined), false);
});

// ─── Sæsonstart ────────────────────────────────────────────────────────────────

function seasonStartTables({ parked }) {
  return {
    seasons: [
      { id: "season-3", number: 3 },
      { id: "season-4", number: 4 },
    ],
    // Forrige sæson: A i D3, P i D1. P står nu i D2 (nedrykket), så et aktivt
    // P ville få både sponsor og faldskærm.
    season_standings: [
      { id: 1, season_id: "season-3", team_id: TEAM_A, division: 3, rank_in_division: 4, total_points: 120 },
      { id: 2, season_id: "season-3", team_id: TEAM_P, division: 1, rank_in_division: 9, total_points: 40 },
    ],
    teams: [
      humanTeam(TEAM_A, { division: 3, board_profiles: [] }),
      humanTeam(TEAM_P, { division: 2, board_profiles: [], parked_at: parked ? PARKED_AT : null }),
    ],
    riders: [
      { id: "rider-a1", team_id: TEAM_A, salary: 4_000, is_academy: false },
      { id: "rider-a2", team_id: TEAM_A, salary: 2_500, is_academy: false },
      { id: "rider-p1", team_id: TEAM_P, salary: 3_000, is_academy: false },
      { id: "rider-p2", team_id: TEAM_P, salary: 1_500, is_academy: false },
    ],
    transfer_windows: [{ id: "tw-4", board_test_mode: false }],
  };
}

async function runSeasonStart({ parked }) {
  const supabase = createFakeSupabase(seasonStartTables({ parked }));
  const result = await processSeasonStart("season-4", {
    supabase,
    // Ægte payroll (defaultRunSeasonPayroll), kun de eksterne sider stubbes.
    processLoanInterest: async () => ({ charged: [] }),
    createEmergencyLoan: async () => { throw new Error("intet nødlån forventet"); },
    facilitiesEnabled: false,
    loadRetiringRiderIds: async () => new Set(),
    developRidersForSeason: async () => ({ developed: 0, grew: 0, declined: 0, retired: 0 }),
    captureException: () => {},
  });
  return { supabase, result };
}

test("#4592 sæsonstart: et parkeret hold får ingen sponsor, faldskærm eller bestyrelsesplan", async () => {
  const control = await runSeasonStart({ parked: false });
  const parked = await runSeasonStart({ parked: true });

  // Kontrollen beviser at scenariet er meningsfuldt: aktivt fik P det hele.
  const controlP = writesForTeam(control.supabase.writes, TEAM_P);
  const controlTypes = controlP.finance.map((row) => row.type);
  assert.ok(controlTypes.includes("sponsor"), "kontrol: et aktivt P får sponsor");
  assert.ok(controlTypes.includes("parachute"), "kontrol: et aktivt, nedrykket P får faldskærm");
  assert.ok(
    controlP.inserts.some(({ table }) => table === "board_profiles"),
    "kontrol: et aktivt P uden planer får oprettet bestyrelsesplaner",
  );

  const parkedP = writesForTeam(parked.supabase.writes, TEAM_P);
  const parkedTypes = parkedP.finance.map((row) => row.type);
  for (const type of ["sponsor", "parachute", "division_adjustment"]) {
    assert.ok(!parkedTypes.includes(type), `parkeret P må ikke få ${type}`);
  }
  assert.ok(
    !parkedP.inserts.some(({ table }) => table === "board_profiles"),
    "parkeret P får ingen nye bestyrelsesplaner/mål",
  );
  assert.ok(
    !parkedP.inserts.some(({ table, rows }) => table === "notifications" && rows.some((row) => row.type === "sponsor_paid")),
    "parkeret P får ingen sponsor-besked",
  );

  // Sponsor-listen (transition-loggens sponsor_payout-tal) tæller kun hold der
  // fik sponsor-behandling.
  assert.deepEqual(parked.result.sponsor.map((row) => row.team), ["Hold A"]);
  assert.equal(parked.result.parked.count, 1);
  assert.equal(control.result.parked.count, 0);
});

test("#4592 sæsonstart: et parkeret hold betaler stadig løn (payroll er uændret)", async () => {
  const control = await runSeasonStart({ parked: false });
  const parked = await runSeasonStart({ parked: true });

  const salaryOf = (supabase) => supabase.writes.rpc.filter((row) => row.team_id === TEAM_P && row.type === "salary");
  assert.equal(salaryOf(parked.supabase).length, 1, "parkeret P trækkes løn ved sæsonstart");
  assert.equal(salaryOf(parked.supabase)[0].amount, -4_500, "hele lønsummen for rytterne på kontrakt");

  // Alle payroll-poster (løn, drift, renter) er de samme som hvis holdet var aktivt.
  const sponsorTypes = new Set(["sponsor", "parachute", "division_adjustment"]);
  const payrollOf = (supabase) => supabase.writes.rpc
    .filter((row) => row.team_id === TEAM_P && !sponsorTypes.has(row.type))
    .map(({ type, amount, idempotency_key }) => ({ type, amount, idempotency_key }));
  assert.deepEqual(payrollOf(parked.supabase), payrollOf(control.supabase));
  assert.equal(parked.result.payroll.summary.teams_processed, 2, "payroll kører for både A og det parkerede P");
});

test("#4592 sæsonstart: et ikke-parkeret hold er bit-identisk, uanset om et andet hold er parkeret", async () => {
  const control = await runSeasonStart({ parked: false });
  const parked = await runSeasonStart({ parked: true });

  assert.deepEqual(
    writesForTeam(parked.supabase.writes, TEAM_A),
    writesForTeam(control.supabase.writes, TEAM_A),
  );
  const resultFor = (result) => result.sponsor.find((row) => row.team === "Hold A");
  assert.deepEqual(resultFor(parked.result), resultFor(control.result));
});

// ─── Sæson-slut: bestyrelsesdommen ──────────────────────────────────────────────

const BOARD_A = "board-a";
const BOARD_P = "board-p";

function boardProfile(id, teamId) {
  return {
    id,
    team_id: teamId,
    plan_type: "3yr",
    focus: "balanced",
    satisfaction: 50,
    budget_modifier: 1.0,
    current_goals: [],
    // seasons_completed 0 → 1 = floor(3/2) → halvvejsevaluering (skriver plan + besked)
    seasons_completed: 0,
    cumulative_stage_wins: 0,
    cumulative_gc_wins: 0,
    plan_start_sponsor_income: 400_000,
    negotiation_status: "completed",
  };
}

function seasonEndTables({ parked }) {
  const teams = [
    humanTeam(TEAM_A, { division: 3 }),
    humanTeam(TEAM_P, { division: 3, parked_at: parked ? PARKED_AT : null }),
  ];
  return {
    seasons: [{ id: "season-5", number: 5 }],
    teams,
    riders: [
      { id: "rider-a1", team_id: TEAM_A, salary: 4_000 },
      { id: "rider-p1", team_id: TEAM_P, salary: 3_000 },
    ],
    board_profiles: [boardProfile(BOARD_A, TEAM_A), boardProfile(BOARD_P, TEAM_P)],
    // P har en stillingsrække (season_standings oprettes for alle hold med en
    // division), så uden parkerings-tjekket ville dommen blive afsagt.
    season_standings: [
      {
        id: 1, season_id: "season-5", team_id: TEAM_A, division: 3, league_division_id: null,
        total_points: 60, rank_in_division: 5, stage_wins: 0, gc_wins: 0, team: { id: TEAM_A, is_ai: false },
      },
      {
        id: 2, season_id: "season-5", team_id: TEAM_P, division: 3, league_division_id: null,
        total_points: 0, rank_in_division: null, stage_wins: 0, gc_wins: 0, team: { id: TEAM_P, is_ai: false },
      },
    ],
  };
}

async function runSeasonEnd({ parked }) {
  const supabase = createFakeSupabase(seasonEndTables({ parked }));
  const calls = { consequences: [], replacement: [], mandateSync: [], annualMeeting: [] };
  await processSeasonEnd("season-5", {
    supabase,
    now: new Date("2026-09-27T20:00:00.000Z"),
    boardTestMode: false,
    processLoanInterest: async () => {},
    createEmergencyLoan: async () => {},
    updateRiderValues: async () => {},
    processReplacementTrigger: async (args) => { calls.replacement.push(args.teamId); return { counter: 0, replaced: false }; },
    evaluateAndApplyConsequences: async (args) => { calls.consequences.push(args.team.id); },
    applyMandateSeasonEndSync: async (_client, args) => { calls.mandateSync.push(args.teamId); return null; },
    advanceMandateAtSeasonEnd: async (_client, args) => { calls.annualMeeting.push(args.teamId); return null; },
    // Op/nedrykning og parkerings-sweepen har egne tests (economyEngine.test.js).
    isSeasonEndDivisionMovementSkipped: async () => true,
    isSeasonSignupEnabled: async () => false,
    captureException: () => {},
  });
  return { supabase, calls };
}

test("#4592 sæson-slut: et parkeret hold får ingen bestyrelsesdom, konsekvenser eller mandat", async () => {
  const control = await runSeasonEnd({ parked: false });
  const parked = await runSeasonEnd({ parked: true });

  // Kontrollen: et aktivt P får sin dom.
  const controlP = writesForTeam(control.supabase.writes, TEAM_P, [BOARD_P]);
  assert.ok(controlP.updates.some(({ table }) => table === "board_profiles"), "kontrol: P's plan opdateres");
  assert.ok(controlP.upserts.some(({ table }) => table === "board_plan_snapshots"), "kontrol: P får et snapshot");
  assert.ok(control.calls.consequences.includes(TEAM_P), "kontrol: P's konsekvenser evalueres");

  // Parkeret: ingen af delene.
  const parkedP = writesForTeam(parked.supabase.writes, TEAM_P, [BOARD_P]);
  assert.deepEqual(parkedP.updates, [], "parkeret P's bestyrelsesplan røres ikke");
  assert.deepEqual(parkedP.upserts, [], "parkeret P får intet snapshot");
  assert.deepEqual(parkedP.inserts, [], "parkeret P får ingen bestyrelsesbesked");
  assert.ok(!parked.calls.consequences.includes(TEAM_P), "ingen konsekvenser for parkeret P");
  assert.ok(!parked.calls.replacement.includes(TEAM_P), "ingen formandsudskiftning for parkeret P");
  assert.ok(!parked.calls.mandateSync.includes(TEAM_P), "intet mandat-sync for parkeret P");
  assert.ok(!parked.calls.annualMeeting.includes(TEAM_P), "intet årsmøde for parkeret P");
});

test("#4592 sæson-slut: et ikke-parkeret hold får samme dom, uanset om et andet hold er parkeret", async () => {
  const control = await runSeasonEnd({ parked: false });
  const parked = await runSeasonEnd({ parked: true });

  const writesA = (run) => writesForTeam(run.supabase.writes, TEAM_A, [BOARD_A]);
  assert.ok(writesA(parked).updates.some(({ table }) => table === "board_profiles"), "A får sin dom");
  assert.deepEqual(writesA(parked), writesA(control));
  assert.ok(parked.calls.consequences.includes(TEAM_A));
  assert.ok(parked.calls.annualMeeting.includes(TEAM_A));
});

test("#4592 payroll-listen (loadHumanSeasonEndTeams) indeholder stadig parkerede hold", async () => {
  // Payroll og bestyrelsesdommen deler holdlisten. Filtreres parkerede hold en
  // dag væk her, holder de op med at betale løn: denne test fanger det.
  const supabase = createFakeSupabase(seasonEndTables({ parked: true }));
  const teams = await loadHumanSeasonEndTeams(supabase);
  assert.deepEqual(teams.map((team) => team.id).sort(), [TEAM_A, TEAM_P]);
  assert.equal(teams.find((team) => team.id === TEAM_P).riders.length, 1, "P's ryttere følger med til payroll");
});

import test from "node:test";
import assert from "node:assert/strict";

import { upsertOwnTeamProfile, ensureSeasonIdentityBasis, ensureBoardGoalsCalibrated } from "./teamProfileEngine.js";
import { generateBoardGoals } from "./boardGoals.js";
import { INITIAL_BALANCE, MANAGER_ENTRY_DIVISION, MAX_DIVISION, POOL_TARGET_SIZE, SPONSOR_INCOME_BASE } from "./economyConstants.js";

// #1560: alle eksisterende tests injicerer en no-op starter-squad-allokering, så
// de ikke rammer den ægte riders/derive-kæde (den dækkes i starterSquadAllocator.test.js).
// upsert(args) = upsertOwnTeamProfile med default-stub; tests der vil verificere
// allokerings-koblingen sender deres egen recording-stub.
//
// Akademi-kuld (forever-relaunch): standard-stubs holder akademi-koblingen ude af
// de eksisterende tests (academyEnabled=false → ingen seeding); tests der vil
// verificere koblingen sender deres egne stubs.
const noopAllocate = async () => ({ assigned: 0, skipped: "test-noop" });
const noopRunAcademyCohort = async () => ({ skipped: "test-noop", candidates: 0 });
const academyDisabled = async () => false;
// #1739: hold AI-fyld-trimmen ude af de eksisterende tests (no-op), så de kun
// verificerer det de var skrevet til. Tests der vil verificere trim-koblingen
// sender deres egen recording-stub.
const noopReconcileAiTeams = async () => ({ created: 0, removed: 0, skipped: "test-noop" });
function upsert(args) {
  return upsertOwnTeamProfile({
    allocateStarterSquad: noopAllocate,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
    reconcileAiTeams: noopReconcileAiTeams,
    ...args,
  });
}

function seedTeams({ division, count, league_division_id = null, is_ai = false, is_frozen = false, is_test_account = false }) {
  const kind = is_ai ? "ai" : is_frozen ? "frozen" : is_test_account ? "test" : "human";
  return Array.from({ length: count }, (_, index) => ({
    id: `seed-div${division}-${kind}-${index}`,
    user_id: `seed-user-${division}-${kind}-${index}`,
    name: `Seed ${division} ${kind} ${index}`,
    division,
    league_division_id,
    is_ai,
    is_frozen,
    is_test_account,
  }));
}

// #1608 Task 9: de 8 div-4-puljer (tier 4) som migration 2026-06-21-league-divisions-
// pyramid.sql seeder. id 8..15 matcher seed-rækkefølgen (tier1×1, tier2×2, tier3×4,
// tier4×8 → div-4-puljerne er id 8-15). Selve id-tallene er vilkårlige for testen;
// kun "8 distinkte tier-4-puljer" betyder noget.
function seedDiv4Pools() {
  return Array.from({ length: 8 }, (_, index) => ({
    id: 8 + index,
    tier: MANAGER_ENTRY_DIVISION,
    pool_index: index,
    label: `Division 4 — ${String.fromCharCode(65 + index)}`,
  }));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function matchesFilters(row, filters = []) {
  return filters.every((filter) => {
    if (filter.type === "eq") {
      return row?.[filter.column] === filter.value;
    }

    if (filter.type === "in") {
      return filter.values.includes(row?.[filter.column]);
    }

    if (filter.type === "ilike") {
      return String(row?.[filter.column] ?? "").toLowerCase() === String(filter.value ?? "").toLowerCase();
    }

    if (filter.type === "is") {
      // Kun null-tilfældet bruges (race-sikker guard: WHERE col IS NULL).
      return filter.value === null ? (row?.[filter.column] == null) : row?.[filter.column] === filter.value;
    }

    return true;
  });
}

// insertErrors/updateErrors: { [table]: [{ error, seedRows? }, ...] } — kø der
// forbruges pr. forsøg. Modellerer #1264-racet: applikations-precheck (select)
// ser INTET, men DB'en afviser insert/update med 23505 fordi en samtidig
// transaktion nåede at committe (seedRows = den samtidige vinders rækker).
function createSupabaseDouble({ teams = [], boardProfiles = [], leagueDivisions = [], riders = [], seasons = [], insertErrors = {}, updateErrors = {} } = {}) {
  const state = {
    teams: clone(teams),
    board_profiles: clone(boardProfiles),
    league_divisions: clone(leagueDivisions),
    riders: clone(riders),
    seasons: clone(seasons),
    updates: [],
    inserts: [],
    insertErrorQueues: clone(insertErrors),
    updateErrorQueues: clone(updateErrors),
  };

  function createSelectQuery(table) {
    const filters = [];
    let limitCount = null;

    const execute = () => {
      let rows = clone(state[table] || []).filter((row) => matchesFilters(row, filters));
      if (limitCount !== null) {
        rows = rows.slice(0, limitCount);
      }

      return { data: rows, error: null };
    };

    const query = {
      select() {
        return query;
      },
      ilike(column, value) {
        filters.push({ type: "ilike", column, value });
        return query;
      },
      eq(column, value) {
        filters.push({ type: "eq", column, value });
        return query;
      },
      in(column, values) {
        filters.push({ type: "in", column, values });
        return query;
      },
      order() {
        return query;
      },
      limit(value) {
        limitCount = value;
        return query;
      },
      single() {
        const result = execute();
        return Promise.resolve({
          data: result.data[0] || null,
          error: null,
        });
      },
      maybeSingle() {
        const result = execute();
        return Promise.resolve({
          data: result.data[0] || null,
          error: null,
        });
      },
      then(resolve, reject) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };

    return query;
  }

  function consumeQueuedError(queues, table) {
    const entry = (queues[table] || []).shift();
    if (!entry) {
      return null;
    }

    for (const row of entry.seedRows || []) {
      state[table] = state[table] || [];
      state[table].push(clone(row));
    }

    return { data: null, error: clone(entry.error) };
  }

  function createUpdateQuery(table, payload) {
    const filters = [];

    const execute = () => {
      const queued = consumeQueuedError(state.updateErrorQueues, table);
      if (queued) {
        return queued;
      }

      const target = (state[table] || []).find((row) => matchesFilters(row, filters));
      if (!target) {
        return { data: null, error: { message: `${table} row not found` } };
      }

      Object.assign(target, clone(payload));
      state.updates.push({ table, payload: clone(payload), filters: clone(filters) });
      return { data: clone(target), error: null };
    };

    const query = {
      eq(column, value) {
        filters.push({ type: "eq", column, value });
        return query;
      },
      is(column, value) {
        filters.push({ type: "is", column, value });
        return query;
      },
      select() {
        return query;
      },
      single() {
        return Promise.resolve(execute());
      },
      then(resolve, reject) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };

    return query;
  }

  function createInsertQuery(table, payload) {
    const rows = Array.isArray(payload) ? payload : [payload];

    const execute = () => {
      const queued = consumeQueuedError(state.insertErrorQueues, table);
      if (queued) {
        return queued;
      }

      const insertedRows = rows.map((row, index) => {
        const nextIndex = (state[table] || []).length + index + 1;
        return {
          id: row.id || `${table}-${nextIndex}`,
          ...clone(row),
        };
      });

      for (const row of insertedRows) {
        state[table].push(clone(row));
      }

      state.inserts.push({ table, rows: clone(insertedRows) });
      return {
        data: insertedRows.length === 1 ? clone(insertedRows[0]) : clone(insertedRows),
        error: null,
      };
    };

    const query = {
      select() {
        return query;
      },
      single() {
        return Promise.resolve(execute());
      },
      then(resolve, reject) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };

    return query;
  }

  return {
    state,
    from(table) {
      return {
        select() {
          return createSelectQuery(table);
        },
        update(payload) {
          return createUpdateQuery(table, payload);
        },
        insert(payload) {
          return createInsertQuery(table, payload);
        },
      };
    },
  };
}

test("upsertOwnTeamProfile creates a missing team and bootstraps a board profile", async () => {
  const supabase = createSupabaseDouble();

  const result = await upsert({
    supabase,
    userId: "user-1",
    name: "  Team Nova  ",
    managerName: "  Alex  ",
  });

  assert.equal(result.created, true);
  assert.equal(result.boardProfileCreated, true);
  assert.equal(result.team.name, "Team Nova");
  assert.equal(result.team.manager_name, "Alex");
  assert.equal(supabase.state.teams.length, 1);
  assert.equal(supabase.state.board_profiles.length, 1);
  assert.equal(supabase.state.board_profiles[0].team_id, result.team.id);
});

test("upsertOwnTeamProfile sætter sponsor_income og balance til de delte konstanter (07a regression)", async () => {
  // Slice 07a: locker sponsor_income til SPONSOR_INCOME_BASE (240K) i stedet for stale 260K.
  // Skal fejle hvis nogen rører ved DEFAULT_TEAM_VALUES uden at opdatere DB-default i samme commit.
  assert.equal(SPONSOR_INCOME_BASE, 240000, "DB-default i schema.sql:31 er 240000");
  assert.equal(INITIAL_BALANCE, 500000, "DB-default i schema.sql:59 er 500000 (#1717)");

  const supabase = createSupabaseDouble({ leagueDivisions: seedDiv4Pools() });
  const result = await upsert({
    supabase,
    userId: "user-1",
    name: "Sponsor Check",
    managerName: "Manager",
  });

  assert.equal(result.team.sponsor_income, SPONSOR_INCOME_BASE);
  assert.equal(result.team.balance, INITIAL_BALANCE);
  // #1608 bund-op: en ny manager kommer ind fra BUNDEN (tier 4 = MANAGER_ENTRY_DIVISION),
  // ikke længere fra toppen (div 1).
  assert.equal(result.team.division, MANAGER_ENTRY_DIVISION);
});

// ── #1608 Task 9 · bund-op pulje-bevidst signup-placering ──────────────────────
// Erstatter de tidligere #962 fyld-fra-toppen-tests. Nye ægte managere placeres i
// den mindst-fyldte div-4-pulje (tier 4 = bunden), ikke i div 1 fra toppen.

test("#1608 bund-op: første nye manager lander i en div-4-pulje (tier 4), ikke div 1", async () => {
  const pools = seedDiv4Pools();
  const supabase = createSupabaseDouble({ leagueDivisions: pools });

  const result = await upsert({
    supabase,
    userId: "user-new",
    name: "Bottom Up One",
    managerName: "Manager",
  });

  assert.equal(result.team.division, MANAGER_ENTRY_DIVISION, "ny manager kommer ind i tier 4");
  // Holdet skal være pulje-allokeret (league_division_id sat til en af de 8 div-4-puljer).
  assert.ok(
    pools.some((pool) => pool.id === result.team.league_division_id),
    "holdet skal placeres i en faktisk div-4-pulje",
  );
});

test("#1608 bund-op: nye managere fordeles på den MINDST-fyldte div-4-pulje", async () => {
  const pools = seedDiv4Pools();
  // Forskyd belastningen: første pulje (id 8) har allerede 2 hold, de øvrige 0.
  const supabase = createSupabaseDouble({
    leagueDivisions: pools,
    teams: seedTeams({ division: MANAGER_ENTRY_DIVISION, count: 2, league_division_id: pools[0].id }),
  });

  const result = await upsert({
    supabase,
    userId: "user-new",
    name: "Least Filled Pool",
    managerName: "Manager",
  });

  assert.equal(result.team.division, MANAGER_ENTRY_DIVISION);
  // pool[0] har 2 hold → ny manager må IKKE lande der; en tom pulje er mindst-fyldt.
  assert.notEqual(result.team.league_division_id, pools[0].id, "fyldt pulje skal undgås");
  assert.ok(
    pools.slice(1).some((pool) => pool.id === result.team.league_division_id),
    "ny manager lander i en af de tomme div-4-puljer",
  );
});

test("#1608 bund-op: blød cap — div-4-puljer må vokse forbi POOL_TARGET_SIZE når alle er fulde", async () => {
  // Alle 8 div-4-puljer fyldt til POOL_TARGET_SIZE → ny manager skal STADIG placeres
  // (blød cap). Vi lander i den mindst-fyldte pulje, som ved jævn fyldning er en
  // vilkårlig pulje, men placeringen må aldrig fejle eller efterlade NULL pulje.
  const pools = seedDiv4Pools();
  const teams = pools.flatMap((pool) =>
    seedTeams({ division: MANAGER_ENTRY_DIVISION, count: POOL_TARGET_SIZE, league_division_id: pool.id }),
  );
  const supabase = createSupabaseDouble({ leagueDivisions: pools, teams });

  const result = await upsert({
    supabase,
    userId: "user-new",
    name: "Soft Cap Overflow",
    managerName: "Manager",
  });

  assert.equal(result.team.division, MANAGER_ENTRY_DIVISION, "blød cap → stadig tier 4");
  assert.ok(
    pools.some((pool) => pool.id === result.team.league_division_id),
    "blød cap → holdet får stadig en faktisk div-4-pulje (ingen NULL)",
  );
});

function seedMaxDivisionPools() {
  return Array.from({ length: 8 }, (_, index) => ({
    id: 100 + index,
    tier: MAX_DIVISION,
    pool_index: index,
    label: `Division 4 — ${String.fromCharCode(65 + index)}`,
  }));
}

test("overflow: alle entry-puljer ved POOL_TARGET_SIZE OG MAX_DIVISION-puljer findes → ny manager lander i MAX_DIVISION", async () => {
  const entryPools = seedDiv4Pools();
  const overflowPools = seedMaxDivisionPools();
  const teams = entryPools.flatMap((pool) =>
    seedTeams({ division: MANAGER_ENTRY_DIVISION, count: POOL_TARGET_SIZE, league_division_id: pool.id }),
  );
  const supabase = createSupabaseDouble({ leagueDivisions: [...entryPools, ...overflowPools], teams });

  const result = await upsert({
    supabase, userId: "user-overflow", name: "Overflow Team", managerName: "Manager",
  });

  assert.equal(result.team.division, MAX_DIVISION, "entry-tier mættet → fald igennem til MAX_DIVISION");
  assert.ok(
    overflowPools.some((p) => p.id === result.team.league_division_id),
    "holdet skal lande i en faktisk MAX_DIVISION-pulje",
  );
});

test("overflow: vælger den mindst-fyldte MAX_DIVISION-pulje (samme determinisme som entry-puljerne)", async () => {
  const entryPools = seedDiv4Pools();
  const overflowPools = seedMaxDivisionPools();
  const teams = [
    ...entryPools.flatMap((pool) =>
      seedTeams({ division: MANAGER_ENTRY_DIVISION, count: POOL_TARGET_SIZE, league_division_id: pool.id }),
    ),
    ...seedTeams({ division: MAX_DIVISION, count: 5, league_division_id: overflowPools[0].id }),
  ];
  const supabase = createSupabaseDouble({ leagueDivisions: [...entryPools, ...overflowPools], teams });

  const result = await upsert({
    supabase, userId: "user-overflow-2", name: "Least Filled Overflow", managerName: "Manager",
  });

  assert.notEqual(result.team.league_division_id, overflowPools[0].id, "fyldt MAX_DIVISION-pulje skal undgås");
  assert.ok(overflowPools.slice(1).some((p) => p.id === result.team.league_division_id));
});

test("overflow: division 3 har stadig plads → MAX_DIVISION-puljer IGNORERES, selvom de findes", async () => {
  const entryPools = seedDiv4Pools();
  const overflowPools = seedMaxDivisionPools();
  // Kun 5 rigtige managers i den første entry-pulje — langt under POOL_TARGET_SIZE.
  const teams = seedTeams({ division: MANAGER_ENTRY_DIVISION, count: 5, league_division_id: entryPools[0].id });
  const supabase = createSupabaseDouble({ leagueDivisions: [...entryPools, ...overflowPools], teams });

  const result = await upsert({
    supabase, userId: "user-no-overflow", name: "Still Division 3", managerName: "Manager",
  });

  assert.equal(result.team.division, MANAGER_ENTRY_DIVISION, "entry-tier har plads → ingen overflow, selvom MAX_DIVISION-puljer findes");
});

test("overflow: kun 7 af 8 entry-puljer mættet (1 ved 23) → ALDRIG overflow, lander i den ene under-fyldte pulje", async () => {
  // Låser .every()-semantikken: saturation kræver at HVER pulje individuelt er ved
  // POOL_TARGET_SIZE, ikke et aggregat/gennemsnit. 7 puljer ved 24 + 1 pulje ved 23
  // (lige under target) skal stadig give "ikke mættet" → ingen overflow til MAX_DIVISION.
  const entryPools = seedDiv4Pools();
  const overflowPools = seedMaxDivisionPools();
  const underFilledPool = entryPools[entryPools.length - 1];
  const saturatedPools = entryPools.slice(0, -1);

  const teams = [
    ...saturatedPools.flatMap((pool) =>
      seedTeams({ division: MANAGER_ENTRY_DIVISION, count: POOL_TARGET_SIZE, league_division_id: pool.id }),
    ),
    ...seedTeams({ division: MANAGER_ENTRY_DIVISION, count: POOL_TARGET_SIZE - 1, league_division_id: underFilledPool.id }),
  ];
  const supabase = createSupabaseDouble({ leagueDivisions: [...entryPools, ...overflowPools], teams });

  const result = await upsert({
    supabase, userId: "user-near-overflow", name: "Almost Saturated", managerName: "Manager",
  });

  assert.equal(result.team.division, MANAGER_ENTRY_DIVISION, "7/8 puljer mættet er IKKE nok → ingen overflow");
  assert.equal(
    result.team.league_division_id,
    underFilledPool.id,
    "holdet skal lande i den ene under-fyldte pulje (23 < POOL_TARGET_SIZE), ikke en mættet eller en overflow-pulje",
  );
});

test("#1608 bund-op: AI-, test- og frosne hold tæller ikke mod pulje-fyldningen", async () => {
  const pools = seedDiv4Pools();
  // pool[0] er proppet med AI/test/frosne hold (skal ignoreres) + 0 rigtige.
  // pool[1] har 3 rigtige hold. Mindst-fyldte (efter ægte filter) = pool[0] (0 rigtige).
  const supabase = createSupabaseDouble({
    leagueDivisions: pools,
    teams: [
      ...seedTeams({ division: MANAGER_ENTRY_DIVISION, count: POOL_TARGET_SIZE, league_division_id: pools[0].id, is_ai: true }),
      ...seedTeams({ division: MANAGER_ENTRY_DIVISION, count: POOL_TARGET_SIZE, league_division_id: pools[0].id, is_test_account: true }),
      ...seedTeams({ division: MANAGER_ENTRY_DIVISION, count: 3, league_division_id: pools[1].id }),
    ],
  });

  const result = await upsert({
    supabase,
    userId: "user-new",
    name: "Counts Humans Only",
    managerName: "Manager",
  });

  assert.equal(result.team.division, MANAGER_ENTRY_DIVISION);
  // pool[0] har 0 RIGTIGE hold (kun AI/test) → den (eller en anden tom pulje) er mindst-
  // fyldt; pool[1] med 3 rigtige hold må ikke vælges over en tom pulje.
  assert.notEqual(result.team.league_division_id, pools[1].id, "ægte filter ignorerer AI/test");
});

test("#1608 bund-op: graceful fallback — uden seeded puljer placeres holdet i tier 4 med NULL pulje", async () => {
  // Pre-migration / minimal-mock-edge: ingen league_divisions-rækker. Placeringen må
  // ikke kaste; holdet kommer stadig ind i tier 4 (division), league_division_id = null.
  const supabase = createSupabaseDouble({ leagueDivisions: [] });

  const result = await upsert({
    supabase,
    userId: "user-new",
    name: "No Pools Yet",
    managerName: "Manager",
  });

  assert.equal(result.team.division, MANAGER_ENTRY_DIVISION);
  assert.equal(result.team.league_division_id, null);
});

test("upsertOwnTeamProfile updates the existing team without duplicating the board profile", async () => {
  const supabase = createSupabaseDouble({
    teams: [
      {
        id: "team-1",
        user_id: "user-1",
        name: "Old Name",
        manager_name: "Old Manager",
        balance: 750,
        sponsor_income: 125,
      },
    ],
    boardProfiles: [
      { id: "board-1", team_id: "team-1" },
    ],
  });

  const result = await upsert({
    supabase,
    userId: "user-1",
    existingTeam: clone(supabase.state.teams[0]),
    name: "New Name",
    managerName: "New Manager",
  });

  assert.equal(result.created, false);
  assert.equal(result.boardProfileCreated, false);
  assert.equal(result.team.name, "New Name");
  assert.equal(result.team.manager_name, "New Manager");
  assert.equal(supabase.state.board_profiles.length, 1);
});

test("upsertOwnTeamProfile repairs legacy signup placeholder economy values", async () => {
  const supabase = createSupabaseDouble({
    teams: [
      {
        id: "team-1",
        user_id: "user-1",
        name: "Placeholder",
        manager_name: null,
        balance: 500,
        sponsor_income: 100,
      },
    ],
  });

  const result = await upsert({
    supabase,
    userId: "user-1",
    existingTeam: clone(supabase.state.teams[0]),
    name: "Chris Machines",
    managerName: "Chris",
  });

  assert.equal(result.created, false);
  assert.equal(result.team.balance, INITIAL_BALANCE);
  assert.equal(result.team.sponsor_income, SPONSOR_INCOME_BASE);
  assert.equal(result.boardProfileCreated, true);
  assert.equal(supabase.state.board_profiles[0].plan_start_balance, INITIAL_BALANCE);
  assert.equal(supabase.state.board_profiles[0].plan_start_sponsor_income, SPONSOR_INCOME_BASE);
});

test("upsertOwnTeamProfile does not overwrite real existing economy values", async () => {
  const supabase = createSupabaseDouble({
    teams: [
      {
        id: "team-1",
        user_id: "user-1",
        name: "Existing",
        manager_name: "Manager",
        balance: 750000,
        sponsor_income: 216000,
      },
    ],
    boardProfiles: [
      { id: "board-1", team_id: "team-1" },
    ],
  });

  const result = await upsert({
    supabase,
    userId: "user-1",
    existingTeam: clone(supabase.state.teams[0]),
    name: "Existing Renamed",
    managerName: "Manager",
  });

  assert.equal(result.team.balance, 750000);
  assert.equal(result.team.sponsor_income, 216000);
  assert.equal(result.boardProfileCreated, false);
});

test("upsertOwnTeamProfile rejects duplicate team names case-insensitively", async () => {
  const supabase = createSupabaseDouble({
    teams: [
      {
        id: "team-1",
        user_id: "user-1",
        name: "Alpha",
        manager_name: "Alex",
        balance: 500,
        sponsor_income: 100,
      },
      {
        id: "team-2",
        user_id: "user-2",
        name: "Rival Squad",
        manager_name: "Rival",
        balance: 500,
        sponsor_income: 100,
      },
    ],
  });

  await assert.rejects(
    () => upsert({
      supabase,
      userId: "user-1",
      existingTeam: clone(supabase.state.teams[0]),
      name: "rival squad",
      managerName: "Alex",
    }),
    (error) => error.statusCode === 409 && error.message.includes("allerede taget"),
  );
});

test("upsertOwnTeamProfile validates manager and team name lengths", async () => {
  const supabase = createSupabaseDouble();

  await assert.rejects(
    () => upsert({
      supabase,
      userId: "user-1",
      name: "AB",
      managerName: "Alex",
    }),
    (error) => error.statusCode === 400 && error.message.includes("Holdnavn"),
  );

  await assert.rejects(
    () => upsert({
      supabase,
      userId: "user-1",
      name: "Valid Team",
      managerName: "A",
    }),
    (error) => error.statusCode === 400 && error.message.includes("Managernavn"),
  );
});

// ── #1264 · Race-conditions: 23505-håndtering (empirisk bekræftet i load-testen) ──

function uniqueViolation({ constraint, keyDetail }) {
  return {
    code: "23505",
    message: `duplicate key value violates unique constraint "${constraint}"`,
    details: `Key ${keyDetail} already exists.`,
  };
}

const WINNER_TEAM = {
  id: "team-winner",
  user_id: "user-1",
  name: "Team Nova",
  manager_name: "Alex",
  balance: INITIAL_BALANCE,
  sponsor_income: SPONSOR_INCOME_BASE,
  division: 1,
  is_ai: false,
  is_test_account: false,
  is_frozen: false,
};

test("#1264 dobbelt-bootstrap: user_id-konflikt returnerer eksisterende hold idempotent (ikke 500)", async () => {
  // To samtidige PUT /api/teams/my for samme bruger: vinderen committer mellem
  // taberens precheck og insert → 23505 på teams_user_id_unique_idx.
  const supabase = createSupabaseDouble({
    insertErrors: {
      teams: [{
        error: uniqueViolation({ constraint: "teams_user_id_unique_idx", keyDetail: "(user_id)=(user-1)" }),
        seedRows: [WINNER_TEAM],
      }],
    },
  });

  const result = await upsert({
    supabase,
    userId: "user-1",
    name: "Team Nova",
    managerName: "Alex",
  });

  assert.equal(result.created, false);
  assert.equal(result.team.id, "team-winner");
  assert.equal(supabase.state.teams.length, 1);
  // Selvhelende: taber-kaldet sikrer stadig board-profilen for vinder-holdet.
  assert.equal(result.boardProfileCreated, true);
  assert.equal(supabase.state.board_profiles.length, 1);
  assert.equal(supabase.state.board_profiles[0].team_id, "team-winner");
});

test("#1264 navne-konflikt ved insert: bounded retry med suffiks giver holdet et nyt navn", async () => {
  // To FORSKELLIGE brugere racer om samme navn: taberen får 23505 på
  // teams_name_lower_unique_idx og skal ende med et fungerende hold (suffiks),
  // ikke en hold-løs konto.
  const supabase = createSupabaseDouble({
    insertErrors: {
      teams: [{
        error: uniqueViolation({ constraint: "teams_name_lower_unique_idx", keyDetail: "(lower(name))=(team nova)" }),
        seedRows: [WINNER_TEAM],
      }],
    },
  });

  const result = await upsert({
    supabase,
    userId: "user-2",
    name: "Team Nova",
    managerName: "Bobby",
  });

  assert.equal(result.created, true);
  assert.equal(result.team.name, "Team Nova 2");
  assert.equal(result.team.user_id, "user-2");
  assert.equal(supabase.state.teams.length, 2);
});

test("#1264 dobbelt-bootstrap med samme navn: navne-konflikt → retry → user_id-konflikt konvergerer idempotent", async () => {
  // Postgres kan rapportere 23505 på navne-indexet FØR user_id-indexet for
  // samme insert. Suffiks-retry skal derefter ramme user_id-konflikten og
  // konvergere til vinderens hold — ingen uendelig løkke, ingen 500.
  const supabase = createSupabaseDouble({
    boardProfiles: [{ id: "board-1", team_id: "team-winner" }],
    insertErrors: {
      teams: [
        {
          error: uniqueViolation({ constraint: "teams_name_lower_unique_idx", keyDetail: "(lower(name))=(team nova)" }),
          seedRows: [WINNER_TEAM],
        },
        {
          error: uniqueViolation({ constraint: "teams_user_id_unique_idx", keyDetail: "(user_id)=(user-1)" }),
        },
      ],
    },
  });

  const result = await upsert({
    supabase,
    userId: "user-1",
    name: "Team Nova",
    managerName: "Alex",
  });

  assert.equal(result.created, false);
  assert.equal(result.team.id, "team-winner");
  assert.equal(result.boardProfileCreated, false);
  assert.equal(supabase.state.teams.length, 1);
});

test("#1264 navne-konflikt: bounded retry opgiver med 409 efter alle forsøg", async () => {
  const nameConflict = () => ({
    error: uniqueViolation({ constraint: "teams_name_lower_unique_idx", keyDetail: "(lower(name))=(team nova)" }),
  });
  const supabase = createSupabaseDouble({
    insertErrors: {
      // 1 originalt forsøg + 3 retries — alle afvist.
      teams: [nameConflict(), nameConflict(), nameConflict(), nameConflict()],
    },
  });

  await assert.rejects(
    () => upsert({
      supabase,
      userId: "user-2",
      name: "Team Nova",
      managerName: "Bobby",
    }),
    (error) => error.statusCode === 409 && error.message.includes("allerede taget"),
  );

  assert.equal(supabase.state.teams.length, 0);
});

test("#1264 board-profil-konflikt (UNIQUE team_id+plan_type) behandles som allerede oprettet", async () => {
  const supabase = createSupabaseDouble({
    insertErrors: {
      board_profiles: [{
        error: uniqueViolation({ constraint: "board_profiles_team_id_plan_type_key", keyDetail: "(team_id, plan_type)=(teams-1, 1yr)" }),
      }],
    },
  });

  const result = await upsert({
    supabase,
    userId: "user-1",
    name: "Team Nova",
    managerName: "Alex",
  });

  assert.equal(result.created, true);
  assert.equal(result.boardProfileCreated, false);
});

test("#1264 rename til navn taget i race-vinduet giver 409 (ingen auto-suffiks på opdatering)", async () => {
  const supabase = createSupabaseDouble({
    teams: [
      {
        id: "team-mine",
        user_id: "user-2",
        name: "My Old Name",
        manager_name: "Bobby",
        balance: INITIAL_BALANCE,
        sponsor_income: SPONSOR_INCOME_BASE,
      },
    ],
    boardProfiles: [{ id: "board-1", team_id: "team-mine" }],
    updateErrors: {
      teams: [{
        error: uniqueViolation({ constraint: "teams_name_lower_unique_idx", keyDetail: "(lower(name))=(team nova)" }),
        seedRows: [WINNER_TEAM],
      }],
    },
  });

  await assert.rejects(
    () => upsert({
      supabase,
      userId: "user-2",
      existingTeam: clone(supabase.state.teams[0]),
      name: "Team Nova",
      managerName: "Bobby",
    }),
    (error) => error.statusCode === 409 && error.message.includes("allerede taget"),
  );
});

// ── #1560 · starter-squad-allokering koblet til hold-oprettelse ────────────────

test("#1560 created===true udløser starter-squad-allokering for det nye hold", async () => {
  const supabase = createSupabaseDouble();
  const calls = [];
  const recordingAllocate = async (_sb, teamId) => { calls.push(teamId); return { assigned: 8 }; };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    name: "Fresh Squad",
    managerName: "Manager",
    allocateStarterSquad: recordingAllocate,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
  });

  assert.equal(result.created, true);
  assert.equal(calls.length, 1, "allokering kaldt præcis én gang");
  assert.equal(calls[0], result.team.id, "allokering for det nye holds id");
});

test("#1560 created===false (rename) udløser IKKE allokering", async () => {
  const supabase = createSupabaseDouble({
    teams: [{
      id: "team-1", user_id: "user-1", name: "Old Name", manager_name: "Old Manager",
      balance: INITIAL_BALANCE, sponsor_income: SPONSOR_INCOME_BASE,
    }],
    boardProfiles: [{ id: "board-1", team_id: "team-1" }],
  });
  const calls = [];
  const recordingAllocate = async (_sb, teamId) => { calls.push(teamId); return { assigned: 8 }; };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    existingTeam: clone(supabase.state.teams[0]),
    name: "New Name",
    managerName: "New Manager",
    allocateStarterSquad: recordingAllocate,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
  });

  assert.equal(result.created, false);
  assert.equal(calls.length, 0, "rename må ikke allokere ny start-trup");
});

test("#1560 allokerings-fejl boblede op (holdet efterlades ikke stille tomt)", async () => {
  const supabase = createSupabaseDouble();
  const failingAllocate = async () => { throw new Error("derive nede"); };

  await assert.rejects(
    () => upsertOwnTeamProfile({
      supabase,
      userId: "user-err",
      name: "Will Fail",
      managerName: "Manager",
      allocateStarterSquad: failingAllocate,
    }),
    (error) => error.statusCode === 500 && error.message.includes("start-truppen kunne ikke tildeles"),
  );
});

test("#1560 created===false ved user_id-race udløser IKKE allokering (vinderen ejer truppen)", async () => {
  const supabase = createSupabaseDouble({
    insertErrors: {
      teams: [{
        error: uniqueViolation({ constraint: "teams_user_id_unique_idx", keyDetail: "(user_id)=(user-1)" }),
        seedRows: [WINNER_TEAM],
      }],
    },
  });
  const calls = [];
  const recordingAllocate = async (_sb, teamId) => { calls.push(teamId); return { assigned: 8 }; };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    name: "Team Nova",
    managerName: "Alex",
    allocateStarterSquad: recordingAllocate,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
  });

  assert.equal(result.created, false);
  assert.equal(calls.length, 0, "taber-kaldet må ikke allokere — vinderen gjorde det");
});

// ── Akademi-kuld koblet til hold-oprettelse (forever-relaunch, spejler #1560) ──

test("akademi: nyt hold (created===true) med flag ON får ét akademi-kuld for sit holds-id", async () => {
  const supabase = createSupabaseDouble();
  const academyCalls = [];
  const recordingAcademy = async (_sb, teamId) => { academyCalls.push(teamId); return { teamId, candidates: 4 }; };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    name: "Fresh Academy",
    managerName: "Manager",
    allocateStarterSquad: noopAllocate,
    runAcademyCohort: recordingAcademy,
    academyEnabled: async () => true,
  });

  assert.equal(result.created, true);
  assert.equal(academyCalls.length, 1, "akademi-kuld seedet præcis én gang");
  assert.equal(academyCalls[0], result.team.id, "akademi-kuld for det nye holds id");
});

test("akademi: flag OFF seeder INTET kuld (global gate)", async () => {
  const supabase = createSupabaseDouble();
  const academyCalls = [];
  const recordingAcademy = async (_sb, teamId) => { academyCalls.push(teamId); return { teamId, candidates: 4 }; };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    name: "No Academy Yet",
    managerName: "Manager",
    allocateStarterSquad: noopAllocate,
    runAcademyCohort: recordingAcademy,
    academyEnabled: async () => false,
  });

  assert.equal(result.created, true);
  assert.equal(academyCalls.length, 0, "flag OFF → ingen akademi-seeding");
});

test("akademi: rename (created===false) seeder INTET kuld", async () => {
  const supabase = createSupabaseDouble({
    teams: [{
      id: "team-1", user_id: "user-1", name: "Old Name", manager_name: "Old Manager",
      balance: INITIAL_BALANCE, sponsor_income: SPONSOR_INCOME_BASE,
    }],
    boardProfiles: [{ id: "board-1", team_id: "team-1" }],
  });
  const academyCalls = [];
  const recordingAcademy = async (_sb, teamId) => { academyCalls.push(teamId); return { teamId, candidates: 4 }; };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    existingTeam: clone(supabase.state.teams[0]),
    name: "New Name",
    managerName: "New Manager",
    allocateStarterSquad: noopAllocate,
    runAcademyCohort: recordingAcademy,
    academyEnabled: async () => true,
  });

  assert.equal(result.created, false);
  assert.equal(academyCalls.length, 0, "rename må ikke seede akademi-kuld");
});

test("akademi: kuld-fejl er IKKE-fatal — signup lykkes og start-truppen er tildelt", async () => {
  // Bevidst delvis-fejl-adfærd: et manglende akademi er en blødere, genoprettelig
  // blindgyde end en blokeret signup. En fejl i akademi-seedingen fanges (Sentry +
  // console.error) og signup fortsætter — holdet beholder sin start-trup.
  const supabase = createSupabaseDouble();
  const squadCalls = [];
  const recordingAllocate = async (_sb, teamId) => { squadCalls.push(teamId); return { assigned: 8 }; };
  const failingAcademy = async () => { throw new Error("derive nede"); };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    name: "Academy Soft Fail",
    managerName: "Manager",
    allocateStarterSquad: recordingAllocate,
    runAcademyCohort: failingAcademy,
    academyEnabled: async () => true,
  });

  assert.equal(result.created, true, "signup lykkes trods akademi-fejl");
  assert.equal(squadCalls.length, 1, "start-truppen blev tildelt");
  assert.equal(supabase.state.teams.length, 1, "holdet blev oprettet");
});

// ── #1739 · AI-fyld-trim koblet til hold-oprettelse ───────────────────────────
// Når et nyt ægte hold rykker ind i en pulje, skal ét AI-fyld-hold trimmes så
// pulje-størrelsen holdes konstant. Reconcile-stien er DI'et (reconcileAiTeams)
// så koblingen kan verificeres uden at mocke hele AI-generator-kæden.

test("#1739 created===true udløser AI-fyld-trim for den pulje holdet landede i", async () => {
  const pools = seedDiv4Pools();
  const supabase = createSupabaseDouble({ leagueDivisions: pools });
  const reconcileCalls = [];
  const recordingReconcile = async ({ poolId }) => { reconcileCalls.push(poolId); return { created: 0, removed: 1 }; };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    name: "Trim Trigger",
    managerName: "Manager",
    allocateStarterSquad: noopAllocate,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
    reconcileAiTeams: recordingReconcile,
  });

  assert.equal(result.created, true);
  assert.equal(reconcileCalls.length, 1, "trim kaldt præcis én gang");
  assert.equal(reconcileCalls[0], result.team.league_division_id, "trim for holdets pulje-id");
});

test("#1739 created===false (rename) udløser IKKE AI-fyld-trim", async () => {
  const supabase = createSupabaseDouble({
    teams: [{
      id: "team-1", user_id: "user-1", name: "Old Name", manager_name: "Old Manager",
      balance: INITIAL_BALANCE, sponsor_income: SPONSOR_INCOME_BASE, league_division_id: 8,
    }],
    boardProfiles: [{ id: "board-1", team_id: "team-1" }],
  });
  const reconcileCalls = [];
  const recordingReconcile = async ({ poolId }) => { reconcileCalls.push(poolId); return { created: 0, removed: 0 }; };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    existingTeam: clone(supabase.state.teams[0]),
    name: "New Name",
    managerName: "New Manager",
    allocateStarterSquad: noopAllocate,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
    reconcileAiTeams: recordingReconcile,
  });

  assert.equal(result.created, false);
  assert.equal(reconcileCalls.length, 0, "rename må ikke trimme AI-fyld");
});

test("#1739 holdet uden pulje (league_division_id=null) udløser IKKE trim", async () => {
  // Pre-migration / mock-edge: ingen puljer → holdet får league_division_id=null.
  // Der er intet pulje-felt at trimme mod, så reconcile springes.
  const supabase = createSupabaseDouble({ leagueDivisions: [] });
  const reconcileCalls = [];
  const recordingReconcile = async ({ poolId }) => { reconcileCalls.push(poolId); return { created: 0, removed: 0 }; };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    name: "No Pool Trim",
    managerName: "Manager",
    allocateStarterSquad: noopAllocate,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
    reconcileAiTeams: recordingReconcile,
  });

  assert.equal(result.created, true);
  assert.equal(result.team.league_division_id, null);
  assert.equal(reconcileCalls.length, 0, "ingen pulje → ingen trim");
});

test("#1739 trim-fejl er IKKE-fatal — signup lykkes og holdet beholder sin trup", async () => {
  // Bevidst delvis-fejl-adfærd (samme mønster som akademi-kuldet): et utrimmet
  // AI-hold er en kosmetisk pulje-overfyldning, ikke en blokeret signup. En fejl
  // fanges og signup fortsætter.
  const pools = seedDiv4Pools();
  const supabase = createSupabaseDouble({ leagueDivisions: pools });
  const squadCalls = [];
  const recordingAllocate = async (_sb, teamId) => { squadCalls.push(teamId); return { assigned: 8 }; };
  const failingReconcile = async () => { throw new Error("AI-generator nede"); };

  const result = await upsertOwnTeamProfile({
    supabase,
    userId: "user-1",
    name: "Trim Soft Fail",
    managerName: "Manager",
    allocateStarterSquad: recordingAllocate,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
    reconcileAiTeams: failingReconcile,
  });

  assert.equal(result.created, true, "signup lykkes trods trim-fejl");
  assert.equal(squadCalls.length, 1, "start-truppen blev tildelt");
  assert.equal(supabase.state.teams.length, 1, "holdet blev oprettet");
});

// ── #2022 · Sæson-agnostisk board-dannelse ────────────────────────────────────
// Et nyt holds identitets-grundlag skal sættes ved DANNELSE (uanset global sæson),
// ikke kun ved sæson-1-slut — ellers er en sæson-2+-nykommer permanent låst ude
// af DNA-valg. ensureSeasonIdentityBasis er den sæson-agnostiske skrive-sti.

test("#2022 ensureSeasonIdentityBasis beregner og skriver basis fra truppen for et nyt hold", async () => {
  const team = { id: "team-1", division: 3, season_1_identity_basis: null };
  const riders = Array.from({ length: 5 }, (_, i) => ({
    id: `r-${i}`, team_id: "team-1", nationality_code: "DK", is_u25: i < 2,
    stat_fl: 70, stat_sp: 60, market_value: 200000,
  }));
  const supabase = createSupabaseDouble({ teams: [team], riders });

  const written = await ensureSeasonIdentityBasis({ supabase, team });

  assert.equal(written, true, "basis skrives for et hold uden basis");
  const stored = supabase.state.teams[0].season_1_identity_basis;
  assert.ok(stored, "season_1_identity_basis skal være sat på team-rowen");
  assert.equal(stored.rider_count, 5, "basis afspejler den faktiske trup-størrelse");
});

test("#2022 ensureSeasonIdentityBasis er idempotent — rører ikke et hold der allerede har basis", async () => {
  const existing = { rider_count: 99, primary_specialization: "gc" };
  const team = { id: "team-1", division: 3, season_1_identity_basis: existing };
  const supabase = createSupabaseDouble({ teams: [team] });

  const written = await ensureSeasonIdentityBasis({ supabase, team });

  assert.equal(written, false, "et hold med basis skal ikke overskrives");
  assert.deepEqual(supabase.state.teams[0].season_1_identity_basis, existing);
});

test("#2022 ensureSeasonIdentityBasis stempler den FAKTISKE aktive sæson i grundlaget (ikke hardcoded 1)", async () => {
  const team = { id: "team-1", division: 4, season_1_identity_basis: null };
  const riders = [{ id: "r-0", team_id: "team-1", nationality_code: "DK", stat_fl: 60 }];
  // En sæson-3-nykommer: grundlaget skal observere sæson 3, ikke sæson 1.
  const supabase = createSupabaseDouble({
    teams: [team], riders,
    seasons: [{ id: "s-3", number: 3, status: "active" }],
  });

  const written = await ensureSeasonIdentityBasis({ supabase, team });

  assert.equal(written, true);
  const stored = supabase.state.teams[0].season_1_identity_basis;
  assert.equal(stored.season_number_observed, 3, "grundlaget afspejler den sæson holdet rent faktisk dannes i");
});

test("#2022 ensureSeasonIdentityBasis falder tilbage til sæson 1 når ingen aktiv sæson findes", async () => {
  const team = { id: "team-1", division: 4, season_1_identity_basis: null };
  const riders = [{ id: "r-0", team_id: "team-1", nationality_code: "DK", stat_fl: 60 }];
  const supabase = createSupabaseDouble({ teams: [team], riders, seasons: [] });

  await ensureSeasonIdentityBasis({ supabase, team });

  const stored = supabase.state.teams[0].season_1_identity_basis;
  assert.equal(stored.season_number_observed, 1, "uden aktiv sæson defaulter vi defensivt til 1");
});

test("#2022 upsertOwnTeamProfile sætter identitets-grundlag fra start-truppen ved dannelse", async () => {
  const pools = seedDiv4Pools();
  const supabase = createSupabaseDouble({ leagueDivisions: pools });
  // Allokerings-stub der seeder en faktisk start-trup, så vi kan verificere at
  // grundlaget beregnes EFTER allokering (rider_count > 0), ikke på en tom trup.
  const allocateWithRiders = async (sb, teamId) => {
    await sb.from("riders").insert(
      Array.from({ length: 6 }, (_, i) => ({ id: `r-${teamId}-${i}`, team_id: teamId, nationality_code: "DK" })),
    );
    return { assigned: 6 };
  };

  const result = await upsertOwnTeamProfile({
    supabase, userId: "user-1", name: "Identity At Birth", managerName: "Manager",
    allocateStarterSquad: allocateWithRiders,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
    reconcileAiTeams: noopReconcileAiTeams,
  });

  const stored = supabase.state.teams.find((t) => t.id === result.team.id)?.season_1_identity_basis;
  assert.ok(stored, "et nyt hold skal have season_1_identity_basis sat ved dannelse");
  assert.equal(stored.rider_count, 6, "grundlaget beregnes fra den allokerede start-trup, ikke en tom trup");
});

// ── #2022 fase 2 · Board-mål kalibreret ved dannelse ──────────────────────────
// createInitialBoardProfile genererer statiske fallback-mål (min_riders 15) fordi
// det kaldes FØR start-truppen findes. ensureBoardGoalsCalibrated kører EFTER
// allokeringen og erstatter et pending formations-boards mål med dem
// generateBoardGoals giver MED trup-kontekst — så et entry-hold ikke fastlåses af
// et strukturelt uopnåeligt min_riders-mål (#2022 fase 1's postmortem).

test("#2022 ensureBoardGoalsCalibrated kalibrerer et pending formations-boards mål mod truppen", async () => {
  const team = { id: "team-1", division: 3, sponsor_income: 100, balance: 0 };
  const staticGoals = generateBoardGoals({ focus: "balanced", planType: "1yr" });
  assert.equal(staticGoals.find((g) => g.type === "min_riders").target, 15, "udgangspunkt: statisk min_riders er 15");
  const board = {
    id: "bp-1", team_id: "team-1", plan_type: "1yr", focus: "balanced",
    is_baseline: false, negotiation_status: "pending", current_goals: staticGoals,
  };
  const nats = ["FR", "IT", "ES", "BE", "NL", "DE", "GB", "DK", "SE"];
  const riders = Array.from({ length: 9 }, (_, i) => ({
    id: `r-${i}`, team_id: "team-1", nationality_code: nats[i], is_u25: i < 3, stat_fl: 60,
  }));
  const supabase = createSupabaseDouble({ teams: [team], boardProfiles: [board], riders });

  const updated = await ensureBoardGoalsCalibrated({ supabase, team });

  assert.equal(updated, true, "et pending formations-board kalibreres");
  const stored = supabase.state.board_profiles[0].current_goals;
  const minRiders = stored.find((g) => g.type === "min_riders");
  assert.ok(minRiders.target <= riders.length, "kalibreret min_riders er opnåeligt for truppen");
  assert.notEqual(minRiders.target, 15, "den statiske 15 er erstattet");
});

test("#2022 ensureBoardGoalsCalibrated rører ikke et completed/forhandlet board", async () => {
  const team = { id: "team-1", division: 3, sponsor_income: 100, balance: 0 };
  const negotiated = generateBoardGoals({ focus: "balanced", planType: "1yr" });
  const board = {
    id: "bp-1", team_id: "team-1", plan_type: "1yr", focus: "balanced",
    is_baseline: false, negotiation_status: "completed", current_goals: negotiated,
  };
  const riders = [{ id: "r-0", team_id: "team-1", is_u25: false }];
  const supabase = createSupabaseDouble({ teams: [team], boardProfiles: [board], riders });

  const updated = await ensureBoardGoalsCalibrated({ supabase, team });

  assert.equal(updated, false, "kun pending formations-boards kalibreres");
  assert.deepEqual(supabase.state.board_profiles[0].current_goals, negotiated, "forhandlede mål bevares");
});

test("#2022 ensureBoardGoalsCalibrated er no-op når truppen endnu er tom (defensivt)", async () => {
  const team = { id: "team-1", division: 3, sponsor_income: 100, balance: 0 };
  const staticGoals = generateBoardGoals({ focus: "balanced", planType: "1yr" });
  const board = {
    id: "bp-1", team_id: "team-1", plan_type: "1yr", focus: "balanced",
    is_baseline: false, negotiation_status: "pending", current_goals: staticGoals,
  };
  const supabase = createSupabaseDouble({ teams: [team], boardProfiles: [board], riders: [] });

  const updated = await ensureBoardGoalsCalibrated({ supabase, team });

  assert.equal(updated, false, "uden trup beholdes de statiske mål");
  assert.deepEqual(supabase.state.board_profiles[0].current_goals, staticGoals);
});

test("#2022 upsertOwnTeamProfile kalibrerer board-mål mod start-truppen ved dannelse", async () => {
  const pools = seedDiv4Pools();
  const supabase = createSupabaseDouble({ leagueDivisions: pools });
  const allocateWithRiders = async (sb, teamId) => {
    const nats = ["FR", "IT", "ES", "BE", "NL", "DE", "GB", "DK"];
    await sb.from("riders").insert(
      Array.from({ length: 8 }, (_, i) => ({ id: `r-${teamId}-${i}`, team_id: teamId, nationality_code: nats[i], is_u25: i < 3 })),
    );
    return { assigned: 8 };
  };

  const result = await upsertOwnTeamProfile({
    supabase, userId: "user-1", name: "Calibrated At Birth", managerName: "Manager",
    allocateStarterSquad: allocateWithRiders,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
    reconcileAiTeams: noopReconcileAiTeams,
  });

  const board = supabase.state.board_profiles.find((b) => b.team_id === result.team.id);
  const minRiders = board.current_goals.find((g) => g.type === "min_riders");
  assert.ok(minRiders, "formations-boardet har et min_riders-mål");
  assert.ok(minRiders.target <= 8, "min_riders kalibreret til start-truppen (≤8), ikke statisk 15");
  assert.notEqual(minRiders.target, 15, "den statiske 15 omgås nu ved dannelse");
});

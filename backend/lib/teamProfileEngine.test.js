import test from "node:test";
import assert from "node:assert/strict";

import { upsertOwnTeamProfile } from "./teamProfileEngine.js";
import { INITIAL_BALANCE, MANAGER_ENTRY_DIVISION, POOL_TARGET_SIZE, SPONSOR_INCOME_BASE } from "./economyConstants.js";

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
function upsert(args) {
  return upsertOwnTeamProfile({
    allocateStarterSquad: noopAllocate,
    runAcademyCohort: noopRunAcademyCohort,
    academyEnabled: academyDisabled,
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

    return true;
  });
}

// insertErrors/updateErrors: { [table]: [{ error, seedRows? }, ...] } — kø der
// forbruges pr. forsøg. Modellerer #1264-racet: applikations-precheck (select)
// ser INTET, men DB'en afviser insert/update med 23505 fordi en samtidig
// transaktion nåede at committe (seedRows = den samtidige vinders rækker).
function createSupabaseDouble({ teams = [], boardProfiles = [], leagueDivisions = [], insertErrors = {}, updateErrors = {} } = {}) {
  const state = {
    teams: clone(teams),
    board_profiles: clone(boardProfiles),
    league_divisions: clone(leagueDivisions),
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
  assert.equal(INITIAL_BALANCE, 800000, "DB-default i schema.sql:30 er 800000");

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

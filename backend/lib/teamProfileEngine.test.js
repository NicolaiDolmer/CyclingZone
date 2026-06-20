import test from "node:test";
import assert from "node:assert/strict";

import { upsertOwnTeamProfile } from "./teamProfileEngine.js";
import { DIVISION_CAPACITY, INITIAL_BALANCE, SPONSOR_INCOME_BASE } from "./economyConstants.js";

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

function seedTeams({ division, count, is_ai = false, is_frozen = false, is_test_account = false }) {
  const kind = is_ai ? "ai" : is_frozen ? "frozen" : is_test_account ? "test" : "human";
  return Array.from({ length: count }, (_, index) => ({
    id: `seed-div${division}-${kind}-${index}`,
    user_id: `seed-user-${division}-${kind}-${index}`,
    name: `Seed ${division} ${kind} ${index}`,
    division,
    is_ai,
    is_frozen,
    is_test_account,
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
function createSupabaseDouble({ teams = [], boardProfiles = [], insertErrors = {}, updateErrors = {} } = {}) {
  const state = {
    teams: clone(teams),
    board_profiles: clone(boardProfiles),
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

  const supabase = createSupabaseDouble();
  const result = await upsert({
    supabase,
    userId: "user-1",
    name: "Sponsor Check",
    managerName: "Manager",
  });

  assert.equal(result.team.sponsor_income, SPONSOR_INCOME_BASE);
  assert.equal(result.team.balance, INITIAL_BALANCE);
  // #962 fyld-fra-toppen: uden eksisterende hold lander det første hold i div 1.
  assert.equal(result.team.division, 1);
});

test("#962 fyld-fra-toppen: nyt hold lander i div 2 når div 1 er fyldt", async () => {
  const supabase = createSupabaseDouble({
    teams: seedTeams({ division: 1, count: DIVISION_CAPACITY }),
  });

  const result = await upsert({
    supabase,
    userId: "user-new",
    name: "Overflow To Two",
    managerName: "Manager",
  });

  assert.equal(result.team.division, 2);
});

test("#962 fyld-fra-toppen: nyt hold lander i div 3 (overflow) når div 1 og 2 er fyldt", async () => {
  const supabase = createSupabaseDouble({
    teams: [
      ...seedTeams({ division: 1, count: DIVISION_CAPACITY }),
      ...seedTeams({ division: 2, count: DIVISION_CAPACITY }),
    ],
  });

  const result = await upsert({
    supabase,
    userId: "user-new",
    name: "Overflow To Three",
    managerName: "Manager",
  });

  assert.equal(result.team.division, 3);
});

test("#962 fyld-fra-toppen: blød cap — div 3 må vokse forbi kapaciteten", async () => {
  const supabase = createSupabaseDouble({
    teams: [
      ...seedTeams({ division: 1, count: DIVISION_CAPACITY }),
      ...seedTeams({ division: 2, count: DIVISION_CAPACITY }),
      ...seedTeams({ division: 3, count: DIVISION_CAPACITY }),
    ],
  });

  const result = await upsert({
    supabase,
    userId: "user-new",
    name: "Soft Cap Overflow",
    managerName: "Manager",
  });

  assert.equal(result.team.division, 3);
});

test("#962 fyld-fra-toppen: AI-, test- og frosne hold tæller ikke mod kapaciteten", async () => {
  const supabase = createSupabaseDouble({
    teams: [
      ...seedTeams({ division: 1, count: DIVISION_CAPACITY, is_ai: true }),
      ...seedTeams({ division: 1, count: DIVISION_CAPACITY, is_frozen: true }),
      ...seedTeams({ division: 1, count: DIVISION_CAPACITY, is_test_account: true }),
      ...seedTeams({ division: 1, count: 5 }),
    ],
  });

  const result = await upsert({
    supabase,
    userId: "user-new",
    name: "Counts Humans Only",
    managerName: "Manager",
  });

  // Kun 5 rigtige menneske-hold i div 1 → der er stadig plads i toppen.
  assert.equal(result.team.division, 1);
});

test("#962 fyld-fra-toppen: test-konti fylder ikke en division (regression — ranglisten skjuler dem)", async () => {
  // Bug fanget i prod: 3 test-konti + 17 rigtige hold i div 1 nåede cap=20 og
  // skubbede rigtige hold til div 2, mens ranglisten kun viste 17 i div 1.
  const supabase = createSupabaseDouble({
    teams: [
      ...seedTeams({ division: 1, count: 17 }),
      ...seedTeams({ division: 1, count: 3, is_test_account: true }),
    ],
  });

  const result = await upsert({
    supabase,
    userId: "user-new",
    name: "Real Team Eighteen",
    managerName: "Manager",
  });

  // 17 rigtige + 3 test = 20 rækker, men kun 17 tæller → der er plads i div 1.
  assert.equal(result.team.division, 1);
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

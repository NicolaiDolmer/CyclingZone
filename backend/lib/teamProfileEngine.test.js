import test from "node:test";
import assert from "node:assert/strict";

import { upsertOwnTeamProfile } from "./teamProfileEngine.js";

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

function createSupabaseDouble({ teams = [], boardProfiles = [] } = {}) {
  const state = {
    teams: clone(teams),
    board_profiles: clone(boardProfiles),
    updates: [],
    inserts: [],
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

  function createUpdateQuery(table, payload) {
    const filters = [];

    const execute = () => {
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

  const result = await upsertOwnTeamProfile({
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

  const result = await upsertOwnTeamProfile({
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
    () => upsertOwnTeamProfile({
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
    () => upsertOwnTeamProfile({
      supabase,
      userId: "user-1",
      name: "AB",
      managerName: "Alex",
    }),
    (error) => error.statusCode === 400 && error.message.includes("Holdnavn"),
  );

  await assert.rejects(
    () => upsertOwnTeamProfile({
      supabase,
      userId: "user-1",
      name: "Valid Team",
      managerName: "A",
    }),
    (error) => error.statusCode === 400 && error.message.includes("Managernavn"),
  );
});

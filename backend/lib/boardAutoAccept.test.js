// #2104 · Tests for skånefristen i board-auto-accept-cronen.
//
// race_days_completed er et globalt sæson-ur — uden skånefrist står et hold
// oprettet midt i sæsonen "over deadline" fra minut ét og får DNA + plan
// tvangsvalgt af næste cron-tick (ramte Team CSC 2/7). Dækker:
//   - isWithinNewTeamGrace (pure function)
//   - processBoardAutoAcceptCron skipper unge hold helt (ingen reminder/accept)
//   - kontrol: hold ældre end fristen auto-accepteres fortsat

import test from "node:test";
import assert from "node:assert/strict";

import {
  NEW_TEAM_GRACE_DAYS,
  isWithinNewTeamGrace,
  processBoardAutoAcceptCron,
} from "./boardAutoAccept.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-02T15:00:00Z");

// =====================================================================
// isWithinNewTeamGrace — pure function
// =====================================================================

test("isWithinNewTeamGrace: hold oprettet for 1 dag siden er i skånefrist", () => {
  const createdAt = new Date(NOW.getTime() - 1 * DAY_MS).toISOString();
  assert.equal(isWithinNewTeamGrace(createdAt, NOW), true);
});

test("isWithinNewTeamGrace: hold oprettet for 30 dage siden er UDE af skånefrist", () => {
  const createdAt = new Date(NOW.getTime() - 30 * DAY_MS).toISOString();
  assert.equal(isWithinNewTeamGrace(createdAt, NOW), false);
});

test("isWithinNewTeamGrace: præcis på grænsen (NEW_TEAM_GRACE_DAYS dage) er UDE af fristen", () => {
  const createdAt = new Date(NOW.getTime() - NEW_TEAM_GRACE_DAYS * DAY_MS).toISOString();
  assert.equal(isWithinNewTeamGrace(createdAt, NOW), false);
});

test("isWithinNewTeamGrace: null/ugyldig created_at behandles som UDE af fristen (fail-open til eksisterende adfærd)", () => {
  assert.equal(isWithinNewTeamGrace(null, NOW), false);
  assert.equal(isWithinNewTeamGrace(undefined, NOW), false);
  assert.equal(isWithinNewTeamGrace("not-a-date", NOW), false);
});

// =====================================================================
// processBoardAutoAcceptCron — orchestrator med fake supabase
// =====================================================================

// Minimal fake supabase (samme mønster som boardMidSeason.test.js) —
// understøtter select/eq/order/limit/maybeSingle/upsert/update.
function makeFakeSupabase(state) {
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function ensureTable(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  }

  function makeQuery(table, action, payload = null) {
    const filters = [];
    let order = null;
    let limit = null;

    function matches(row) {
      return filters.every((f) => {
        if (f.type === "eq") return row[f.column] === f.value;
        return true;
      });
    }

    function execute() {
      const rows = ensureTable(table);
      if (action === "select") {
        let result = rows.filter(matches);
        if (order) {
          result = [...result].sort((a, b) => {
            const av = a[order.column]; const bv = b[order.column];
            if (av === bv) return 0;
            return (av < bv ? -1 : 1) * (order.ascending ? 1 : -1);
          });
        }
        if (limit != null) result = result.slice(0, limit);
        return Promise.resolve({ data: clone(result), error: null });
      }
      if (action === "upsert") {
        const newRows = Array.isArray(payload) ? payload : [payload];
        for (const newRow of newRows) {
          const idx = rows.findIndex((r) => r.team_id === newRow.team_id && r.plan_type === newRow.plan_type);
          if (idx >= 0) rows[idx] = { ...rows[idx], ...clone(newRow) };
          else rows.push({ id: `${table}-${rows.length + 1}`, ...clone(newRow) });
        }
        return Promise.resolve({ data: clone(newRows), error: null });
      }
      if (action === "update") {
        for (const row of rows.filter(matches)) Object.assign(row, clone(payload));
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }

    const query = {
      eq(column, value) { filters.push({ type: "eq", column, value }); return query; },
      order(column, opts = {}) { order = { column, ascending: opts.ascending !== false }; return query; },
      limit(n) { limit = n; return query; },
      select() { return query; },
      single() { return execute().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })); },
      maybeSingle() { return execute().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return query;
  }

  return {
    from(table) {
      return {
        select() { return makeQuery(table, "select"); },
        upsert(payload) { return makeQuery(table, "upsert", payload); },
        update(payload) { return makeQuery(table, "update", payload); },
      };
    },
  };
}

function makeCronState({ teamCreatedAt }) {
  return {
    transfer_windows: [
      { id: "tw-1", board_negotiation_state: "pending_5yr", created_at: "2026-06-22T00:00:00Z" },
    ],
    seasons: [
      { id: "season-1", number: 2, status: "active", race_days_completed: 10, race_days_total: 60 },
    ],
    teams: [
      {
        id: "team-1",
        user_id: "user-1",
        name: "Team Grace",
        balance: 500000,
        sponsor_income: 240000,
        division: 3,
        season_1_identity_basis: null,
        team_dna_key: "sprint_kommerciel", // sat → auto-accept rører ikke DNA-grenen
        created_at: teamCreatedAt,
        is_ai: false,
        is_bank: false,
        is_frozen: false,
        is_test_account: false,
      },
    ],
    board_profiles: [
      {
        id: "bp-1", team_id: "team-1", plan_type: "5yr", focus: "balanced",
        negotiation_status: "pending", is_baseline: false,
      },
    ],
    riders: [],
    season_standings: [],
  };
}

test("processBoardAutoAcceptCron: hold i skånefrist skippes — ingen reminder, ingen auto-accept", async () => {
  const state = makeCronState({
    teamCreatedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
  });
  const notifications = [];
  const summary = await processBoardAutoAcceptCron({
    supabase: makeFakeSupabase(state),
    notifyUser: async (args) => { notifications.push(args); return { delivered: true }; },
    now: NOW,
  });

  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.auto_accepted, 0);
  assert.equal(summary.reminders_sent, 0);
  assert.equal(summary.errors, 0);
  assert.equal(notifications.length, 0, "ingen notifikationer til hold i skånefrist");
  const board = state.board_profiles.find((b) => b.team_id === "team-1" && b.plan_type === "5yr");
  assert.equal(board.negotiation_status, "pending", "planen står stadig til forhandling");
});

test("processBoardAutoAcceptCron: hold ældre end skånefristen auto-accepteres fortsat", async () => {
  const state = makeCronState({
    teamCreatedAt: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
  });
  const notifications = [];
  const summary = await processBoardAutoAcceptCron({
    supabase: makeFakeSupabase(state),
    notifyUser: async (args) => { notifications.push(args); return { delivered: true }; },
    now: NOW,
  });

  assert.equal(summary.teams_checked, 1);
  assert.equal(summary.auto_accepted, 1, "gammelt hold auto-accepteres som hidtil");
  assert.equal(summary.errors, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].metadata.titleCode, "notif.boardAutoAccepted.title");
  const board = state.board_profiles.find((b) => b.team_id === "team-1" && b.plan_type === "5yr");
  assert.equal(board.negotiation_status, "completed");
});

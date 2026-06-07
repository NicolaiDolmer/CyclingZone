import test from "node:test";
import assert from "node:assert/strict";

import { developRidersForSeason, ageForSeason, LAUNCH_REFERENCE_YEAR } from "./riderProgressionEngine.js";

// ── Minimal in-memory Supabase-mock (kun det engine'n bruger) ──────────────────
function createMockSupabase(state) {
  function builder(table, op = "select", filters = [], patch = null) {
    const matches = (row) => filters.every(([c, v]) => row[c] === v);
    return {
      select() { return builder(table, "select", filters, patch); },
      eq(col, val) {
        const nf = [...filters, [col, val]];
        if (op === "update") {
          for (const row of state[table]) if (nf.every(([c, v]) => row[c] === v)) Object.assign(row, patch);
          return Promise.resolve({ error: null });
        }
        return builder(table, op, nf, patch);
      },
      order() { return builder(table, op, filters, patch); },
      update(p) { return builder(table, "update", filters, p); },
      range(from, to) {
        return Promise.resolve({ data: state[table].filter(matches).slice(from, to + 1), error: null });
      },
      single() {
        const row = state[table].filter(matches)[0] ?? null;
        return Promise.resolve({ data: row, error: null });
      },
      upsert(rows, opts = {}) {
        const conflict = (opts.onConflict || "").split(",").map((s) => s.trim()).filter(Boolean);
        for (const r of (Array.isArray(rows) ? rows : [rows])) {
          const exists = conflict.length && state[table].some((x) => conflict.every((c) => x[c] === r[c]));
          if (exists && opts.ignoreDuplicates) continue;
          state[table].push({ ...r });
        }
        return Promise.resolve({ error: null });
      },
    };
  }
  return { from: (table) => { state[table] ??= []; return builder(table); } };
}

const ABILITY_DEFAULTS = { climbing: 55, time_trial: 55, prolog: 50, flat: 55, tempo: 55, sprint: 55, acceleration: 55, punch: 55, endurance: 55, recovery: 55, durability: 55, descending: 55, cobblestone: 55, positioning: 55, aggression: 55 };

function seedState({ riders, abilities }) {
  return {
    riders: riders.map((r) => ({ ...r })),
    rider_derived_abilities: abilities.map((a) => ({ ...ABILITY_DEFAULTS, ...a })),
    rider_development_log: [],
    teams: [{ id: "team-1", user_id: "user-1" }],
  };
}

const MODEL = { a: 6.14, b: 0.126, offset: {} };

test("ageForSeason er sæson-drevet (sæson 1 = launch-året)", () => {
  assert.equal(ageForSeason("2005-03-01", 1), LAUNCH_REFERENCE_YEAR - 2005); // 21
  assert.equal(ageForSeason("2005-03-01", 4), LAUNCH_REFERENCE_YEAR + 3 - 2005); // 24
  assert.equal(ageForSeason(null, 2), null);
});

test("ung høj-pot rytter udvikler sig + base_value stiger + caps initialiseres", async () => {
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: null, firstname: "Ung", lastname: "Talent" }],
    abilities: [{ rider_id: "r1", climbing: 55, tempo: 55, endurance: 55, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  const summary = await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2, model: MODEL });

  assert.equal(summary.developed, 1);
  assert.equal(summary.grew, 1);
  assert.equal(summary.caps_initialised, 1);
  const ab = state.rider_derived_abilities[0];
  assert.ok(ab.climbing > 55, "signatur-evne steg");
  assert.ok(ab.ability_caps && ab.ability_caps.climbing > 55, "loft sat fra baseline");
  assert.ok(state.riders[0].base_value > 100000, "base_value steg med abilities");
  assert.equal(state.rider_development_log.length, 1, "snapshot skrevet til dev-log");
});

test("idempotent: anden kørsel skipper alle og muterer intet yderligere", async () => {
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: null, firstname: "A", lastname: "B" }],
    abilities: [{ rider_id: "r1", climbing: 55, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2, model: MODEL });
  const afterFirst = state.rider_derived_abilities[0].climbing;
  const bvFirst = state.riders[0].base_value;

  const summary2 = await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2, model: MODEL });
  assert.equal(summary2.developed, 0);
  assert.equal(summary2.skipped_already_done, 1);
  assert.equal(state.rider_derived_abilities[0].climbing, afterFirst, "abilities uændret ved re-run");
  assert.equal(state.riders[0].base_value, bvFirst, "base_value uændret ved re-run");
  assert.equal(state.rider_development_log.length, 1, "ingen dublet-snapshot");
});

test("garanteret retirement ved 40 + notifikation til ejer-hold", async () => {
  // født 1986 → ved sæson 2 (2027): alder 41 → garanteret retirement
  const notified = [];
  const state = seedState({
    riders: [{ id: "old", primary_type: "sprinter", potentiale: 5, birthdate: "1986-01-01", base_value: 50000, is_u25: false, is_retired: false, team_id: "team-1", firstname: "Gammel", lastname: "Rytter" }],
    abilities: [{ rider_id: "old", sprint: 70, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  const summary = await developRidersForSeason({
    supabase, seasonId: "s2", seasonNumber: 2, model: MODEL,
    notifyTeamOwnerFn: async (args) => { notified.push(args); return { delivered: true }; },
  });

  assert.equal(summary.retired, 1);
  assert.equal(state.riders[0].is_retired, true);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].type, "rider_retired");
  assert.equal(notified[0].teamId, "team-1");
});

test("is_u25 opdateres når rytter passerer 25 (board #813 ser aldringen)", async () => {
  // født 2003 → ved sæson 1 (2026) er 23 (u25), ved sæson 4 (2029) er 26 (ikke u25)
  const state = seedState({
    riders: [{ id: "r1", primary_type: "rouleur", potentiale: 3, birthdate: "2003-01-01", base_value: 50000, is_u25: true, is_retired: false, team_id: null, firstname: "X", lastname: "Y" }],
    abilities: [{ rider_id: "r1", flat: 60, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  await developRidersForSeason({ supabase, seasonId: "s4", seasonNumber: 4, model: MODEL });
  assert.equal(state.riders[0].is_u25, false, "rytter på 26 er ikke længere U25");
});

test("pensionerede ryttere udvikles ikke (filtreret på is_retired)", async () => {
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: true, team_id: null, firstname: "Pen", lastname: "Sioneret" }],
    abilities: [{ rider_id: "r1", climbing: 55, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  const summary = await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2, model: MODEL });
  assert.equal(summary.developed, 0);
});

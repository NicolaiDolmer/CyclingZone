import { test } from "node:test";
import assert from "node:assert/strict";

import { fillMissingTeamEntries } from "./raceRunner.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { POOL_TARGET_SIZE } from "./economyConstants.js";

// #1688 (forever-relaunch race-scale): fillMissingTeamEntries får en PULJE-FILTER
// (kun hold i løbets pulje, race.league_division_id) + et FELT-CAP på
// POOL_TARGET_SIZE (24). Ved >24 egnede hold vælges de 24 stærkeste på aggregeret
// roster-base_value. Den simple makeSupabase-mock i raceRunner.test.js anvender
// IKKE DB-filtre (eq/in er no-ops), så vi bruger en mock der returnerer canned
// rækker ufiltreret — præcis det miljø hvor app-koden SELV skal filtrere.

function abil(overrides = {}) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = 50;
  return Object.assign(a, overrides);
}

// Mock-supabase der returnerer hele canned-tabellen pr. .from(table) (eq/in/or/gte
// er no-ops — som den rigtige test-mock). Fanger inserts i __writes.
function makeSupabase(canned = {}) {
  const writes = [];
  function from(table) {
    const b = {
      select() { return b; },
      eq() { return b; },
      in() { return b; },
      or() { return b; },
      order() { return b; },
      gte() { return b; },
      insert(rows) { writes.push({ table, op: "insert", rows }); return Promise.resolve({ error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: canned[table] || [], error: null }).then(resolve, reject); },
    };
    return b;
  }
  return { from, __writes: writes };
}

// Byg N hold i pulje `poolId` med 8 ryttere hver (base_value styret pr. hold), +
// abilities så de kan auto-scores. Returnerer canned-state.
function buildPoolState({ teamsInPool, otherPoolTeams = [], poolId = 100 }) {
  const teams = [];
  const riders = [];
  const abilities = [];
  let riderCounter = 0;

  function addTeam(teamId, leaguePoolId, perRiderBaseValue) {
    teams.push({ id: teamId, is_test_account: false, is_frozen: false, is_ai: false, league_division_id: leaguePoolId });
    for (let i = 0; i < 8; i++) {
      const rid = `r-${riderCounter++}`;
      riders.push({ id: rid, team_id: teamId, base_value: perRiderBaseValue });
      abilities.push({ rider_id: rid, ...abil() });
    }
  }

  teamsInPool.forEach((t) => addTeam(t.id, poolId, t.base_value));
  otherPoolTeams.forEach((t) => addTeam(t.id, t.poolId ?? (poolId + 1), t.base_value));

  return {
    race_entries: [],
    teams,
    riders,
    rider_derived_abilities: abilities,
    rider_condition: [],
  };
}

test("fillMissingTeamEntries: hold fra andre puljer ekskluderes når race har league_division_id", async () => {
  const poolId = 100;
  const state = buildPoolState({
    poolId,
    teamsInPool: [
      { id: "in-1", base_value: 1000 },
      { id: "in-2", base_value: 1000 },
    ],
    otherPoolTeams: [
      { id: "out-1", base_value: 9999, poolId: 200 },
      { id: "out-2", base_value: 9999, poolId: 200 },
    ],
  });
  const supabase = makeSupabase(state);

  const rows = await fillMissingTeamEntries({
    supabase,
    race: { id: "race-pool", league_division_id: poolId },
    stages: [],
    existingEntries: [],
    persist: false,
  });

  const teamIds = new Set(rows.map((r) => r.team_id));
  assert.ok(teamIds.has("in-1") && teamIds.has("in-2"), "hold i puljen skal auto-fyldes");
  assert.ok(!teamIds.has("out-1") && !teamIds.has("out-2"), "hold fra andre puljer må IKKE auto-fyldes");
});

test("fillMissingTeamEntries: felt-cap — pulje med >24 hold giver præcis 24 hold i feltet", async () => {
  const poolId = 100;
  // 30 hold i puljen → cap på POOL_TARGET_SIZE (24).
  const teamsInPool = Array.from({ length: 30 }, (_, i) => ({
    id: `t-${i}`,
    // Stigende base_value → de højeste indekser er stærkest.
    base_value: 1000 + i * 100,
  }));
  const state = buildPoolState({ poolId, teamsInPool });
  const supabase = makeSupabase(state);

  const rows = await fillMissingTeamEntries({
    supabase,
    race: { id: "race-cap", league_division_id: poolId },
    stages: [],
    existingEntries: [],
    persist: false,
  });

  const teamIds = new Set(rows.map((r) => r.team_id));
  assert.equal(teamIds.size, POOL_TARGET_SIZE, `feltet skal cappes til ${POOL_TARGET_SIZE} hold`);
});

test("fillMissingTeamEntries: felt-cap vælger de STÆRKESTE hold (top base_value)", async () => {
  const poolId = 100;
  // 26 hold: base_value = index. De 2 svageste (index 0,1) skal skæres væk.
  const teamsInPool = Array.from({ length: 26 }, (_, i) => ({
    id: `t-${i}`,
    base_value: 1000 + i * 100,
  }));
  const state = buildPoolState({ poolId, teamsInPool });
  const supabase = makeSupabase(state);

  const rows = await fillMissingTeamEntries({
    supabase,
    race: { id: "race-strong", league_division_id: poolId },
    stages: [],
    existingEntries: [],
    persist: false,
  });

  const teamIds = new Set(rows.map((r) => r.team_id));
  assert.equal(teamIds.size, POOL_TARGET_SIZE);
  // De 2 svageste hold (t-0, t-1) er skåret væk; de 24 stærkeste (t-2..t-25) er med.
  assert.ok(!teamIds.has("t-0"), "svageste hold t-0 skal cappes væk");
  assert.ok(!teamIds.has("t-1"), "næstsvageste hold t-1 skal cappes væk");
  assert.ok(teamIds.has("t-25"), "stærkeste hold t-25 skal være med");
  assert.ok(teamIds.has("t-2"), "grænse-hold t-2 (lige inden for top-24) skal være med");
});

test("fillMissingTeamEntries: uden race.league_division_id (ingen pulje) — felt-cap gælder stadig, global pulje", async () => {
  // Pre-per-pool-race-virkelighed: races bærer endnu ingen pulje. Pulje-filteret
  // springes over (alle hold er ét felt), men felt-cap'et SKAL stadig beskytte mod
  // et kæmpe-felt. 30 hold uden pulje → 24.
  const teamsInPool = Array.from({ length: 30 }, (_, i) => ({
    id: `t-${i}`,
    base_value: 1000 + i * 100,
  }));
  const state = buildPoolState({ poolId: null, teamsInPool });
  const supabase = makeSupabase(state);

  const rows = await fillMissingTeamEntries({
    supabase,
    race: { id: "race-nopool" }, // ingen league_division_id
    stages: [],
    existingEntries: [],
    persist: false,
  });

  const teamIds = new Set(rows.map((r) => r.team_id));
  assert.equal(teamIds.size, POOL_TARGET_SIZE, "felt-cap gælder selv uden pulje-akse");
});

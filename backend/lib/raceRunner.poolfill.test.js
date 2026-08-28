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
      is() { return b; },
      order() { return b; },
      gte() { return b; },
      // #2962 · fillMissingTeamEntries' teams-select pagineres nu via fetchAllRows
      // (.order("id").range()) — mocken slicer den cannede tabel som en enkelt side.
      range(from, to) { return Promise.resolve({ data: (canned[table] || []).slice(from, to + 1), error: null }); },
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

test("#2962: fillMissingTeamEntries paginerer teams-selectet forbi 1000-row-loftet", async () => {
  // 1100 hold i puljen med STIGENDE base_value (index = styrke) — de 24 stærkeste
  // (t-1076..t-1099) ligger PÅ SIDE 2 (>1000) af det pagineret teams-select. Uden
  // fetchAllRows ville kun de første 1000 rækker (t-0..t-999, de SVAGESTE) nogensinde
  // være synlige for felt-cap-logikken, og feltet ville fejlagtigt bestå af de 24
  // svageste hold i stedet for de 24 stærkeste.
  const poolId = 100;
  const teamsInPool = Array.from({ length: 1100 }, (_, i) => ({
    id: `t-${i}`,
    base_value: 1000 + i * 100,
  }));
  const state = buildPoolState({ poolId, teamsInPool });
  const supabase = makeSupabase(state);

  const rows = await fillMissingTeamEntries({
    supabase,
    race: { id: "race-paginate", league_division_id: poolId },
    stages: [],
    existingEntries: [],
    persist: false,
  });

  const teamIds = new Set(rows.map((r) => r.team_id));
  assert.equal(teamIds.size, POOL_TARGET_SIZE, `feltet skal cappes til ${POOL_TARGET_SIZE} hold`);
  for (let i = 1100 - POOL_TARGET_SIZE; i < 1100; i += 1) {
    assert.ok(teamIds.has(`t-${i}`), `t-${i} (top-${POOL_TARGET_SIZE} styrke, side 2 af pagineringen) skal være med`);
  }
  assert.ok(!teamIds.has("t-0"), "t-0 (svageste, side 1) skal IKKE være med");
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

// #4295: felt-cap'et skærer i hvem der TILFØJES feltet. Et hold der ligger under gulvet
// er allerede i feltet med sine egne manuelle picks, så det må aldrig kunne cappes væk —
// det ville skære manageren ud af hans eget løb. Det svageste hold i puljen er her netop
// det hold, så testen fejler hvis rednings-hold blandes ind i cap-sorteringen.
test("#4295: et hold under gulvet med egne picks cappes ALDRIG væk af felt-cap'et", async () => {
  const poolId = 100;
  const teamsInPool = Array.from({ length: 26 }, (_, i) => ({ id: `t-${i}`, base_value: 1000 + i * 100 }));
  const state = buildPoolState({ poolId, teamsInPool });
  // t-0 er puljens svageste hold OG har tre manuelt udtagne ryttere (under gulvet på 6).
  const t0Riders = state.riders.filter((r) => r.team_id === "t-0").slice(0, 3);
  const existingEntries = t0Riders.map((r) => ({ race_id: "race-cap-rescue", rider_id: r.id, team_id: "t-0" }));
  const supabase = makeSupabase(state);

  const rows = await fillMissingTeamEntries({
    supabase,
    race: { id: "race-cap-rescue", league_division_id: poolId },
    stages: [],
    existingEntries,
    persist: false,
  });

  const t0Rows = rows.filter((r) => r.team_id === "t-0");
  assert.equal(t0Rows.length, 3, "redningen fylder de 3 manglende op til gulvet, hverken mere eller mindre");
  assert.ok(t0Rows.every((r) => r.race_role === "helper"), "redningen sætter aldrig en ny kaptajn");
  // Cap'et rammer stadig de TOMME hold: 25 tomme hold i puljen cappes til 24.
  const emptyTeamIds = new Set(rows.filter((r) => r.team_id !== "t-0").map((r) => r.team_id));
  assert.equal(emptyTeamIds.size, POOL_TARGET_SIZE, "de tomme hold cappes stadig til target");
  assert.ok(!emptyTeamIds.has("t-1"), "svageste TOMME hold cappes væk, som før");
});

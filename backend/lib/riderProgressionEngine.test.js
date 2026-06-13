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

// ── Anti-double-dip: skipGrowth (#1305) ──────────────────────────────────────

// Helpers til at bygge state med menneskelige og AI-holds
function seedStateWithTeams({ riders, abilities, teams }) {
  return {
    riders: riders.map((r) => ({ ...r })),
    rider_derived_abilities: abilities.map((a) => ({ ...ABILITY_DEFAULTS, ...a })),
    rider_development_log: [],
    teams: teams.map((t) => ({ ...t })),
    app_config: [],
  };
}

test("flag OFF → ingen teams-forespørgsel, alle vokser som normalt", async () => {
  // dailyTrainingEnabled=false injiceres direkte → ren passiv L0-adfærd
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: "team-1", firstname: "A", lastname: "B" }],
    abilities: [{ rider_id: "r1", climbing: 55, ability_caps: null }],
  });
  // Eksisterende seedState-mock har kun { id, user_id } i teams — vi behøver ikke rette den
  // fordi teams ALDRIG bliver spurgt når flaget er OFF.
  const supabase = createMockSupabase(state);
  const summary = await developRidersForSeason({
    supabase, seasonId: "s2", seasonNumber: 2, model: MODEL,
    dailyTrainingEnabled: false,
  });
  assert.equal(summary.growth_skipped, 0, "ingen skippet vækst");
  assert.equal(summary.developed, 1);
  assert.ok(state.rider_derived_abilities[0].climbing > 55, "vokser normalt");
});

test("flag ON + menneskelig-hold rytter i vækstfase → abilities uændret, log skrevet, growth_skipped++", async () => {
  const state = seedStateWithTeams({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: "human-1", firstname: "Ung", lastname: "Talent" }],
    abilities: [{ rider_id: "r1", climbing: 55, endurance: 55, ability_caps: null }],
    teams: [{ id: "human-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });
  const supabase = createMockSupabase(state);
  const climbBefore = state.rider_derived_abilities[0].climbing;

  const summary = await developRidersForSeason({
    supabase, seasonId: "s2", seasonNumber: 2, model: MODEL,
    dailyTrainingEnabled: true,
  });

  assert.equal(summary.growth_skipped, 1, "én rytters vækst springes over");
  assert.equal(summary.developed, 1, "rytteren er stadig 'developed' (log + base_value + is_u25)");
  assert.equal(state.rider_derived_abilities[0].climbing, climbBefore, "climbing uændret");
  assert.equal(state.rider_development_log.length, 1, "log-row skrevet (idempotens bevaret)");
});

test("flag ON + AI-hold rytter → vokser fuldt ud (uberørt af skipGrowth)", async () => {
  const state = seedStateWithTeams({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: "ai-1", firstname: "AI", lastname: "Rider" }],
    abilities: [{ rider_id: "r1", climbing: 55, endurance: 55, ability_caps: null }],
    teams: [{ id: "ai-1", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false }],
  });
  const supabase = createMockSupabase(state);

  const summary = await developRidersForSeason({
    supabase, seasonId: "s2", seasonNumber: 2, model: MODEL,
    dailyTrainingEnabled: true,
  });

  assert.equal(summary.growth_skipped, 0, "AI-rytter springes IKKE over");
  assert.ok(state.rider_derived_abilities[0].climbing > 55, "AI-rytter vokser normalt");
});

test("flag ON + menneskelig-hold fald-fase rytter → falder som normalt (decline bevares)", async () => {
  // 34-årig — over peakAge (28) → decline-fasen kører selv med skipGrowth
  const state = seedStateWithTeams({
    riders: [{ id: "r1", primary_type: "sprinter", potentiale: 5, birthdate: "1993-01-01", base_value: 200000, is_u25: false, is_retired: false, team_id: "human-1", firstname: "Gml", lastname: "Rytter" }],
    abilities: [{ rider_id: "r1", sprint: 80, acceleration: 75, ability_caps: null }],
    teams: [{ id: "human-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });
  const supabase = createMockSupabase(state);
  const sprintBefore = state.rider_derived_abilities[0].sprint;

  const summary = await developRidersForSeason({
    supabase, seasonId: "s2", seasonNumber: 2, model: MODEL,
    dailyTrainingEnabled: true,
  });

  // sæson 2 → alder = 2026 + 1 - 1993 = 34 (over peak)
  // growth_skipped = 1: flagget sættes per hold (menneskelig), ikke per alder.
  // Det er OK — i developRiderSeason kører decline-stien fordi age > peakAge.
  assert.equal(summary.growth_skipped, 1, "flagget sættes for menneskelig-hold rytter uanset alder");
  assert.ok(state.rider_derived_abilities[0].sprint < sprintBefore, "evne falder for fald-fase rytter");
});

test("flag ON + idempotens: anden kørsel med menneskelig hold skipper allerede-udviklede", async () => {
  const state = seedStateWithTeams({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: "human-1", firstname: "A", lastname: "B" }],
    abilities: [{ rider_id: "r1", climbing: 55, ability_caps: null }],
    teams: [{ id: "human-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });
  const supabase = createMockSupabase(state);
  await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2, model: MODEL, dailyTrainingEnabled: true });

  const climbAfterFirst = state.rider_derived_abilities[0].climbing;
  const summary2 = await developRidersForSeason({ supabase, seasonId: "s2", seasonNumber: 2, model: MODEL, dailyTrainingEnabled: true });

  assert.equal(summary2.skipped_already_done, 1, "anden kørsel skipper");
  assert.equal(summary2.developed, 0);
  assert.equal(state.rider_derived_abilities[0].climbing, climbAfterFirst, "ability uændret ved re-run");
  assert.equal(state.rider_development_log.length, 1, "ingen dublet log-row");
});

// ── Akademi: skipGrowth for akademi-ryttere på menneskelige hold (#1308) ────────

test("flag ON + akademi-rytter (is_academy=true) på menneskelig hold → skipGrowth (abilities uændret)", async () => {
  // Akademi-ryttere er på et menneske-hold → humanTeamIds.has(team_id) = true →
  // skipGrowth = true. Ingen kodeændring nødvendig; denne test låser adfærden fast.
  const state = seedStateWithTeams({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2008-01-01", base_value: 50000, is_u25: true, is_retired: false, team_id: "human-1", is_academy: true, firstname: "Ung", lastname: "Akademist" }],
    abilities: [{ rider_id: "r1", climbing: 40, endurance: 40, ability_caps: null }],
    teams: [{ id: "human-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });
  const supabase = createMockSupabase(state);
  const climbBefore = state.rider_derived_abilities[0].climbing;

  const summary = await developRidersForSeason({
    supabase, seasonId: "s2", seasonNumber: 2, model: MODEL,
    dailyTrainingEnabled: true,
  });

  assert.equal(summary.growth_skipped, 1, "akademi-rytter på menneskelig hold får skipGrowth");
  assert.equal(state.rider_derived_abilities[0].climbing, climbBefore, "akademi-rytters abilities uændret (daglig træning håndterer vækst)");
});

test("træningsfokus (#1163) biaser udvikling når trainingSeasonId er sat", async () => {
  const mkState = () => {
    const s = seedState({
      riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: "team-1", firstname: "Ung", lastname: "Talent" }],
      abilities: [{ rider_id: "r1", climbing: 55, tempo: 55, endurance: 55, ability_caps: null }],
    });
    s.training_plans = [{ team_id: "team-1", rider_id: "r1", season_id: "s1", focus: "vo2max", intensity: "hard" }];
    return s;
  };

  // Uden trainingSeasonId → ren passiv (ingen bias indlæses).
  const plain = mkState();
  const sumPlain = await developRidersForSeason({ supabase: createMockSupabase(plain), seasonId: "s2", seasonNumber: 2, model: MODEL });
  assert.equal(sumPlain.trained, 0);

  // Med trainingSeasonId → planen for den afsluttede sæson biaser udviklingen.
  const trained = mkState();
  const sumTrained = await developRidersForSeason({ supabase: createMockSupabase(trained), seasonId: "s2", seasonNumber: 2, trainingSeasonId: "s1", model: MODEL });
  assert.equal(sumTrained.trained, 1);

  const climbPlain = plain.rider_derived_abilities[0].climbing;
  const climbTrained = trained.rider_derived_abilities[0].climbing;
  assert.ok(climbTrained > climbPlain, "vo2max-fokus (climbing) vokser mere end uden træning");
  assert.ok(climbTrained <= trained.rider_derived_abilities[0].ability_caps.climbing, "stadig under loftet");
});

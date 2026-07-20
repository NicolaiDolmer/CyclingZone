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
  // Letvægts-fake af apply_rider_development (#2361): emulerer RPC'ens
  // ON-CONFLICT-DO-NOTHING-adfærd — INSERT i rider_development_log (guard på
  // rider_id+season_id, samme UNIQUE som den ægte migration), og KUN hvis
  // rækken faktisk blev indsat, mutation af rider_derived_abilities + riders.
  // Allerede-logget (samme rider_id+season_id) → { data: false, error: null }
  // UDEN at røre evner/rytter — spejler RPC'ens atomicitets-garanti 1:1.
  function rpc(fnName, args) {
    if (fnName !== "apply_rider_development") {
      return Promise.resolve({ data: null, error: { message: `unmocked rpc: ${fnName}` } });
    }
    const { p_rider_id, p_season_id, p_season_number, p_ability_patch, p_rider_patch, p_log } = args;
    state.rider_development_log ??= [];
    const alreadyLogged = state.rider_development_log.some(
      (l) => l.rider_id === p_rider_id && l.season_id === p_season_id
    );
    if (alreadyLogged) return Promise.resolve({ data: false, error: null });

    state.rider_development_log.push({
      rider_id: p_rider_id, season_id: p_season_id, season_number: p_season_number,
      age: p_log?.age ?? null, abilities: p_log?.abilities ?? {}, base_value: p_log?.base_value ?? null,
      retired_this_season: !!p_log?.retired_this_season,
    });

    const abRow = (state.rider_derived_abilities ?? []).find((a) => a.rider_id === p_rider_id);
    if (abRow) for (const [k, v] of Object.entries(p_ability_patch ?? {})) if (v != null) abRow[k] = v;

    const riderRow = (state.riders ?? []).find((r) => r.id === p_rider_id);
    if (riderRow) for (const [k, v] of Object.entries(p_rider_patch ?? {})) if (v != null) riderRow[k] = v;

    return Promise.resolve({ data: true, error: null });
  }
  return { from: (table) => { state[table] ??= []; return builder(table); }, rpc };
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

test("ability-history: season-transition skriver én season-snapshot pr. udviklet rytter (#2000)", async () => {
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: null, firstname: "Ung", lastname: "Talent" }],
    abilities: [{ rider_id: "r1", climbing: 55, tempo: 55, endurance: 55, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  await developRidersForSeason({
    supabase, seasonId: "s2", seasonNumber: 2, model: MODEL,
    now: new Date("2026-06-12T10:00:00+02:00"),
  });

  const hist = state.rider_derived_ability_history ?? [];
  assert.equal(hist.length, 1, "én season-snapshot for den udviklede rytter");
  const row = hist[0];
  assert.equal(row.rider_id, "r1");
  assert.equal(row.source, "season_transition");
  assert.equal(row.snapshot_date, "2026-06-12");
  assert.equal(row.season_number, 2);
  assert.ok(row.abilities && row.abilities.climbing > 55, "snapshot = post-udviklings-vektor");
});

test("ability-history: idempotent — anden season-kørsel skriver ingen ny snapshot", async () => {
  const state = seedState({
    riders: [{ id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2005-01-01", base_value: 100000, is_u25: true, is_retired: false, team_id: null, firstname: "A", lastname: "B" }],
    abilities: [{ rider_id: "r1", climbing: 55, ability_caps: null }],
  });
  const supabase = createMockSupabase(state);
  const args = { supabase, seasonId: "s2", seasonNumber: 2, model: MODEL, now: new Date("2026-06-12T10:00:00+02:00") };
  await developRidersForSeason(args);
  await developRidersForSeason(args); // 2. kørsel: alle allerede udviklet → ingen nye logRows
  assert.equal((state.rider_derived_ability_history ?? []).length, 1, "kun én snapshot trods to kørsler");
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

// ── Re-run-sikkerhed efter delvis fejl (#2361) ──────────────────────────────────
// Beviser den atomiske pr.-rytter-RPC løser den præcise bug: dev-log-skrivning og
// evne/rytter-mutation kan IKKE længere komme ud af trit med hinanden. Simulerer
// et RPC-kald der fejler for én rytter (r2) midt i en batch af tre; assertér at
// r1+r3 er committet atomisk (log OG evner), r2 er urørt, og at en re-run udvikler
// r2 PRÆCIS én gang uden at r1/r3 genudvikles.
test("re-run-sikkerhed: RPC-fejl for én rytter → rytteren udvikles præcis 1× ved re-run, forudgående ryttere forbliver committet (#2361)", async () => {
  const state = seedState({
    riders: [
      { id: "r1", primary_type: "climber", potentiale: 5, birthdate: "2000-01-01", base_value: 100000, is_u25: false, is_retired: false, team_id: null, firstname: "A", lastname: "One" },
      { id: "r2", primary_type: "climber", potentiale: 5, birthdate: "2000-01-01", base_value: 100000, is_u25: false, is_retired: false, team_id: null, firstname: "B", lastname: "Two" },
      { id: "r3", primary_type: "climber", potentiale: 5, birthdate: "2000-01-01", base_value: 100000, is_u25: false, is_retired: false, team_id: null, firstname: "C", lastname: "Three" },
    ],
    abilities: [
      { rider_id: "r1", climbing: 55, tempo: 55, endurance: 55, ability_caps: null },
      { rider_id: "r2", climbing: 55, tempo: 55, endurance: 55, ability_caps: null },
      { rider_id: "r3", climbing: 55, tempo: 55, endurance: 55, ability_caps: null },
    ],
  });
  const supabase = createMockSupabase(state);

  // Wrapper: r2's FØRSTE RPC-kald fejler (simulerer fx en netværks-timeout midt i
  // batchen); alle andre kald (r1, r3, og r2 ved re-run) går til den ægte mock-rpc.
  let r2Failed = false;
  const flakySupabase = {
    from: supabase.from,
    rpc: (fn, args) => {
      if (args.p_rider_id === "r2" && !r2Failed) {
        r2Failed = true;
        return Promise.resolve({ data: null, error: { message: "simulated rpc failure for r2" } });
      }
      return supabase.rpc(fn, args);
    },
  };

  await assert.rejects(
    () => developRidersForSeason({ supabase: flakySupabase, seasonId: "s2", seasonNumber: 2, model: MODEL }),
    /simulated rpc failure/,
    "fejlende RPC-kald propagerer (season-transition må ikke sluge det)"
  );

  // r1 + r3 committet ATOMISK (log OG abilities OG riders sammen); r2 slet ikke rørt.
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r1").length, 1, "r1 logget");
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r3").length, 1, "r3 logget");
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r2").length, 0, "r2 IKKE logget ved fejl (atomicitet — ikke 'logget men ikke anvendt')");
  assert.equal(state.rider_derived_abilities.find((a) => a.rider_id === "r2").climbing, 55, "r2 abilities urørt efter fejl");
  assert.equal(state.riders.find((r) => r.id === "r2").base_value, 100000, "r2 base_value urørt efter fejl");

  const r1ClimbAfterRun1 = state.rider_derived_abilities.find((a) => a.rider_id === "r1").climbing;
  const r3ClimbAfterRun1 = state.rider_derived_abilities.find((a) => a.rider_id === "r3").climbing;
  assert.ok(r1ClimbAfterRun1 > 55, "r1 udviklet i første kørsel");
  assert.ok(r3ClimbAfterRun1 > 55, "r3 udviklet i første kørsel");

  // Re-run (nu uden injiceret fejl): r1+r3 skippes (alreadyDeveloped-filter), kun r2 udvikles.
  const summary2 = await developRidersForSeason({ supabase: flakySupabase, seasonId: "s2", seasonNumber: 2, model: MODEL });

  assert.equal(summary2.developed, 1, "kun r2 udvikles ved re-run");
  assert.equal(summary2.skipped_already_done, 2, "r1+r3 skippes ved re-run (allerede committet)");
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r2").length, 1, "r2 udviklet præcis 1× — ikke nul, ikke to gange");
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r1").length, 1, "r1 IKKE genudviklet ved re-run");
  assert.equal(state.rider_development_log.filter((l) => l.rider_id === "r3").length, 1, "r3 IKKE genudviklet ved re-run");
  assert.equal(state.rider_derived_abilities.find((a) => a.rider_id === "r1").climbing, r1ClimbAfterRun1, "r1 abilities uændret ved re-run (allerede committede ryttere rører intet)");
  assert.equal(state.rider_derived_abilities.find((a) => a.rider_id === "r3").climbing, r3ClimbAfterRun1, "r3 abilities uændret ved re-run");
  assert.ok(state.rider_derived_abilities.find((a) => a.rider_id === "r2").climbing > 55, "r2 endelig korrekt udviklet efter re-run");
  assert.ok(state.riders.find((r) => r.id === "r2").base_value > 100000, "r2 base_value endelig anvendt efter re-run");
});

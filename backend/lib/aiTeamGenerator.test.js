import test from "node:test";
import assert from "node:assert/strict";

import { generateAndAllocateAiTeams, clearAllAiTeams, reconcileAiTeamsForPool, AI_TEAM_NAME_PREFIX, __testables } from "./aiTeamGenerator.js";
import { POOL_TARGET_SIZE, MAX_DIVISION, MANAGER_ENTRY_DIVISION } from "./economyConstants.js";
import { STARTER_SQUAD, STARTER_POOL_STAT_WINDOW } from "./starterSquadAllocator.js";
import { STAT_KEYS } from "./fictionalRiderGenerator.js";

// #1688 — AI-fill-generator. Politik (frosset):
//   tier 1 OG tier 2-puljer  → fyld ALTID med AI op til POOL_TARGET_SIZE (24).
//   tier 3 OG tier 4-puljer  → fyld med AI KUN i puljer med >=1 ægte manager.
// Idempotent (re-run top-up'er kun). Reconcile fjerner overskuds-AI så
// pulje-størrelse <= target og ægte managere aldrig fortrænges; en tier-3/4-pulje
// der mister sin sidste manager tømmes for AI.

// ── Rich mock-supabase: in-memory state, eq/in/neq-filtre, insert().select(),
//    update, delete. Modellerer kun det aiTeamGenerator rører. ──────────────────
function makeSupabase(initial = {}) {
  let idSeq = 1;
  const state = {
    teams: [],
    riders: [],
    league_divisions: [],
    ...JSON.parse(JSON.stringify(initial)),
  };

  function from(table) {
    if (!state[table]) state[table] = [];
    const rows = () => state[table];
    const filters = [];
    function matches(row) {
      return filters.every((f) => {
        if (f.t === "eq") return row[f.c] === f.v;
        if (f.t === "neq") return row[f.c] !== f.v;
        if (f.t === "in") return f.v.includes(row[f.c]);
        return true;
      });
    }
    const builder = {
      select() { return builder; },
      eq(c, v) { filters.push({ t: "eq", c, v }); return builder; },
      neq(c, v) { filters.push({ t: "neq", c, v }); return builder; },
      in(c, v) { filters.push({ t: "in", c, v }); return builder; },
      order() { return builder; },
      // fetchAllRows-paginering (supabasePagination.js): én side rummer alt i denne
      // in-memory mock; from=0 → alle matchende rækker, ellers tom (loopet stopper).
      range(from) {
        const data = from === 0 ? rows().filter(matches) : [];
        return Promise.resolve({ data, error: null });
      },
      insert(payload) {
        const arr = Array.isArray(payload) ? payload : [payload];
        const inserted = arr.map((r) => ({ id: `${table}-${idSeq++}`, ...r }));
        rows().push(...inserted.map((r) => JSON.parse(JSON.stringify(r))));
        const ins = {
          select() {
            return Promise.resolve({ data: inserted.map((r) => ({ id: r.id })), error: null });
          },
          then(res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); },
        };
        return ins;
      },
      // deriveForRiderIds (backfillCores) upsert'er physiology/abilities på rider_id.
      // Minimal upsert: erstat på onConflict-nøgle, ellers append. Returnerer {error:null}.
      upsert(payload, opts = {}) {
        const arr = Array.isArray(payload) ? payload : [payload];
        const key = opts.onConflict;
        for (const r of arr) {
          const clone = JSON.parse(JSON.stringify(r));
          const existing = key ? rows().find((row) => row[key] === clone[key]) : null;
          if (existing) Object.assign(existing, clone);
          else rows().push(clone);
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(payload) {
        const upd = {
          eq(c, v) { filters.push({ t: "eq", c, v }); return upd; },
          in(c, v) { filters.push({ t: "in", c, v }); return upd; },
          then(res, rej) {
            for (const row of rows()) if (matches(row)) Object.assign(row, JSON.parse(JSON.stringify(payload)));
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return upd;
      },
      delete() {
        const del = {
          eq(c, v) { filters.push({ t: "eq", c, v }); return del; },
          in(c, v) { filters.push({ t: "in", c, v }); return del; },
          then(res, rej) {
            state[table] = rows().filter((row) => !matches(row));
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return del;
      },
      then(res, rej) {
        return Promise.resolve({ data: rows().filter(matches), error: null }).then(res, rej);
      },
    };
    return builder;
  }

  return { from, state };
}

// 15-pulje-pyramide (tier1×1, tier2×2, tier3×4, tier4×8).
function seedPools() {
  const pools = [];
  let id = 1;
  const layout = [[1, 1], [2, 2], [3, 4], [4, 8]];
  for (const [tier, n] of layout) {
    for (let i = 0; i < n; i++) {
      pools.push({ id: id++, tier, pool_index: i, label: `Division ${tier} — ${String.fromCharCode(65 + i)}` });
    }
  }
  return pools;
}

function poolByTierIndex(pools, tier, index) {
  return pools.find((p) => p.tier === tier && p.pool_index === index);
}

// Injicérbar squad-allokering: skriv 8 dummy-ryttere pr. AI-hold (ingen derive-kæde).
// Holder testen DB-fri og deterministisk; den ægte generator bruges i prod-stien.
function fakeAllocateSquad(supabase, teamId) {
  const riders = Array.from({ length: 8 }, () => ({ team_id: teamId, base_value: 7000, pcm_id: null }));
  return supabase.from("riders").insert(riders).select();
}

const DEPS = { allocateSquadForTeam: fakeAllocateSquad };

function countTeamsInPool(state, poolId, { ai } = {}) {
  return state.teams.filter((t) =>
    t.league_division_id === poolId && (ai === undefined || Boolean(t.is_ai) === ai),
  ).length;
}

test("tier 1 + tier 2-puljer fyldes ALTID til target, selv uden ægte managere", async () => {
  const pools = seedPools();
  const supabase = makeSupabase({ league_divisions: pools, teams: [], riders: [] });

  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });

  const t1 = poolByTierIndex(pools, 1, 0);
  const t2a = poolByTierIndex(pools, 2, 0);
  const t2b = poolByTierIndex(pools, 2, 1);
  assert.equal(countTeamsInPool(supabase.state, t1.id), POOL_TARGET_SIZE, "tier 1 fyldt til target");
  assert.equal(countTeamsInPool(supabase.state, t2a.id), POOL_TARGET_SIZE, "tier 2-A fyldt til target");
  assert.equal(countTeamsInPool(supabase.state, t2b.id), POOL_TARGET_SIZE, "tier 2-B fyldt til target");
  // Alle indsatte hold er AI.
  assert.equal(countTeamsInPool(supabase.state, t1.id, { ai: false }), 0, "ingen ægte hold opfundet");
});

test("tier 3 + tier 4-puljer UDEN ægte manager fyldes IKKE", async () => {
  const pools = seedPools();
  const supabase = makeSupabase({ league_divisions: pools, teams: [], riders: [] });

  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });

  const t3a = poolByTierIndex(pools, 3, 0);
  const t4a = poolByTierIndex(pools, 4, 0);
  assert.equal(countTeamsInPool(supabase.state, t3a.id), 0, "tom tier-3-pulje må ikke fyldes");
  assert.equal(countTeamsInPool(supabase.state, t4a.id), 0, "tom tier-4-pulje må ikke fyldes");
});

test("tier 3 + tier 4-pulje MED ægte manager fyldes til target (managere medregnes)", async () => {
  const pools = seedPools();
  const t3a = poolByTierIndex(pools, 3, 0);
  const t4a = poolByTierIndex(pools, 4, 0);
  const supabase = makeSupabase({
    league_divisions: pools,
    teams: [
      { id: "mgr-3", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 3, league_division_id: t3a.id },
      { id: "mgr-4a", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 4, league_division_id: t4a.id },
      { id: "mgr-4b", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 4, league_division_id: t4a.id },
    ],
    riders: [],
  });

  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });

  assert.equal(countTeamsInPool(supabase.state, t3a.id), POOL_TARGET_SIZE, "tier-3-pulje med manager fyldt til target");
  assert.equal(countTeamsInPool(supabase.state, t4a.id), POOL_TARGET_SIZE, "tier-4-pulje med 2 managere fyldt til target");
  // 1 manager + 23 AI i t3a; 2 managere + 22 AI i t4a.
  assert.equal(countTeamsInPool(supabase.state, t3a.id, { ai: true }), POOL_TARGET_SIZE - 1);
  assert.equal(countTeamsInPool(supabase.state, t4a.id, { ai: true }), POOL_TARGET_SIZE - 2);
  // Ægte managere røres aldrig.
  assert.equal(countTeamsInPool(supabase.state, t3a.id, { ai: false }), 1);
  assert.equal(countTeamsInPool(supabase.state, t4a.id, { ai: false }), 2);
});

test("idempotent: re-run top-up'er ikke forbi target (ingen duplikering)", async () => {
  const pools = seedPools();
  const supabase = makeSupabase({ league_divisions: pools, teams: [], riders: [] });

  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });
  const afterFirst = supabase.state.teams.length;
  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });
  const afterSecond = supabase.state.teams.length;

  assert.equal(afterSecond, afterFirst, "re-run må ikke skabe nye hold når puljerne er fulde");
  const t1 = poolByTierIndex(pools, 1, 0);
  assert.equal(countTeamsInPool(supabase.state, t1.id), POOL_TARGET_SIZE, "stadig præcis target efter re-run");
});

test("reconcile: ny ægte manager i en fuld tier-1-pulje fortrænger overskuds-AI (ingen displacement)", async () => {
  const pools = seedPools();
  const t1 = poolByTierIndex(pools, 1, 0);
  const supabase = makeSupabase({ league_divisions: pools, teams: [], riders: [] });

  // Fyld tier 1 fuldt med AI.
  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });
  assert.equal(countTeamsInPool(supabase.state, t1.id), POOL_TARGET_SIZE);

  // En ægte manager dukker op i den (allerede fulde) tier-1-pulje.
  supabase.state.teams.push({
    id: "late-mgr", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
    division: 1, league_division_id: t1.id,
  });

  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });

  assert.equal(countTeamsInPool(supabase.state, t1.id), POOL_TARGET_SIZE, "pulje stadig præcis target (AI trimmet)");
  assert.equal(countTeamsInPool(supabase.state, t1.id, { ai: false }), 1, "ægte manager bevaret");
  assert.equal(countTeamsInPool(supabase.state, t1.id, { ai: true }), POOL_TARGET_SIZE - 1, "én AI fjernet for at give plads");
  assert.ok(supabase.state.teams.some((t) => t.id === "late-mgr"), "ægte manager aldrig fjernet");
});

test("reconcile: tier-3-pulje der mister sin sidste manager tømmes for AI", async () => {
  const pools = seedPools();
  const t3a = poolByTierIndex(pools, 3, 0);
  const supabase = makeSupabase({
    league_divisions: pools,
    teams: [
      { id: "mgr-3", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 3, league_division_id: t3a.id },
    ],
    riders: [],
  });

  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });
  assert.equal(countTeamsInPool(supabase.state, t3a.id), POOL_TARGET_SIZE, "pulje fyldt mens manager var der");

  // Manageren forlader puljen (fx oprykning/sletning).
  supabase.state.teams = supabase.state.teams.filter((t) => t.id !== "mgr-3");

  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });

  assert.equal(countTeamsInPool(supabase.state, t3a.id, { ai: true }), 0, "AI ryddet fra forladt tier-3-pulje");
  assert.equal(countTeamsInPool(supabase.state, t3a.id), 0, "puljen tom (politik: tier 3/4 uden manager = ingen AI)");
});

test("AI-hold får is_ai=true, division=pool.tier og pulje-id; navn har AI-præfiks", async () => {
  const pools = seedPools();
  const t1 = poolByTierIndex(pools, 1, 0);
  const supabase = makeSupabase({ league_divisions: pools, teams: [], riders: [] });

  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });

  const aiTeams = supabase.state.teams.filter((t) => t.league_division_id === t1.id);
  assert.ok(aiTeams.length > 0);
  for (const t of aiTeams) {
    assert.equal(t.is_ai, true, "is_ai=true");
    assert.equal(t.division, 1, "division = pool.tier");
    assert.equal(t.league_division_id, t1.id, "league_division_id = pool.id");
    assert.ok(typeof t.name === "string" && t.name.length > 0, "navn sat");
  }
  assert.ok(aiTeams.some((t) => t.name.startsWith(AI_TEAM_NAME_PREFIX)), "AI-navn har præfiks");
});

test("determinisme: samme seed → samme AI-holdnavne", async () => {
  const pools = seedPools();
  const a = makeSupabase({ league_divisions: seedPools(), teams: [], riders: [] });
  const b = makeSupabase({ league_divisions: seedPools(), teams: [], riders: [] });
  void pools;

  await generateAndAllocateAiTeams({ supabase: a, seed: 4242, deps: DEPS });
  await generateAndAllocateAiTeams({ supabase: b, seed: 4242, deps: DEPS });

  const namesA = a.state.teams.map((t) => t.name).sort();
  const namesB = b.state.teams.map((t) => t.name).sort();
  assert.deepEqual(namesA, namesB, "samme seed → samme navne");
});

test("returnerer et opsummerings-objekt med created/removed pr. kørsel", async () => {
  const pools = seedPools();
  const supabase = makeSupabase({ league_divisions: pools, teams: [], riders: [] });

  const summary = await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });

  assert.ok(summary && typeof summary === "object");
  assert.ok(Number.isInteger(summary.created), "summary.created er et heltal");
  assert.ok(Number.isInteger(summary.removed), "summary.removed er et heltal");
  // tier1 (1×24) + tier2 (2×24) = 72 AI-hold ved tom start; tier 3/4 tomme.
  assert.equal(summary.created, POOL_TARGET_SIZE * 3, "1 tier-1-pulje + 2 tier-2-puljer fyldt");
  assert.equal(summary.removed, 0);
  void MAX_DIVISION;
});

// clearAllAiTeams (#1688): bevidst engangs-wipe FØR AI-fyld i relaunchen, så et phantom
// AI-hold (fx prod's "AI" i div 1 med 0 ryttere) ikke overlever. Sletter is_ai-hold +
// deres ryttere; rører aldrig ægte hold.
test("clearAllAiTeams sletter alle AI-hold + deres ryttere; rører ikke ægte hold", async () => {
  const supabase = makeSupabase({
    teams: [
      { id: "ai-1", is_ai: true, league_division_id: 1 },
      { id: "ai-2", is_ai: true, league_division_id: 2 },
      { id: "mgr-1", is_ai: false, league_division_id: 1 },
    ],
    riders: [
      { id: "r-ai1", team_id: "ai-1" },
      { id: "r-ai2", team_id: "ai-2" },
      { id: "r-mgr", team_id: "mgr-1" },
    ],
  });

  const res = await clearAllAiTeams(supabase);

  assert.equal(res.teams, 2, "2 AI-hold slettet");
  assert.deepEqual(supabase.state.teams.map((t) => t.id), ["mgr-1"], "kun ægte hold tilbage");
  assert.deepEqual(supabase.state.riders.map((r) => r.id), ["r-mgr"], "AI-ryttere slettet, ægte rytter bevaret");
});

test("clearAllAiTeams er no-op uden AI-hold", async () => {
  const supabase = makeSupabase({ teams: [{ id: "mgr-1", is_ai: false }], riders: [] });

  const res = await clearAllAiTeams(supabase);

  assert.equal(res.teams, 0);
  assert.deepEqual(supabase.state.teams.map((t) => t.id), ["mgr-1"]);
});

// ── #1739 · reconcileAiTeamsForPool: trim AI når et nyt ægte hold rykker ind ────
// Bug'en: trim-logikken (generateAndAllocateAiTeams) kørte KUN ved relaunch, så et
// nyt hold midt i sæsonen efterlod AI-feltet urørt og puljen voksede forbi target.
// reconcileAiTeamsForPool afgrænser delta-logikken til én pulje, så holdoprettelses-
// stien kan trimme uden at scanne hele pyramiden.

test("#1739 reconcileAiTeamsForPool: ny manager i fuld entry-pulje trimmer ét AI-hold (størrelse holder)", async () => {
  const pools = seedPools();
  // Entry-puljen er tier 3 (MANAGER_ENTRY_DIVISION) i den frosne pyramide.
  const t3a = poolByTierIndex(pools, MANAGER_ENTRY_DIVISION, 0);
  const supabase = makeSupabase({
    league_divisions: pools,
    teams: [
      { id: "first-mgr", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 3, league_division_id: t3a.id },
    ],
    riders: [],
  });

  // Puljen fyldes til target (1 manager + 23 AI = 24).
  await generateAndAllocateAiTeams({ supabase, seed: 2026, deps: DEPS });
  assert.equal(countTeamsInPool(supabase.state, t3a.id), POOL_TARGET_SIZE, "puljen er fuld før nyt hold");

  // Et NYT ægte hold rykker ind (simulerer pickDivisionForNewTeam-insertet).
  supabase.state.teams.push({
    id: "new-mgr", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
    division: 3, league_division_id: t3a.id,
  });
  assert.equal(countTeamsInPool(supabase.state, t3a.id), POOL_TARGET_SIZE + 1, "puljen er over target lige efter join");

  const summary = await reconcileAiTeamsForPool({ supabase, poolId: t3a.id, seed: 2026, deps: DEPS });

  assert.equal(summary.removed, 1, "præcis ét AI-hold trimmet");
  assert.equal(summary.created, 0);
  assert.equal(countTeamsInPool(supabase.state, t3a.id), POOL_TARGET_SIZE, "pulje-størrelse tilbage på target");
  assert.equal(countTeamsInPool(supabase.state, t3a.id, { ai: false }), 2, "begge ægte managere bevaret");
  assert.equal(countTeamsInPool(supabase.state, t3a.id, { ai: true }), POOL_TARGET_SIZE - 2, "ét AI-hold fjernet");
  assert.ok(supabase.state.teams.some((t) => t.id === "new-mgr"), "nyt hold aldrig fjernet");
  assert.ok(supabase.state.teams.some((t) => t.id === "first-mgr"), "eksisterende manager aldrig fjernet");
});

test("#1739 reconcileAiTeamsForPool: første manager i tom entry-pulje top-up'er feltet", async () => {
  // En tom tier-3-pulje fyldes IKKE af generatoren (politik), men når den FØRSTE
  // manager rykker ind skal feltet fyldes op til target (managere medregnes).
  const pools = seedPools();
  const t3b = poolByTierIndex(pools, MANAGER_ENTRY_DIVISION, 1);
  const supabase = makeSupabase({
    league_divisions: pools,
    teams: [
      { id: "lone-mgr", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 3, league_division_id: t3b.id },
    ],
    riders: [],
  });

  const summary = await reconcileAiTeamsForPool({ supabase, poolId: t3b.id, seed: 2026, deps: DEPS });

  assert.equal(summary.created, POOL_TARGET_SIZE - 1, "feltet fyldt op til target (1 manager + 23 AI)");
  assert.equal(summary.removed, 0);
  assert.equal(countTeamsInPool(supabase.state, t3b.id), POOL_TARGET_SIZE, "pulje på target");
  assert.equal(countTeamsInPool(supabase.state, t3b.id, { ai: false }), 1, "manageren bevaret");
});

test("#1739 reconcileAiTeamsForPool: idempotent — no-op når puljen allerede er på target", async () => {
  const pools = seedPools();
  const t3a = poolByTierIndex(pools, MANAGER_ENTRY_DIVISION, 0);
  const supabase = makeSupabase({
    league_divisions: pools,
    teams: [
      { id: "mgr", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, division: 3, league_division_id: t3a.id },
    ],
    riders: [],
  });

  await reconcileAiTeamsForPool({ supabase, poolId: t3a.id, seed: 2026, deps: DEPS });
  const afterFirst = countTeamsInPool(supabase.state, t3a.id);
  const summary = await reconcileAiTeamsForPool({ supabase, poolId: t3a.id, seed: 2026, deps: DEPS });

  assert.equal(summary.created, 0, "re-run skaber intet");
  assert.equal(summary.removed, 0, "re-run fjerner intet");
  assert.equal(countTeamsInPool(supabase.state, t3a.id), afterFirst, "pulje uændret");
  assert.equal(afterFirst, POOL_TARGET_SIZE);
});

test("#1739 reconcileAiTeamsForPool: ukendt/null pulje er no-op (ingen kast)", async () => {
  const pools = seedPools();
  const supabase = makeSupabase({ league_divisions: pools, teams: [], riders: [] });

  const missing = await reconcileAiTeamsForPool({ supabase, poolId: 9999, seed: 2026, deps: DEPS });
  assert.equal(missing.created, 0);
  assert.equal(missing.removed, 0);
  assert.equal(missing.tier, null, "ukendt pulje → tier null, ingen handling");
});

// ── race-hub 0c · defaultAllocateSquadForTeam: lagdelt 12-trup (8 kerne + 4 hale) ─
// Den ægte PROD-allokering (ikke fakeAllocateSquad) skal give nye AI-hold en lagdelt
// 12-rytter-trup — kerne [50,57] + ekstra-svag hale [50,52] — spejlende manager-
// truppen (insertWeakSquadForTeam). Tidligere gav den kun CORE_SIZE (8); 0c hæver
// den til TOTAL_SIZE (12) for konsistens med managerhold + dybde-top-up.
test("0c defaultAllocateSquadForTeam giver nye AI-hold en lagdelt TOTAL_SIZE-trup (12) med svage stats", async () => {
  const pools = seedPools();
  const t1 = poolByTierIndex(pools, 1, 0);
  const supabase = makeSupabase({ league_divisions: pools, teams: [], riders: [] });

  const teamId = "ai-prod-1";
  const insertedIds = await __testables.defaultAllocateSquadForTeam(
    supabase, teamId, { pool: t1, baseSeed: 2026, ordinal: 0 },
  );

  // Præcis 12 ryttere (8 kerne + 4 hale), alle bundet til holdet.
  assert.equal(insertedIds.length, STARTER_SQUAD.TOTAL_SIZE, "TOTAL_SIZE (12) ryttere indsat");
  const teamRiders = supabase.state.riders.filter((r) => r.team_id === teamId);
  assert.equal(teamRiders.length, STARTER_SQUAD.TOTAL_SIZE, "12 ryttere har team_id sat");

  // Alle stats ligger i [50,57]: kerne-vinduet rummer både kerne [50,57] og hale
  // [50,52] (halen er en delmængde af kernens vindue på underkant; hi ≤ 57 for begge).
  const { lo, hi } = STARTER_POOL_STAT_WINDOW;
  for (const r of teamRiders) {
    for (const k of STAT_KEYS) {
      assert.ok(r[k] >= lo && r[k] <= hi, `${k}=${r[k]} skal være i [${lo},${hi}]`);
    }
  }
});

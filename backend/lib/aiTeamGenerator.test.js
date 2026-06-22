import test from "node:test";
import assert from "node:assert/strict";

import { generateAndAllocateAiTeams, AI_TEAM_NAME_PREFIX } from "./aiTeamGenerator.js";
import { POOL_TARGET_SIZE, MAX_DIVISION } from "./economyConstants.js";

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

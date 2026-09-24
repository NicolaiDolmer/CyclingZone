// #2557 spor B · reseedTierPools — motor-wiringen af den styrke-balancerede
// pulje-reseed. Politikken (hvem flytter hvorhen) er dækket af
// poolBalance.test.js; her testes kun MOTOR-kontrakten:
//   1. flag af / manglende flag ⇒ NUL queries og NUL skrivninger
//   2. flag på ⇒ kun league_division_id skrives, aldrig division
//   3. AI-hold flyttes aldrig
//   4. en plan der ikke forbedrer skævheden udføres ikke
//   5. processSeasonEnd kalder den EFTER op/nedrykningen og FØR AI-reconcile

import test from "node:test";
import assert from "node:assert/strict";

import { reseedTierPools } from "./economyEngine.js";

// Pyramide-fixture: tier 3 med to puljer (id 4 og 5). Nok til at teste
// motor-kontrakten uden at slæbe hele 15-pulje-træet med.
const POOLS = [
  { id: 4, tier: 3, pool_index: 0, label: "Division 3 - A" },
  { id: 5, tier: 3, pool_index: 1, label: "Division 3 - B" },
];

const ABILITY_COLS = ["flat", "climbing", "sprint", "time_trial", "punch", "cobblestone"];

/** Byg hold + ryttere + afledte evner ud fra en kompakt beskrivelse. */
function buildFixture(specs) {
  const teams = [];
  const riders = [];
  const abilities = [];
  for (const spec of specs) {
    teams.push({
      id: spec.id,
      name: spec.id,
      is_ai: !!spec.isAi,
      is_bank: false,
      league_division_id: spec.poolId,
    });
    spec.peaks.forEach((peak, i) => {
      const riderId = `${spec.id}-r${i}`;
      riders.push({ id: riderId, team_id: spec.id, is_retired: false });
      const row = { rider_id: riderId };
      for (const col of ABILITY_COLS) row[col] = 0;
      row.flat = peak;
      abilities.push(row);
    });
  }
  return { teams, riders, abilities };
}

function flat(id, poolId, peak, opts = {}) {
  return { id, poolId, peaks: Array(6).fill(peak), ...opts };
}

// Samme form som den udlignelige tier i poolBalance.test.js: én runaway-stakker
// i pulje 4 blandt svage hold, seks middel-hold i pulje 5.
function improvableSpecs() {
  return [
    { id: "stacker", poolId: 4, peaks: [60, 58, 56, 54, 50, 50] },
    ...Array.from({ length: 5 }, (_, i) => flat(`weak${i}`, 4, 20)),
    ...Array.from({ length: 6 }, (_, i) => flat(`mid${i}`, 5, 45)),
  ];
}

// To stakkere i samme pulje: en snake spreder dem ud i hver sin pulje, og
// dominans-marginen står uændret. Planen skal droppes.
function unimprovableSpecs() {
  return [
    { id: "stackA", poolId: 4, peaks: [60, 58, 56, 54, 50, 50] },
    { id: "stackB", poolId: 4, peaks: [60, 58, 56, 54, 50, 50] },
    ...Array.from({ length: 4 }, (_, i) => flat(`weakA${i}`, 4, 20)),
    ...Array.from({ length: 6 }, (_, i) => flat(`weakB${i}`, 5, 20)),
  ];
}

// #5536: league_divisions-builder der fortolker motorens senior-scope (.or) og
// aktiv-filter (.is("retired_at", null)). Senior-fixturen uden squad/retired_at passerer
// uændret.
function poolRowsQuery(rows) {
  const filters = [];
  const builder = {
    or(expr) {
      assert.equal(expr, "squad.is.null,squad.eq.senior");
      filters.push((p) => p.squad == null || p.squad === "senior");
      return builder;
    },
    is(column, value) {
      filters.push((p) => (p[column] ?? null) === value);
      return builder;
    },
    then(resolve, reject) {
      const data = rows.map((p) => ({ ...p })).filter((p) => filters.every((f) => f(p)));
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

function createReseedSupabase({
  specs = improvableSpecs(),
  pools = POOLS,
  flagValue = "on",
  flagMissing = false,
  thresholdValue,
  userIdByTeam = {},
} = {}) {
  const { teams, riders, abilities } = buildFixture(specs);
  const updates = [];
  const notifications = [];
  const tablesTouched = [];

  const pageChain = (rows) => ({
    order: () => ({
      range: async (from, to) => ({ data: rows.slice(from, to + 1), error: null }),
    }),
  });

  const dedupeChain = () => {
    const c = {};
    for (const m of ["select", "eq", "neq", "gte", "lte", "is", "order"]) c[m] = () => c;
    c.limit = async () => ({ data: [], error: null });
    return c;
  };

  return {
    updates,
    notifications,
    tablesTouched,
    from(table) {
      tablesTouched.push(table);
      if (table === "app_config") {
        return {
          select: () => ({
            eq: (_col, key) => ({
              maybeSingle: async () => {
                if (key === "season_end_pool_reseed") {
                  return { data: flagMissing ? null : { value: flagValue }, error: null };
                }
                if (key === "season_end_pool_reseed_threshold") {
                  return { data: thresholdValue === undefined ? null : { value: thresholdValue }, error: null };
                }
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "league_divisions") {
        return { select: () => poolRowsQuery(pools) };
      }
      if (table === "teams") {
        return {
          select: (cols) => {
            if (String(cols).includes("user_id")) {
              return {
                eq: (_col, id) => ({
                  single: async () => ({ data: { user_id: userIdByTeam[id] ?? null }, error: null }),
                }),
              };
            }
            return pageChain(teams);
          },
          update: (payload) => ({
            eq: async (col, value) => {
              assert.equal(col, "id");
              updates.push({ id: value, payload });
              return { error: null };
            },
          }),
        };
      }
      if (table === "riders") return { select: () => pageChain(riders) };
      if (table === "rider_derived_abilities") return { select: () => pageChain(abilities) };
      if (table === "notifications") {
        return {
          select: () => dedupeChain(),
          insert: (row) => {
            notifications.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unexpected table in reseed mock: ${table}`);
    },
  };
}

// ── 1. Fail-safe: slukket = usynlig ──────────────────────────────────────────

test("reseedTierPools: flag slukket ⇒ ingen queries, ingen skrivninger", async () => {
  const supabase = createReseedSupabase({ flagValue: "off" });
  const result = await reseedTierPools("season-2", { supabase });

  assert.equal(result.enabled, false);
  assert.equal(result.moved, 0);
  assert.deepEqual(result.tiers, []);
  assert.deepEqual(supabase.updates, []);
  assert.deepEqual(
    [...new Set(supabase.tablesTouched)],
    ["app_config"],
    "kun flag-opslaget må ske når reseed er slukket",
  );
});

test("reseedTierPools: manglende nøgle ⇒ samme fail-safe som slukket", async () => {
  const supabase = createReseedSupabase({ flagMissing: true });
  const result = await reseedTierPools("season-2", { supabase });
  assert.equal(result.enabled, false);
  assert.deepEqual(supabase.updates, []);
});

test("reseedTierPools: fejlende flag-opslag ⇒ fail-safe slukket (ingen mutation)", async () => {
  const supabase = createReseedSupabase();
  supabase.from = (table) => {
    if (table === "app_config") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
        }),
      };
    }
    throw new Error(`Unexpected table after failed flag read: ${table}`);
  };
  const result = await reseedTierPools("season-2", { supabase });
  assert.equal(result.enabled, false);
});

// ── 2-3. Tændt: hvad der faktisk skrives ─────────────────────────────────────

test("reseedTierPools: skriver KUN league_division_id, aldrig division", async () => {
  const supabase = createReseedSupabase();
  const result = await reseedTierPools("season-2", { supabase });

  assert.equal(result.enabled, true);
  assert.ok(result.moved > 0, "den skæve tier skal give flytninger");
  for (const u of supabase.updates) {
    assert.deepEqual(Object.keys(u.payload), ["league_division_id"]);
    assert.ok([4, 5].includes(u.payload.league_division_id));
  }
});

test("reseedTierPools: sænker skævheds-indekset for tieren", async () => {
  const supabase = createReseedSupabase();
  const result = await reseedTierPools("season-2", { supabase });
  const tier3 = result.tiers.find((t) => t.tier === 3);
  assert.equal(tier3.applied, true);
  assert.equal(tier3.beforeIndex, 34);
  assert.equal(tier3.projectedIndex, 9);
  assert.equal(tier3.moved, supabase.updates.length);
});

test("reseedTierPools: AI-hold flyttes ALDRIG", async () => {
  const specs = improvableSpecs().map((s, i) => (i % 2 === 1 ? { ...s, isAi: true } : s));
  const aiIds = new Set(specs.filter((s) => s.isAi).map((s) => s.id));
  const supabase = createReseedSupabase({ specs });

  await reseedTierPools("season-2", { supabase });
  for (const u of supabase.updates) {
    assert.ok(!aiIds.has(u.id), `AI-hold ${u.id} blev re-seedet`);
  }
});

test("reseedTierPools: sender pulje-besked til manageren med i18n-koder", async () => {
  const supabase = createReseedSupabase({ userIdByTeam: { mid2: "user-mid2", mid3: "user-mid3" } });
  await reseedTierPools("season-2", { supabase });

  const moved = new Set(supabase.updates.map((u) => u.id));
  const expected = ["mid2", "mid3"].filter((id) => moved.has(id));
  assert.ok(expected.length > 0, "fixture skal flytte mindst ét hold med en ejer");
  assert.equal(supabase.notifications.length, expected.length);
  for (const n of supabase.notifications) {
    assert.equal(n.type, "board_update");
    assert.equal(n.metadata.titleCode, "notif.poolReseeded.title");
    assert.equal(n.metadata.messageCode, "notif.poolReseeded.message");
    assert.match(n.metadata.messageParams.pool, /^Division 3 - [AB]$/);
  }
});

// ── #5536: ungdomspuljer og pensionerede puljer er ikke reseed-mål ──────────

test("#5536 reseedTierPools: ungdomspuljer og pensionerede puljer i fixturen ændrer intet (senior bit-identisk)", async () => {
  const plain = createReseedSupabase({ userIdByTeam: { mid2: "user-mid2" } });
  const plainResult = await reseedTierPools("season-2", { supabase: plain });

  // Samme tier/pool_index som seniorpuljerne (spec §6.1) + en pensioneret seniorpulje.
  const youth = POOLS.map((p) => ({ ...p, id: p.id + 100, squad: "u23", label: `U23 ${p.label}` }));
  const retired = { id: 6, tier: 3, pool_index: 2, label: "Division 3 - C", retired_at: "2026-09-28T00:00:00Z" };
  const mixed = createReseedSupabase({
    pools: [...POOLS, ...youth, retired],
    userIdByTeam: { mid2: "user-mid2" },
  });
  const mixedResult = await reseedTierPools("season-2", { supabase: mixed });

  assert.ok(plain.updates.length > 0, "kontrol: fixturen skal give flytninger");
  assert.deepEqual(mixedResult, plainResult);
  assert.deepEqual(mixed.updates, plain.updates);
  assert.deepEqual(mixed.notifications, plain.notifications);
  for (const u of mixed.updates) {
    assert.ok([4, 5].includes(u.payload.league_division_id), `hold ${u.id} flyttet til pulje ${u.payload.league_division_id}`);
  }
});

// ── 4. Forbedrings-kravet ────────────────────────────────────────────────────

test("reseedTierPools: udfører IKKE en plan der ikke forbedrer skævheden", async () => {
  const supabase = createReseedSupabase({ specs: unimprovableSpecs() });
  const result = await reseedTierPools("season-2", { supabase });

  const tier3 = result.tiers.find((t) => t.tier === 3);
  assert.equal(tier3.applied, false);
  assert.equal(tier3.skipReason, "no-improvement");
  assert.equal(result.moved, 0);
  assert.deepEqual(supabase.updates, [], "en nyttesløs plan må ikke røre databasen");
});

test("reseedTierPools: tier under tærsklen røres ikke", async () => {
  const specs = [
    ...Array.from({ length: 6 }, (_, i) => flat(`a${i}`, 4, 30)),
    ...Array.from({ length: 6 }, (_, i) => flat(`b${i}`, 5, 30)),
  ];
  const supabase = createReseedSupabase({ specs });
  const result = await reseedTierPools("season-2", { supabase });

  const tier3 = result.tiers.find((t) => t.tier === 3);
  assert.equal(tier3.applied, false);
  assert.equal(tier3.skipReason, "below-threshold");
  assert.deepEqual(supabase.updates, []);
});

test("reseedTierPools: tærsklen kan hæves via app_config uden deploy", async () => {
  const supabase = createReseedSupabase({ thresholdValue: 100 });
  const result = await reseedTierPools("season-2", { supabase });
  assert.equal(result.threshold, 100);
  assert.deepEqual(supabase.updates, []);
});

test("reseedTierPools: ugyldig tærskel i app_config falder tilbage til default 10", async () => {
  const supabase = createReseedSupabase({ thresholdValue: "ikke-et-tal" });
  const result = await reseedTierPools("season-2", { supabase });
  assert.equal(result.threshold, 10);
});

// ── 5. Kald-rækkefølgen i processSeasonEnd ───────────────────────────────────
// Reseed'et SKAL ligge efter hele op/nedryknings-loopet (tierens medlemsliste er
// først endelig dér) og før AI-fyld-sweepen (så reconcile ser de endelige
// ægte-hold-tal). Rækkefølgen verificeres statisk mod kilden, fordi et fuldt
// processSeasonEnd-mock ville skjule præcis den detalje. (#4592 gjorde
// processDivisionEnd/reconcileAiTeamsForPool injicérbare; den kørende
// rækkefølge bevises også adfærdsmæssigt i economyEngine.test.js.)

test("processSeasonEnd kalder reseed EFTER processDivisionEnd og FØR reconcileAiTeamsForPool", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./economyEngine.js", import.meta.url), "utf8");

  const divisionLoop = src.indexOf("await processDivisionEndFn(divStandings");
  const reseedCall = src.indexOf("const reseedFn = deps.reseedTierPools");
  const reconcile = src.indexOf("await reconcileAiTeamsFn(");

  assert.ok(divisionLoop > 0 && reseedCall > 0 && reconcile > 0, "alle tre kald skal findes");
  assert.ok(divisionLoop < reseedCall, "reseed skal kaldes EFTER op/nedryknings-loopet");
  assert.ok(reseedCall < reconcile, "reseed skal kaldes FØR AI-fyld-sweepen");
});

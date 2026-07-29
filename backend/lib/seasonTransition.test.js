import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTransitionPlan,
  closePrevTransferWindow,
  computeSeasonUuid,
  computeTransferWindowUuid,
  insertTransferWindowIfMissing,
  resolveTransitionSourceSeason,
  transitionToNextSeason,
} from "./seasonTransition.js";

// ─── UUID helper tests (pure functions) ───────────────────────────────────────

test("computeSeasonUuid — sæson 0 maps to all-zero UUID", () => {
  assert.equal(computeSeasonUuid(0), "00000000-0000-0000-0000-000000000000");
});

test("computeSeasonUuid — sæson 1, 2, 16 use deterministic hex pattern", () => {
  assert.equal(computeSeasonUuid(1), "00000000-0000-0000-0000-000000000001");
  assert.equal(computeSeasonUuid(2), "00000000-0000-0000-0000-000000000002");
  assert.equal(computeSeasonUuid(16), "00000000-0000-0000-0000-000000000010");
});

test("computeSeasonUuid — rejects negative and non-integer input", () => {
  assert.throws(() => computeSeasonUuid(-1));
  assert.throws(() => computeSeasonUuid(1.5));
  assert.throws(() => computeSeasonUuid("1"));
});

test("computeTransferWindowUuid — sæson 0 → ...00000000aaaa", () => {
  assert.equal(computeTransferWindowUuid(0), "00000000-0000-0000-0000-00000000aaaa");
  assert.equal(computeTransferWindowUuid(1), "00000000-0000-0000-0000-00000001aaaa");
  assert.equal(computeTransferWindowUuid(16), "00000000-0000-0000-0000-00000010aaaa");
});

// ─── Mock Supabase factory ────────────────────────────────────────────────────

function createMockSupabase(initialState = {}) {
  const state = {
    seasons: initialState.seasons ? [...initialState.seasons] : [],
    transfer_windows: initialState.transfer_windows ? [...initialState.transfer_windows] : [],
    teams: initialState.teams ? [...initialState.teams] : [],
    season_standings: initialState.season_standings ? [...initialState.season_standings] : [],
    admin_log: initialState.admin_log ? [...initialState.admin_log] : [],
    notifications: initialState.notifications ? [...initialState.notifications] : [],
    sponsor_contracts: initialState.sponsor_contracts ? [...initialState.sponsor_contracts] : [],
    app_config: initialState.app_config ? [...initialState.app_config] : [],
    // #2916 · carry-over-fasen læser disse fem tabeller. De defaulter til tomme
    // arrays så den ægte fase kan køre igennem i alle transition-tests (i stedet
    // for at blive stubbet væk og dermed aldrig blive testet i sin kontekst).
    training_plans: initialState.training_plans ? [...initialState.training_plans] : [],
    riders: initialState.riders ? [...initialState.riders] : [],
    races: initialState.races ? [...initialState.races] : [],
    rider_peak_plans: initialState.rider_peak_plans ? [...initialState.rider_peak_plans] : [],
    race_entries: initialState.race_entries ? [...initialState.race_entries] : [],
  };
  const calls = { inserts: [], updates: [], upserts: [] };

  function chain(table, filters = {}, orderBy = null, limit = null, range = null) {
    return {
      eq(col, val) {
        return chain(table, { ...filters, [col]: val }, orderBy, limit, range);
      },
      // fetchAllRows påfører .range(from, to) pr. side (#2926: sponsor_contracts
      // hentes pagineret). Mocken respekterer vinduet så pagineringen faktisk testes.
      range(from, to) {
        return chain(table, filters, orderBy, limit, { from, to });
      },
      // gte er en no-op i mocken (created_at-vindue findes ikke for in-memory
      // rows) — dedup matcher derfor på user/type/title/message/related_id, hvilket
      // er nok til at teste notifyUser-stien fra emitSeasonStartedNotifications.
      gte() {
        return chain(table, filters, orderBy, limit);
      },
      is(col, val) {
        return chain(table, { ...filters, [col]: val }, orderBy, limit);
      },
      // #2916 · carry-over-fasen bruger .in() (hold-chunkede rytter-loads).
      // .range() findes allerede ovenfor fra #2926's paginerings-støtte — den
      // deferred variant er den rigtige, fordi den også respekterer .order().
      in(col, vals) {
        return chain(table, { ...filters, [col]: { __in: new Set(vals) } }, orderBy, limit, range);
      },
      order(col, opts) {
        return chain(table, filters, { col, asc: opts?.ascending ?? true }, limit);
      },
      limit(n) {
        return chain(table, filters, orderBy, n);
      },
      contains(col, criteria) {
        return chain(table, { ...filters, __contains: { col, criteria } }, orderBy, limit);
      },
      maybeSingle() {
        const rows = state[table].filter((row) => matchesFilters(row, filters));
        const ordered = orderBy
          ? [...rows].sort((a, b) => {
              const av = a[orderBy.col]; const bv = b[orderBy.col];
              if (av === bv) return 0;
              return orderBy.asc ? (av > bv ? 1 : -1) : (av > bv ? -1 : 1);
            })
          : rows;
        const first = ordered[0] ?? null;
        return Promise.resolve({ data: first, error: null });
      },
      single() {
        const rows = state[table].filter((row) => matchesFilters(row, filters));
        if (rows.length !== 1) {
          return Promise.resolve({ data: null, error: { message: `Expected 1 row, got ${rows.length}` } });
        }
        return Promise.resolve({ data: rows[0], error: null });
      },
      then(resolve) {
        // Direct await without terminal — return all matching rows (evt. skåret
        // til det range fetchAllRows har bedt om).
        const rows = state[table].filter((row) => matchesFilters(row, filters));
        const ordered = orderBy
          ? [...rows].sort((a, b) => {
              const av = a[orderBy.col]; const bv = b[orderBy.col];
              if (av === bv) return 0;
              return orderBy.asc ? (av > bv ? 1 : -1) : (av > bv ? -1 : 1);
            })
          : rows;
        return resolve({
          data: range ? ordered.slice(range.from, range.to + 1) : ordered,
          error: null,
        });
      },
    };
  }

  function matchesFilters(row, filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (k === "__contains") {
        const inner = row[v.col] || {};
        for (const [ik, iv] of Object.entries(v.criteria)) {
          if (inner[ik] !== iv) return false;
        }
        continue;
      }
      if (v && typeof v === "object" && v.__in instanceof Set) {
        if (!v.__in.has(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  }

  return {
    __state: state,
    __calls: calls,
    from(table) {
      return {
        select(_cols) {
          return chain(table);
        },
        insert(payload) {
          const row = Array.isArray(payload) ? payload[0] : payload;
          state[table].push({ ...row });
          calls.inserts.push({ table, row });
          return {
            select() {
              return {
                single: () => Promise.resolve({ data: row, error: null }),
              };
            },
            then(resolve) {
              return resolve({ error: null });
            },
          };
        },
        upsert(rows, opts) {
          const list = Array.isArray(rows) ? rows : [rows];
          state[table] = state[table] || [];
          const inserted = [];
          for (const row of list) {
            const stored = { ...row };
            state[table].push(stored);
            inserted.push(stored);
          }
          calls.upserts.push({ table, rows: list, opts });
          const result = { data: inserted, error: null };
          return {
            select: () => Promise.resolve(result),
            then: (resolve) => resolve(result),
          };
        },
        update(payload) {
          return {
            eq(col, val) {
              const matched = state[table].filter((r) => r[col] === val);
              for (const row of matched) Object.assign(row, payload);
              calls.updates.push({ table, payload, eq: { col, val } });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

// ─── Plan-builder tests ───────────────────────────────────────────────────────

test("buildTransitionPlan — sæson 0 → 1 plan med 22 humans, auto-default 'safe' på D3-renown (#2926)", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active", start_date: "2026-05-08", end_date: null }],
    transfer_windows: [],
    teams: Array.from({ length: 22 }, (_, i) => ({
      id: `team-${i}`,
      name: `Team ${i}`,
      sponsor_income: 240000,
      division: 3,
      is_ai: false,
      is_bank: false,
      is_frozen: false, is_test_account: false,
    })),
  });

  const plan = await buildTransitionPlan({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
  });

  assert.equal(plan.from_season.number, 0);
  assert.equal(plan.to_season.number, 1);
  assert.equal(plan.to_season.id, "00000000-0000-0000-0000-000000000001");
  assert.equal(plan.to_season.transfer_window_id, "00000000-0000-0000-0000-00000001aaaa");
  assert.equal(plan.teams_affected, 22);
  // #2926: transitionens fase 5b giver hvert kontraktfrit hold en 'safe'-aftale FØR
  // sponsor-payouten, så previewet skal vise kontraktens garanterede base
  // (0,92 × renownTarget = 0,92 × 340k) — ikke den kontraktfri division-base på 340k.
  assert.equal(plan.sponsor_base_total, 22 * 312_800);
  assert.equal(plan.sponsor_contract_sources.default, 22);
  assert.equal(plan.sponsor_breakdown[0].sponsor_mode, "contract");
  assert.equal(plan.already_transitioned, false);
});

// #2852 · sæson-start-økonomien betalte de 3 test-konti ("Test A"/"Test B"/
// "Test Seller") fordi buildTransitionPlan kun filtrerede på is_ai/is_frozen.
// Prod-dry-run 25/7: 159 hold i planen mod 156 rigtige managerhold.
test("#2852 · buildTransitionPlan udelader test-konti, bank og frosne hold fra teams_affected", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "season-1", number: 1, status: "active", start_date: "2026-05-15", end_date: null }],
    teams: [
      { id: "human-1", name: "Human 1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "human-2", name: "Human 2", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "test-a", name: "Test A", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: true },
      { id: "test-b", name: "Test B", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: true },
      { id: "test-seller", name: "Test Seller", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: true },
      { id: "bank-1", name: "Bank", sponsor_income: 0, division: 3, is_ai: false, is_bank: true, is_frozen: false, is_test_account: false },
      { id: "frozen-1", name: "Frozen", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: true, is_test_account: false },
      { id: "ai-1", name: "AI", sponsor_income: 240000, division: 3, is_ai: true, is_bank: false, is_frozen: false, is_test_account: false },
    ],
  });

  const plan = await buildTransitionPlan({ supabase, fromSeasonId: "season-1" });

  assert.equal(plan.teams_affected, 2);
  const names = plan.sponsor_breakdown.map((row) => row.team_name).sort();
  assert.deepEqual(names, ["Human 1", "Human 2"]);
  assert.equal(
    plan.sponsor_breakdown.some((row) => row.team_name.startsWith("Test ")),
    false,
    "test-konti må hverken tælle med i teams_affected eller sponsor_base_total"
  );
});

test("buildTransitionPlan — sæson 1 → 2 preview bruger kontrakt-basen, ikke den kontraktfri variable model (#2926)", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "season-1", number: 1, status: "active", start_date: "2026-05-15", end_date: null }],
    teams: [
      { id: "team-1", name: "Top Team", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "team-2", name: "Mid Team", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "team-3", name: "Bottom Team", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
    ],
    season_standings: [
      { season_id: "season-1", team_id: "team-1", division: 3, total_points: 180, rank_in_division: 1 },
      { season_id: "season-1", team_id: "team-2", division: 3, total_points: 120, rank_in_division: 2 },
      { season_id: "season-1", team_id: "team-3", division: 3, total_points: 60, rank_in_division: 3 },
    ],
  });

  const plan = await buildTransitionPlan({
    supabase,
    fromSeasonId: "season-1",
  });

  assert.equal(plan.to_season.number, 2);
  // Alle tre hold er kontraktfri → auto-default 'safe' (0,92 × renownTarget).
  // renownTarget = 340k × clamp(1 + 0,45 × resultsScore, 1,0 … 1,40):
  //   top  (rank 1, 180 p, median 120) resultsScore 1,00 → ×1,40 = 476.000 → base 437.920
  //   mid  (rank 2, 120 p)             resultsScore 0,50 → ×1,225 = 416.500 → base 383.180
  //   bund (rank 3, 60 p)              resultsScore 0,00 → ×1,00 = 340.000 → base 312.800
  // Den GAMLE kontraktfri model gav 490k/415k/340k = 1.245.000 — ~9 % for højt.
  assert.equal(plan.sponsor_breakdown[0].sponsor_base, 437_920);
  assert.equal(plan.sponsor_breakdown[0].sponsor_mode, "contract");
  assert.equal(plan.sponsor_breakdown[0].sponsor_contract_source, "default");
  assert.equal(plan.sponsor_breakdown[1].sponsor_base, 383_180);
  assert.equal(plan.sponsor_breakdown[2].sponsor_base, 312_800);
  assert.equal(plan.sponsor_base_total, 1_133_900);
  assert.ok(plan.sponsor_base_total < 1_245_000, "kontrakt-modellen må aldrig give mere end den kontraktfri");
});

// ─── #2926 · Kontraktbestand-bevidst sponsor-preview ──────────────────────────

test("buildTransitionPlan — managerens pending valg aktiveres og bærer basen", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "season-1", number: 1, status: "active", start_date: "2026-05-15", end_date: null }],
    teams: [
      { id: "team-1", name: "Picked Team", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
    ],
    season_standings: [
      { season_id: "season-1", team_id: "team-1", division: 3, total_points: 180, rank_in_division: 1 },
    ],
    sponsor_contracts: [
      {
        id: "c-pending", team_id: "team-1", status: "pending", start_season: 2, expires_after_season: 2,
        variant: "racing", sponsor_name: "Alta Cycles", guaranteed_base: 238_000,
        guaranteed_fraction: 0.5, race_day_share: 0.58, length_seasons: 1, bonus_clauses: [],
      },
    ],
  });

  const plan = await buildTransitionPlan({ supabase, fromSeasonId: "season-1" });

  assert.equal(plan.sponsor_breakdown[0].sponsor_contract_source, "pending");
  assert.equal(plan.sponsor_breakdown[0].sponsor_base, 238_000);
  assert.equal(plan.sponsor_breakdown[0].sponsor_name, "Alta Cycles");
  assert.equal(plan.sponsor_base_total, 238_000);
  assert.equal(plan.sponsor_contract_sources.pending, 1);
  // race_day_share × target (238.000 / 0,5 = 476.000) = 276.080 — optjenes pr. etape
  // HEN OVER sæsonen, ikke ved skiftet.
  assert.equal(plan.sponsor_race_day_pool_total, 276_080);
  assert.equal(plan.sponsor_signing_bonus_total, 0);
});

test("buildTransitionPlan — låst flersæsons kontrakt beholdes (pending for en anden sæson ignoreres)", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "season-1", number: 1, status: "active", start_date: "2026-05-15", end_date: null }],
    teams: [
      { id: "team-1", name: "Locked Team", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
    ],
    season_standings: [
      { season_id: "season-1", team_id: "team-1", division: 3, total_points: 180, rank_in_division: 1 },
    ],
    sponsor_contracts: [
      {
        id: "c-active", team_id: "team-1", status: "active", start_season: 1, expires_after_season: 3,
        variant: "loyal", sponsor_name: "Falcon Logistics", guaranteed_base: 371_280,
        guaranteed_fraction: 0.78, race_day_share: 0.18, length_seasons: 3,
        bonus_clauses: [{ type: "signing", amount: 38_080 }],
      },
      {
        id: "c-pending-s4", team_id: "team-1", status: "pending", start_season: 4, expires_after_season: 4,
        variant: "safe", sponsor_name: "Meridian Bank", guaranteed_base: 999_999,
        guaranteed_fraction: 0.92, race_day_share: 0.08, length_seasons: 1, bonus_clauses: [],
      },
    ],
  });

  const plan = await buildTransitionPlan({ supabase, fromSeasonId: "season-1" });

  assert.equal(plan.sponsor_breakdown[0].sponsor_contract_source, "locked");
  assert.equal(plan.sponsor_base_total, 371_280);
  assert.equal(plan.sponsor_contract_sources.locked, 1);
  // Signing-bonussen blev betalt da kontrakten blev aktiveret — den udbetales IKKE igen.
  assert.equal(plan.sponsor_signing_bonus_total, 0);
});

test("buildTransitionPlan — signing-bonus på et pending 'loyal'-valg rapporteres separat", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "season-1", number: 1, status: "active", start_date: "2026-05-15", end_date: null }],
    teams: [
      { id: "team-1", name: "Loyal Team", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
    ],
    season_standings: [
      { season_id: "season-1", team_id: "team-1", division: 3, total_points: 180, rank_in_division: 1 },
    ],
    sponsor_contracts: [
      {
        id: "c-pending", team_id: "team-1", status: "pending", start_season: 2, expires_after_season: 4,
        variant: "loyal", sponsor_name: "Thorne Logistics", guaranteed_base: 371_280,
        guaranteed_fraction: 0.78, race_day_share: 0.18, length_seasons: 3,
        bonus_clauses: [{ type: "signing", amount: 38_080 }],
      },
    ],
  });

  const plan = await buildTransitionPlan({ supabase, fromSeasonId: "season-1" });

  assert.equal(plan.sponsor_base_total, 371_280);
  assert.equal(plan.sponsor_signing_bonus_total, 38_080);
});

test("buildTransitionPlan — realistisk blanding (låst + valgt + kontraktfri) ligger under den gamle kontraktfri model", async () => {
  // Fixture spejler prod-mixet 25/7: udløbende S1-kontrakter (expires_after_season=1),
  // managervalg for S2, og hold der intet har valgt → auto-default 'safe'.
  const supabase = createMockSupabase({
    seasons: [{ id: "season-1", number: 1, status: "active", start_date: "2026-06-22", end_date: null }],
    teams: [
      { id: "t-locked", name: "Locked", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "t-expiring", name: "Expiring", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "t-picked", name: "Picked", sponsor_income: 240000, division: 4, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "t-silent", name: "Silent", sponsor_income: 240000, division: 4, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
    ],
    season_standings: [
      { season_id: "season-1", team_id: "t-locked", division: 3, total_points: 400, rank_in_division: 1 },
      { season_id: "season-1", team_id: "t-expiring", division: 3, total_points: 200, rank_in_division: 2 },
      // AI-hold tæller med i divisionens median/størrelse (samme som i drift).
      { season_id: "season-1", team_id: "ai-d3", division: 3, total_points: 100, rank_in_division: 3 },
      { season_id: "season-1", team_id: "t-picked", division: 4, total_points: 300, rank_in_division: 1 },
      { season_id: "season-1", team_id: "t-silent", division: 4, total_points: 100, rank_in_division: 2 },
      { season_id: "season-1", team_id: "ai-d4", division: 4, total_points: 50, rank_in_division: 3 },
    ],
    sponsor_contracts: [
      {
        id: "c1", team_id: "t-locked", status: "active", start_season: 1, expires_after_season: 3,
        variant: "long", sponsor_name: "Nordhavn Shipping", guaranteed_base: 294_433,
        guaranteed_fraction: 0.73, race_day_share: 0.27, length_seasons: 3, bonus_clauses: [],
      },
      {
        // Udløber ved sæson 1 → må IKKE tælle som låst; holdet får auto-default.
        id: "c2", team_id: "t-expiring", status: "active", start_season: 1, expires_after_season: 1,
        variant: "predictable", sponsor_name: "Halvorsen Bank", guaranteed_base: 360_800,
        guaranteed_fraction: 0.88, race_day_share: 0.12, length_seasons: 1, bonus_clauses: [],
      },
      {
        id: "c3", team_id: "t-picked", status: "pending", start_season: 2, expires_after_season: 3,
        variant: "activity", sponsor_name: "Kestrel Outdoor", guaranteed_base: 227_463,
        guaranteed_fraction: 0.55, race_day_share: 0.45, length_seasons: 2, bonus_clauses: [],
      },
    ],
  });

  const plan = await buildTransitionPlan({ supabase, fromSeasonId: "season-1" });

  assert.deepEqual(plan.sponsor_contract_sources, { locked: 1, pending: 1, default: 2 });
  const byName = Object.fromEntries(plan.sponsor_breakdown.map((r) => [r.team_name, r]));
  assert.equal(byName.Locked.sponsor_base, 294_433);   // låst aftale, urørt af renown
  assert.equal(byName.Picked.sponsor_base, 227_463);   // managerens valg
  // Expiring: D3-median 200, rank 2 af 3 → resultsScore 0,50 → renown ×1,225
  //           → 416.500 × 0,92 (safe) = 383.180
  assert.equal(byName.Expiring.sponsor_base, 383_180);
  assert.equal(byName.Expiring.sponsor_contract_source, "default");
  // Silent: D4 (315k), D4-median 100, rank 2 af 3 → resultsScore 0,50 → 385.875 × 0,92
  assert.equal(byName.Silent.sponsor_base, 355_005);
  assert.equal(plan.sponsor_base_total, 1_260_081);

  // Den GAMLE kontraktfri model (division-base + variabel pulje op til 150k) gav
  // 1.760.000 for præcis samme population — ~28 % for højt. Regressions-låsen for #2926.
  assert.ok(
    plan.sponsor_base_total < 1_760_000,
    "kontrakt-modellen skal ligge under den kontraktfri model"
  );
});

test("buildTransitionPlan — already_transitioned=true når sæson 1 allerede eksisterer", async () => {
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active", start_date: "2026-05-08" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active", start_date: "2026-05-09" },
    ],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const plan = await buildTransitionPlan({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(plan.already_transitioned, true);
});

test("buildTransitionPlan — kaster fejl hvis fromSeason ikke 'active'", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed" }],
  });

  await assert.rejects(
    () => buildTransitionPlan({ supabase, fromSeasonId: "00000000-0000-0000-0000-000000000000" }),
    /must be 'active'/
  );
});

test("buildTransitionPlan — kaster fejl hvis fromSeason mangler", async () => {
  const supabase = createMockSupabase({ seasons: [] });
  await assert.rejects(
    () => buildTransitionPlan({ supabase, fromSeasonId: "missing-id" }),
    /not found/
  );
});

// ─── Dry-run tests ────────────────────────────────────────────────────────────

test("transitionToNextSeason — dry-run laver ingen writes", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    dryRun: true,
    deps: { processSeasonStart: async () => { throw new Error("dry-run må ikke kalde processSeasonStart"); } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.plan.from_season.number, 0);
  assert.equal(result.plan.to_season.number, 1);
  assert.equal(supabase.__calls.inserts.length, 0);
  assert.equal(supabase.__calls.updates.length, 0);
});

// ─── Real-run tests ───────────────────────────────────────────────────────────

test("transitionToNextSeason — real run udfører alle 6 faser", async () => {
  const sponsorCalls = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    adminUserId: "admin-uuid",
    deps: {
      // #535: processSeasonStart returnerer nu { sponsor, payroll } i stedet
      // for ren sponsor-array. season_payroll-fase i return-log læser fra
      // payroll.summary.
      processSeasonStart: async (seasonId, _deps) => {
        sponsorCalls.push(seasonId);
        return {
          sponsor: [{ team: "T1", sponsor: 240000, recurring_loan_fees: 0, pullout_applied: false }],
          payroll: {
            results: [{ team: "T1", team_id: "t1", loan_interest: 0, salary: 0, emergency_loan_amount: 0, negative_balance_interest: 0 }],
            summary: {
              teams_processed: 1,
              loan_interest_count: 0,
              loan_interest_total: 0,
              salary_count: 0,
              salary_total: 0,
              emergency_loan_count: 0,
              emergency_loan_total: 0,
              negative_balance_interest_count: 0,
              negative_balance_interest_total: 0,
            },
          },
          // #1980: nedrykningsfaldskærm — { count, total } summary.
          parachute: { count: 0, total: 0 },
        };
      },
      notifySeasonEvent: async () => {},
      // #1663: kontrakt-fornyelse stubbet — egen unit-test dækker DB-laget.
      expireAndRenewContracts: async () => {},
      // #1836: kontraktudløb-notifikationer stubbet — egen unit-test dækker emit-logikken.
      emitContractExpiringNotifications: async () => ({ eligible: 0, delivered: 0, deduped: 0, failed: 0 }),
      // #2453: Global Rank-rollover stubbet — egen unit-test dækker RPC-laget (SQL).
      applyGlobalRankSeasonRollover: async () => ({ ok: true }),
      // #2744-B: kontraktudløb-frigivelse stubbet — egen unit-test (contractExpiryRelease.test.js)
      // dækker release-logikken; dedikerede wiring-tests nedenfor dækker fase-placeringen.
      releaseExpiredContractRiders: async () => ({ candidates: 0, released: 0, deferredByRacing: 0, notified: 0, notifyFailed: 0 }),
      // #2748: pensions-frigivelse stubbet — egen unit-test (retirementRelease.test.js)
      // dækker release-logikken; wiring-testen nedenfor dækker fase-placeringen.
      releaseRetiredRiders: async () => ({ candidates: 0, released: 0, failed: 0 }),
      // #3043: squad-under-minimum-tjek stubbet — egen unit-test
      // (squadBelowMinimumCheck.test.js) dækker detektions-/varslings-logikken;
      // wiring-testen nedenfor dækker fase-placeringen.
      detectAndNotifySquadsBelowMinimum: async () => ({ checked: 0, belowMinimum: 0, notified: 0, notifyFailed: 0, teams: [] }),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  // #535: 8 faser; #1357: +season_started_notifications; #1663: +sponsor_contracts_renewal;
  // #1836: +contract_expiring_notifications; #2453: +global_rank_decay;
  // #1980: +season_parachute; #2744-B: +contract_expiry_release;
  // #2748: +retirement_release; #2948: +sponsor_season_objectives;
  // #2916: +manager_setup_carry_over; #3043: +squad_below_minimum_check = 18
  assert.equal(result.log.length, 18);
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].inserted, true);
  assert.equal(result.log[1].phase, "mark_previous_completed");
  assert.equal(result.log[1].updated, true);
  assert.equal(result.log[2].phase, "global_rank_decay");
  assert.equal(result.log[2].ok, true);
  assert.equal(result.log[3].phase, "close_prev_transfer_window");
  assert.equal(result.log[3].updated, true);
  assert.equal(result.log[4].phase, "insert_next_transfer_window");
  assert.equal(result.log[4].inserted, true);
  // #2948: sæsonmåls-bonusser evalueres FØR kontrakt-fornyelsen (klausulen sidder
  // på den stadig-aktive kontrakt). Ingen sponsor_contracts seedet i denne mock
  // → default-implementeringen (ikke stubbet) rammer 0 kontrakter med klausulen.
  assert.equal(result.log[5].phase, "sponsor_season_objectives");
  assert.equal(result.log[5].evaluated, 0);
  assert.equal(result.log[5].paid, 0);
  assert.equal(result.log[6].phase, "sponsor_contracts_renewal");
  assert.equal(result.log[6].teams, 1);
  assert.equal(result.log[7].phase, "contract_expiry_release");
  assert.equal(result.log[7].candidates, 0);
  assert.equal(result.log[8].phase, "sponsor_payout");
  assert.equal(result.log[8].count, 1);
  assert.equal(result.log[9].phase, "season_payroll");
  assert.equal(result.log[9].teams_processed, 1);
  assert.equal(result.log[9].salary_count, 0);
  assert.equal(result.log[10].phase, "season_parachute");
  assert.equal(result.log[10].count, 0);
  assert.equal(result.log[10].total, 0);
  assert.equal(result.log[11].phase, "retirement_release");
  assert.equal(result.log[11].candidates, 0);
  // #3043 · squad-under-minimum-tjek kører EFTER begge frigivelses-faser
  // (kontraktudløb + pension) og FØR carry-over.
  assert.equal(result.log[12].phase, "squad_below_minimum_check");
  assert.equal(result.log[12].belowMinimum, 0);
  // #2916 · carry-over kører EFTER trup-frigivelserne og FØR admin_log.
  assert.equal(result.log[13].phase, "manager_setup_carry_over");
  assert.equal(result.log[13].error, undefined, "carry-over må ikke fejle i en tom mock");
  assert.deepEqual(result.log[13].handler_drift, []);
  assert.equal(result.log[13].carried_total, 0);
  assert.equal(result.log[14].phase, "admin_log");
  assert.equal(result.log[14].inserted, true);
  assert.equal(result.log[15].phase, "discord_broadcast");
  assert.equal(result.log[15].sent, true);
  assert.equal(result.log[16].phase, "season_started_notifications");
  assert.equal(result.log[17].phase, "contract_expiring_notifications");

  assert.deepEqual(sponsorCalls, ["00000000-0000-0000-0000-000000000001"]);

  const newSeason = supabase.__state.seasons.find((s) => s.number === 1);
  assert.ok(newSeason);
  assert.equal(newSeason.status, "active");
  assert.equal(newSeason.start_date, "2026-05-15T06:00:00.000Z");

  const oldSeason = supabase.__state.seasons.find((s) => s.number === 0);
  assert.equal(oldSeason.status, "completed");
  assert.equal(oldSeason.end_date, "2026-05-15T06:00:00.000Z");

  const newWindow = supabase.__state.transfer_windows.find((w) => w.id === "00000000-0000-0000-0000-00000001aaaa");
  assert.ok(newWindow);
  assert.equal(newWindow.status, "closed");

  const oldWindow = supabase.__state.transfer_windows.find((w) => w.id === "win-0");
  assert.equal(oldWindow.status, "closed");

  const adminEntry = supabase.__state.admin_log.find((e) => e.action_type === "season_transition");
  assert.ok(adminEntry);
  assert.equal(adminEntry.meta.from_season_number, 0);
  assert.equal(adminEntry.meta.to_season_number, 1);
});

// #2744-B · Kontraktudløb-frigivelse: ny fase parallelt med sponsor_contracts_renewal.
// Kaldes med DEN AFSLUTTEDE sæsons nummer (plan.from_season.number) — riderne der
// frigives har contract_end_season <= DEN sæson, ikke den nye.
test("transitionToNextSeason — kalder releaseExpiredContractRiders med den AFSLUTTEDE sæsons nummer, efter sponsor_contracts_renewal", async () => {
  let releaseArgs = null;
  const order = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async () => { order.push("renew"); },
      releaseExpiredContractRiders: async (args) => {
        order.push("release");
        releaseArgs = args;
        return { candidates: 196, released: 195, deferredByRacing: 1, notified: 1, notifyFailed: 0 };
      },
      processSeasonStart: async () => { order.push("seasonStart"); return { sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }; },
      notifySeasonEvent: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(order, ["renew", "release", "seasonStart"], "frigivelse sker EFTER kontrakt-fornyelse og FØR sæson-start/rytterudvikling");
  assert.ok(releaseArgs, "releaseExpiredContractRiders skal kaldes");
  assert.equal(releaseArgs.seasonNumber, 0, "den AFSLUTTEDE sæsons nummer (fromSeason.number), ikke den nye (1)");

  const releasePhase = result.log.find((p) => p.phase === "contract_expiry_release");
  assert.ok(releasePhase, "contract_expiry_release-fasen skal logges");
  assert.equal(releasePhase.candidates, 196);
  assert.equal(releasePhase.released, 195);
  assert.equal(releasePhase.deferredByRacing, 1);
});

// #2748 · Pensions-frigivelse. Modsat kontraktudløb (som kører FØR sæson-start, så
// de frigivne ikke betaler den nye sæsons løn) skal denne fase køre EFTER
// processSeasonStart — det er DÉR rytterudviklingen sætter is_retired. Kører den
// før, er der ingen nypensionerede at frigive, og de ville hænge en hel sæson.
test("transitionToNextSeason — releaseRetiredRiders kaldes EFTER sæson-start (hvor pensioneringen sættes)", async () => {
  const order = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async () => {},
      releaseExpiredContractRiders: async () => { order.push("contractRelease"); return { candidates: 0, released: 0, deferredByRacing: 0, notified: 0, notifyFailed: 0 }; },
      processSeasonStart: async () => { order.push("seasonStart"); return { sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }; },
      releaseRetiredRiders: async () => { order.push("retirementRelease"); return { candidates: 12, released: 12, failed: 0 }; },
      notifySeasonEvent: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    order,
    ["contractRelease", "seasonStart", "retirementRelease"],
    "pensions-frigivelsen skal ligge EFTER sæson-start (rytterudviklingen), ikke sammen med kontraktudløbet"
  );

  const phase = result.log.find((p) => p.phase === "retirement_release");
  assert.ok(phase, "retirement_release-fasen skal logges");
  assert.equal(phase.candidates, 12);
  assert.equal(phase.released, 12);
  assert.equal(phase.failed, 0);
});

// #3043 · Squad-under-minimum-tjek: skal køre EFTER BEGGE frigivelses-faser
// (kontraktudløb + pension), så den ser den ENDELIGE post-transition trup, ikke
// et mellemstadie hvor en af de to endnu ikke har fjernet ryttere.
test("transitionToNextSeason — detectAndNotifySquadsBelowMinimum kaldes EFTER contract_expiry_release og retirement_release", async () => {
  const order = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  let receivedSupabase = null;
  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async () => {},
      releaseExpiredContractRiders: async () => { order.push("contractRelease"); return { candidates: 0, released: 0, deferredByRacing: 0, notified: 0, notifyFailed: 0 }; },
      processSeasonStart: async () => { order.push("seasonStart"); return { sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }; },
      releaseRetiredRiders: async () => { order.push("retirementRelease"); return { candidates: 0, released: 0, failed: 0 }; },
      detectAndNotifySquadsBelowMinimum: async (args) => {
        order.push("squadBelowMinimumCheck");
        receivedSupabase = args.supabase;
        return { checked: 1, belowMinimum: 1, notified: 1, notifyFailed: 0, teams: [{ teamId: "t1", name: "T1", activeRiders: 3 }] };
      },
      notifySeasonEvent: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    order,
    ["contractRelease", "seasonStart", "retirementRelease", "squadBelowMinimumCheck"],
    "squad-tjekket skal ligge EFTER begge frigivelses-faser, så det ser den endelige post-transition trup"
  );
  assert.equal(receivedSupabase, supabase);

  const phase = result.log.find((p) => p.phase === "squad_below_minimum_check");
  assert.ok(phase, "squad_below_minimum_check-fasen skal logges");
  assert.equal(phase.belowMinimum, 1);
  assert.deepEqual(phase.teams, [{ teamId: "t1", name: "T1", activeRiders: 3 }]);
});

test("transitionToNextSeason — en fejl i squad_below_minimum_check isoleres og logger de PARTIELLE stats", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const boom = new Error("rider-count-fetch eksploderede efter 90 hold");
  boom.partialStats = { checked: 90, belowMinimum: 0, notified: 0, notifyFailed: 0, teams: [] };

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async () => {},
      releaseExpiredContractRiders: async () => ({ candidates: 0, released: 0, deferredByRacing: 0, notified: 0, notifyFailed: 0 }),
      processSeasonStart: async () => ({ sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }),
      releaseRetiredRiders: async () => ({ candidates: 0, released: 0, failed: 0 }),
      detectAndNotifySquadsBelowMinimum: async () => { throw boom; },
      notifySeasonEvent: async () => {},
    },
  });

  assert.equal(result.ok, true, "en fejlet squad-tjek-fase må ALDRIG vælte resten af sæson-transitionen");
  const phase = result.log.find((p) => p.phase === "squad_below_minimum_check");
  assert.ok(phase.error, "fejlen er synlig i loggen");
  assert.equal(phase.checked, 90, "operatøren skal kunne se hvor langt kørslen nåede");
  assert.ok(result.log.find((p) => p.phase === "admin_log"), "transitionen fortsætter efter den isolerede fejl");
});

// #2916 · end-to-end: en manager har lagt en træningsplan i sæson 0. Efter
// skiftet SKAL den samme plan findes i sæson 1 — ellers vælger dailyTraining
// tavst et auto-program pr. ryttertype, hver dag, uden en eneste besked.
test("#2916 · transitionToNextSeason bærer managerens træningsplan med over til den nye sæson", async () => {
  const S0 = "00000000-0000-0000-0000-000000000000";
  const S1 = "00000000-0000-0000-0000-000000000001";
  const supabase = createMockSupabase({
    seasons: [{ id: S0, number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: S0, status: "open", created_at: "2026-05-08" }],
    teams: [
      { id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, league_division_id: 7 },
      { id: "t-test", name: "Test A", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: true, league_division_id: 7 },
    ],
    riders: [
      { id: "r1", team_id: "t1", is_retired: false },
      { id: "r-test", team_id: "t-test", is_retired: false },
    ],
    training_plans: [
      { id: "tp1", team_id: "t1", rider_id: "r1", season_id: S0, focus: "sprint", intensity: "hard" },
      { id: "tp-test", team_id: "t-test", rider_id: "r-test", season_id: S0, focus: "climbing", intensity: "easy" },
    ],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: S0,
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async () => {},
      releaseExpiredContractRiders: async () => ({ candidates: 0, released: 0 }),
      processSeasonStart: async () => ({ sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }),
      releaseRetiredRiders: async () => ({ candidates: 0, released: 0, failed: 0 }),
      notifySeasonEvent: async () => {},
    },
  });

  assert.equal(result.ok, true);
  const phase = result.log.find((p) => p.phase === "manager_setup_carry_over");
  assert.ok(phase, "carry-over-fasen skal logges");
  assert.equal(phase.error, undefined);
  assert.equal(phase.carried_total, 1);
  assert.equal(phase.surfaces.training_plans.eligible, 1);
  assert.equal(phase.surfaces.training_plans.skipped_non_human_team, 1, "test-kontoens plan bæres ikke over (#2852)");

  const carried = supabase.__state.training_plans.filter((p) => p.season_id === S1);
  assert.equal(carried.length, 1);
  assert.equal(carried[0].team_id, "t1");
  assert.equal(carried[0].rider_id, "r1");
  assert.equal(carried[0].focus, "sprint");
  assert.equal(carried[0].intensity, "hard");
});

test("#2916 · en fejl i carry-over isoleres og vælter ALDRIG sæsonskiftet", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const boom = new Error("upsert eksploderede efter 500 rækker");
  boom.partialStats = { source_rows: 1200, carried: 500 };

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async () => {},
      releaseExpiredContractRiders: async () => ({ candidates: 0, released: 0 }),
      processSeasonStart: async () => ({ sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }),
      releaseRetiredRiders: async () => ({ candidates: 0, released: 0, failed: 0 }),
      carryOverManagerSetup: async () => { throw boom; },
      notifySeasonEvent: async () => {},
    },
  });

  assert.equal(result.ok, true, "sæsonskiftet skal gennemføres selv om carry-over fejler");
  const phase = result.log.find((p) => p.phase === "manager_setup_carry_over");
  assert.equal(phase.error, "upsert eksploderede efter 500 rækker");
  assert.equal(phase.carried, 500, "de partielle stats skal med i loggen");
  assert.ok(result.log.some((p) => p.phase === "admin_log" && p.inserted));
});

test("#2916 · dry-run viser carry-over-tallene uden at skrive noget", async () => {
  const S0 = "00000000-0000-0000-0000-000000000000";
  const supabase = createMockSupabase({
    seasons: [{ id: S0, number: 0, status: "active" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
    riders: [{ id: "r1", team_id: "t1", is_retired: false }],
    training_plans: [{ id: "tp1", team_id: "t1", rider_id: "r1", season_id: S0, focus: "sprint", intensity: "hard" }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: S0,
    dryRun: true,
    deps: { processSeasonStart: async () => { throw new Error("dry-run må ikke kalde processSeasonStart"); } },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.carryOverPreview.dry_run, true);
  assert.equal(result.carryOverPreview.surfaces.training_plans.eligible, 1);
  assert.equal(result.carryOverPreview.surfaces.training_plans.carried, 0);
  assert.equal(supabase.__state.training_plans.length, 1, "dry-run må ikke skrive nye planer");
  assert.equal(supabase.__calls.upserts.length, 0);
});

test("transitionToNextSeason — en fejl i retirement_release isoleres og logger de PARTIELLE stats", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const boom = new Error("release eksploderede efter 7 ryttere");
  boom.partialStats = { candidates: 12, released: 7, failed: 1 };

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async () => {},
      releaseExpiredContractRiders: async () => ({ candidates: 0, released: 0, deferredByRacing: 0, notified: 0, notifyFailed: 0 }),
      processSeasonStart: async () => ({ sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }),
      releaseRetiredRiders: async () => { throw boom; },
      notifySeasonEvent: async () => {},
    },
  });

  assert.equal(result.ok, true, "en fejlet pensions-frigivelse må ALDRIG vælte resten af sæson-transitionen");
  const phase = result.log.find((p) => p.phase === "retirement_release");
  assert.ok(phase.error, "fejlen er synlig i loggen");
  assert.equal(phase.released, 7, "operatøren skal kunne se hvor langt kørslen nåede");
  assert.equal(phase.candidates, 12);
  assert.ok(result.log.find((p) => p.phase === "admin_log"), "transitionen fortsætter efter den isolerede fejl");
});

test("transitionToNextSeason — en fejl i contract_expiry_release isoleres og vælter ALDRIG resten af transitionen", async () => {
  // Bevidst UDEN stub for releaseExpiredContractRiders: default-implementeringen
  // rammer mock-supabasens "riders"-tabel, som mangler .range() (samme
  // fail-and-catch-mønster som global_rank_decay-testen ovenfor, der udnytter at
  // mock-supabase mangler .rpc).
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async () => {},
      processSeasonStart: async () => ({ sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }),
      notifySeasonEvent: async () => {},
    },
  });

  assert.equal(result.ok, true, "en fejlet release-fase må ALDRIG vælte resten af sæson-transitionen");
  const releasePhase = result.log.find((p) => p.phase === "contract_expiry_release");
  assert.ok(releasePhase, "fasen logges selv ved fejl");
  assert.ok(releasePhase.error, "fejlen er synlig i loggen til undersøgelse/manuel re-run");
  // Sponsor-payout (og resten) skal stadig være kørt bagefter.
  assert.ok(result.log.find((p) => p.phase === "sponsor_payout"), "transitionen fortsætter efter den isolerede fejl");
  assert.ok(result.log.find((p) => p.phase === "admin_log"), "admin_log-fasen når stadig at køre");
});

// #2700/#2748-review-fund: en fejl MIDT i frigivelsen (fx efter 150 af 196
// ryttere) må ikke kun logge fejlbeskeden — operatøren skal kunne se hvor langt
// den nåede FØR fejlen (releaseExpiredContractRiders hænger dette på
// err.partialStats, se contractExpiryRelease.js).
test("transitionToNextSeason — en fejl i contract_expiry_release logger de PARTIELLE stats (ikke kun fejlbeskeden)", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async () => {},
      processSeasonStart: async () => ({ sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }),
      notifySeasonEvent: async () => {},
      releaseExpiredContractRiders: async () => {
        const err = new Error("crashed after 150/196 riders (simuleret)");
        err.partialStats = { candidates: 196, released: 150, deferredByRacing: 2, notified: 148, notifyFailed: 1, failed: 0 };
        throw err;
      },
    },
  });

  assert.equal(result.ok, true);
  const releasePhase = result.log.find((p) => p.phase === "contract_expiry_release");
  assert.ok(releasePhase, "fasen logges selv ved fejl");
  assert.match(releasePhase.error, /crashed after 150\/196/);
  assert.equal(releasePhase.candidates, 196, "partial-tal er synlige i loggen, ikke kun fejlbeskeden");
  assert.equal(releasePhase.released, 150, "operatøren kan se AT 150 rent faktisk blev frigivet før krasjet");
  assert.equal(releasePhase.notified, 148);
});

// #1663 · Sponsor-kontrakter fornyes FØR sponsor-payout: hvert menneske-hold
// (is_ai=false, is_bank=false, is_frozen=false) får expireAndRenewContracts kaldt
// med den nye sæsons nummer + holdets id, og fasen kører før processSeasonStart.
test("transitionToNextSeason — fornyer sponsor-kontrakter før payout med nye sæsons nummer + menneske-hold", async () => {
  const order = [];
  let renewArgs = null;
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [
      { id: "human-1", name: "Human 1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "human-2", name: "Human 2", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      // Skal ekskluderes af samme diskriminator som processSeasonStart.
      { id: "ai-1", name: "AI", sponsor_income: 240000, division: 3, is_ai: true, is_bank: false, is_frozen: false, is_test_account: false },
      { id: "bank-1", name: "Bank", sponsor_income: 0, division: 3, is_ai: false, is_bank: true, is_frozen: false, is_test_account: false },
      { id: "frozen-1", name: "Frozen", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: true, is_test_account: false },
    ],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      expireAndRenewContracts: async (args) => { order.push("renew"); renewArgs = args; },
      processSeasonStart: async () => { order.push("seasonStart"); return { sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }; },
      notifySeasonEvent: async () => {},
    },
  });

  assert.equal(result.ok, true);
  // Fornyelse SKAL ske før season-start (ellers betaler payout en udløbet kontrakt).
  assert.deepEqual(order, ["renew", "seasonStart"]);
  assert.ok(renewArgs, "expireAndRenewContracts skal kaldes");
  assert.equal(renewArgs.newSeasonNumber, 1, "ny sæsons heltal = plan.to_season.number");
  assert.deepEqual(
    [...renewArgs.teamIds].sort(),
    ["human-1", "human-2"],
    "kun menneske-hold (ekskl. AI/bank/frozen)",
  );

  const renewalPhase = result.log.find((p) => p.phase === "sponsor_contracts_renewal");
  assert.ok(renewalPhase, "sponsor_contracts_renewal-fasen skal logges");
  assert.equal(renewalPhase.teams, 2);
});

// #1704 · Per-division-kalender (forever-sti): når auto_calendar_enabled er ON,
// materialiseres en frisk kalender for den NYE sæson EFTER season-start (sponsor/payroll)
// og FØR admin_log. Betinget fase (mønster som reset_board_test_data): logges kun når ON.
test("transitionToNextSeason — auto_calendar ON: materialiserer kalender for den nye sæson", async () => {
  let calArgs = null;
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      processSeasonStart: async () => ({ sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }),
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
      isAutoCalendarEnabled: async () => true,
      materializeTierCalendars: async (args) => { calArgs = args; return { racesInserted: 30, stageProfiles: 90, stageSchedules: 90, tiers: [] }; },
    },
  });

  assert.equal(result.ok, true);
  const calPhase = result.log.find((p) => p.phase === "season_calendar");
  assert.ok(calPhase, "season_calendar-fasen skal logges når flaget er ON");
  assert.equal(calPhase.racesInserted, 30);
  assert.ok(calArgs, "materializeTierCalendars skal kaldes");
  assert.equal(calArgs.seasonId, "00000000-0000-0000-0000-000000000001", "kalender for den NYE sæson (plan.to_season.id)");
  assert.equal(calArgs.dryRun, false, "forever-transition materialiserer med writes");
  // Rækkefølge: efter sponsor_payout, før admin_log.
  const idxPayout = result.log.findIndex((p) => p.phase === "sponsor_payout");
  const idxCal = result.log.findIndex((p) => p.phase === "season_calendar");
  const idxAdmin = result.log.findIndex((p) => p.phase === "admin_log");
  assert.ok(idxPayout < idxCal && idxCal < idxAdmin, "kalender-fasen ligger mellem sponsor_payout og admin_log");
});

test("transitionToNextSeason — auto_calendar OFF (fail-safe default): ingen kalender-fase", async () => {
  let called = false;
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    deps: {
      processSeasonStart: async () => ({ sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }),
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
      isAutoCalendarEnabled: async () => false,
      materializeTierCalendars: async () => { called = true; return {}; },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log.find((p) => p.phase === "season_calendar"), undefined, "ingen kalender-fase når flaget er OFF");
  assert.equal(called, false, "materializeTierCalendars må ikke kaldes når flaget er OFF");
});

// #805 · Board-test-exit: når afgående sæson kørte board_test_mode, nulstilles
// board-data via resetBetaBoardProfiles FØR processSeasonStart, så test-perioden
// ikke bærer økonomisk spor ind i den nye sæson.
test("transitionToNextSeason — nulstiller board-data når afgående window er i test-mode", async () => {
  const order = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08", board_test_mode: true }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    adminUserId: "admin-uuid",
    deps: {
      resetBetaBoardProfiles: async () => { order.push("reset"); return { reset: 1, created: 1 }; },
      processSeasonStart: async () => { order.push("seasonStart"); return { sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }; },
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  const resetPhase = result.log.find((p) => p.phase === "reset_board_test_data");
  assert.ok(resetPhase, "reset_board_test_data-fasen skal være kørt");
  assert.equal(resetPhase.reset, 1);
  // Reset SKAL ske før season-start (ellers anvendes ikke-nulstillede modifiers).
  assert.deepEqual(order, ["reset", "seasonStart"]);
});

test("transitionToNextSeason — springer board-reset over når window ikke er i test-mode", async () => {
  const order = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08", board_test_mode: false }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      resetBetaBoardProfiles: async () => { order.push("reset"); return { reset: 1 }; },
      processSeasonStart: async () => ({ sponsor: [], payroll: { results: [], summary: { teams_processed: 0 } } }),
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log.find((p) => p.phase === "reset_board_test_data"), undefined);
  assert.deepEqual(order, [], "resetBetaBoardProfiles må ikke kaldes uden test-mode");
});

test("transitionToNextSeason — re-run efter delvis fejl skipper allerede-gjort arbejde", async () => {
  // Simuler: sæson 1 er allerede insertet, men transfer_window mangler.
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active", start_date: "2026-05-15" },
    ],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: { processSeasonStart: async () => [], notifySeasonEvent: async () => {}, expireAndRenewContracts: async () => {} },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log[0].skipped, true);
  assert.match(result.log[0].reason, /already exists/);
  // Andre faser skal stadig køre (#2453: +global_rank_decay skubbede insert_next_transfer_window fra 3→4)
  assert.equal(result.log[4].phase, "insert_next_transfer_window");
  assert.equal(result.log[4].inserted, true);
});

test("transitionToNextSeason — fuld idempotens: re-run med alt færdig giver alle skipped", async () => {
  // Resume-support (#578): re-run med fromSeason='completed' og toSeason eksisterende
  // SKAL ikke kaste — alle faser detekterer at arbejdet er gjort og skipper. Tidligere
  // asserterede denne test at re-run kastede 'must be active', hvilket var dokumentation
  // af et faktisk reliability-gap (cron kunne ikke genoptage efter partial failure
  // efter mark_previous_completed).
  const transitionAt = "2026-05-15T06:00:00.000Z";
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed", end_date: transitionAt },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active", start_date: transitionAt },
    ],
    transfer_windows: [
      { id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "closed", created_at: "2026-05-08" },
      { id: "00000000-0000-0000-0000-00000001aaaa", season_id: "00000000-0000-0000-0000-000000000001", status: "closed", created_at: transitionAt },
    ],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
    admin_log: [{
      id: "log-1",
      action_type: "season_transition",
      meta: {
        from_season_id: "00000000-0000-0000-0000-000000000000",
        to_season_id: "00000000-0000-0000-0000-000000000001",
      },
    }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    deps: {
      processSeasonStart: async () => ({
        sponsor: [],
        payroll: {
          results: [],
          summary: {
            teams_processed: 0,
            loan_interest_count: 0, loan_interest_total: 0,
            salary_count: 0, salary_total: 0,
            emergency_loan_count: 0, emergency_loan_total: 0,
            negative_balance_interest_count: 0, negative_balance_interest_total: 0,
          },
        },
      }),
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].skipped, true, "sæson 1 eksisterer → skipped");
  assert.equal(result.log[1].phase, "mark_previous_completed");
  assert.equal(result.log[1].skipped, true, "sæson 0 allerede completed → skipped");
  // #2453: global_rank_decay-fasen indsat mellem mark_previous_completed og
  // close_prev_transfer_window — mock-supabase har intet .rpc, så fasen
  // fejler-og-fanges (additiv, må aldrig vælte transitionen).
  assert.equal(result.log[2].phase, "global_rank_decay");
  assert.equal(result.log[3].phase, "close_prev_transfer_window");
  assert.equal(result.log[3].skipped, true, "win-0 allerede closed → skipped");
  assert.equal(result.log[4].phase, "insert_next_transfer_window");
  assert.equal(result.log[4].skipped, true, "sæson 1's window eksisterer → skipped");
  const adminLog = result.log.find((p) => p.phase === "admin_log");
  assert.ok(adminLog, "admin_log-fasen skal logges");
  assert.equal(adminLog.skipped, true, "admin_log-entry eksisterer → skipped");
  // Discord broadcaster altid (fire-and-forget, bruger har godkendt 1 ekstra besked)
  assert.ok(result.log.find((p) => p.phase === "discord_broadcast"));
});

test("transitionToNextSeason — resume efter partial failure efter mark_previous_completed (#578)", async () => {
  // Reliability-gap: simuler at fase 3 (mark_previous_completed) gik igennem,
  // men fase 4-7 fejlede. fromSeason er 'completed', toSeason er 'active',
  // men win-0 er stadig 'open', sæson 1's transfer_window mangler, og admin_log
  // har ingen entry. Cron skal kunne re-køre og afslutte de manglende faser
  // uden manuel SQL-intervention.
  const transitionAt = "2026-05-15T06:00:00.000Z";
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed", end_date: transitionAt },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active", start_date: transitionAt },
    ],
    transfer_windows: [
      { id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" },
    ],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date(transitionAt),
    deps: {
      processSeasonStart: async () => ({
        sponsor: [],
        payroll: {
          results: [],
          summary: {
            teams_processed: 0,
            loan_interest_count: 0, loan_interest_total: 0,
            salary_count: 0, salary_total: 0,
            emergency_loan_count: 0, emergency_loan_total: 0,
            negative_balance_interest_count: 0, negative_balance_interest_total: 0,
          },
        },
      }),
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].skipped, true, "sæson 1 var allerede insertet");
  assert.equal(result.log[1].phase, "mark_previous_completed");
  assert.equal(result.log[1].skipped, true, "sæson 0 var allerede completed (resume-scenariet)");
  assert.equal(result.log[2].phase, "global_rank_decay");
  assert.equal(result.log[3].phase, "close_prev_transfer_window");
  assert.equal(result.log[3].updated, true, "win-0 var 'open' → lukkes nu (fase 4 fejlede tidligere)");
  assert.equal(result.log[4].phase, "insert_next_transfer_window");
  assert.equal(result.log[4].inserted, true, "sæson 1's window manglede → oprettet nu");
  const adminLogResume = result.log.find((p) => p.phase === "admin_log");
  assert.ok(adminLogResume, "admin_log-fasen skal logges");
  assert.equal(adminLogResume.inserted, true, "admin_log-entry manglede → oprettet nu");

  const sæson0 = supabase.__state.seasons.find((s) => s.number === 0);
  assert.equal(sæson0.status, "completed", "sæson 0 forbliver completed");

  const sæson1Window = supabase.__state.transfer_windows.find(
    (w) => w.id === "00000000-0000-0000-0000-00000001aaaa"
  );
  assert.ok(sæson1Window, "sæson 1's transfer_window blev oprettet ved resume");
  assert.equal(sæson1Window.status, "closed");
});

test("buildTransitionPlan — completed UDEN toSeason kaster stadig (faktisk fejl, ikke resume)", async () => {
  // Resume-support skal kun aktiveres når toSeason eksisterer. En lone 'completed'
  // fromSeason uden toSeason er sandsynligvis manuel DB-corruption eller en
  // anden bug — operatør skal undersøge, ikke blindly retry.
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed", end_date: "2026-05-15" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  await assert.rejects(
    () => buildTransitionPlan({ supabase, fromSeasonId: "00000000-0000-0000-0000-000000000000" }),
    /must be 'active' or 'completed' with existing next season/
  );
});

// ─── resolveTransitionSourceSeason (#1166 — endpoint-resume) ──────────────────

test("resolveTransitionSourceSeason — returnerer nyeste aktive sæson når en findes", async () => {
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "active" },
    ],
  });
  const season = await resolveTransitionSourceSeason({ supabase });
  assert.equal(season.number, 1);
  assert.equal(season.status, "active");
});

test("resolveTransitionSourceSeason — falder tilbage til seneste completed når ingen active (post season-end)", async () => {
  // #1166-scenariet: season-end er kørt FØR transition (korrekt rækkefølge),
  // så sæson 1 er 'completed' og sæson 2 'upcoming' — ingen 'active' findes.
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "completed" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "completed" },
      { id: "00000000-0000-0000-0000-000000000002", number: 2, status: "upcoming" },
    ],
  });
  const season = await resolveTransitionSourceSeason({ supabase });
  assert.equal(season.number, 1, "seneste completed sæson (ikke sæson 0, ikke upcoming sæson 2)");
  assert.equal(season.id, "00000000-0000-0000-0000-000000000001");
});

test("resolveTransitionSourceSeason — returnerer null når hverken active eller completed findes", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000002", number: 2, status: "upcoming" }],
  });
  assert.equal(await resolveTransitionSourceSeason({ supabase }), null);
});

test("resolveTransitionSourceSeason → transitionToNextSeason — fuld resume fra completed sæson (#1166)", async () => {
  // End-to-end for admin-knappens flow efter season-end: resolveren finder
  // den completed sæson 1, engine'ns resume-sti (#578) accepterer den fordi
  // sæson 2 eksisterer, og 'upcoming' promoveres til 'active'.
  const transitionAt = "2026-06-09T06:00:00.000Z";
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "completed", end_date: transitionAt },
      { id: "00000000-0000-0000-0000-000000000002", number: 2, status: "upcoming", start_date: null },
    ],
    transfer_windows: [
      { id: "win-1", season_id: "00000000-0000-0000-0000-000000000001", status: "open", created_at: "2026-05-20" },
    ],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const fromSeason = await resolveTransitionSourceSeason({ supabase });
  assert.equal(fromSeason.number, 1);

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: fromSeason.id,
    transitionAt: new Date(transitionAt),
    deps: {
      processSeasonStart: async () => ({ sponsor: [], payroll: null }),
      notifySeasonEvent: async () => {},
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].updated, true, "sæson 2 promoveres upcoming → active");
  assert.equal(result.log[1].phase, "mark_previous_completed");
  assert.equal(result.log[1].skipped, true, "sæson 1 var allerede completed via season-end");

  const sæson2 = supabase.__state.seasons.find((s) => s.number === 2);
  assert.equal(sæson2.status, "active");
  const sæson1Window = supabase.__state.transfer_windows.find((w) => w.id === "win-1");
  assert.equal(sæson1Window.status, "closed", "sæson 1's window lukkes ved resume");
});

test("resolveTransitionSourceSeason — kaster uden supabase-client", async () => {
  await assert.rejects(() => resolveTransitionSourceSeason({}), /Supabase client required/);
});

test("transitionToNextSeason — kaster fejl hvis fromSeasonId mangler", async () => {
  const supabase = createMockSupabase({});
  await assert.rejects(
    () => transitionToNextSeason({ supabase }),
    /fromSeasonId required/
  );
});

test("transitionToNextSeason — promoterer pre-created sæson 1 fra 'upcoming' til 'active'", async () => {
  // Realistic 2026-05-21 setup: sæson 1 er allerede oprettet via legacy
  // POST /admin/seasons med status='upcoming' (race-katalog seedet). Engine
  // skal aktivere den i stedet for at skip den.
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active", start_date: "2026-05-08" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "upcoming", start_date: null, end_date: null },
    ],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-21T21:00:00Z"),
    deps: { processSeasonStart: async () => [], notifySeasonEvent: async () => {}, expireAndRenewContracts: async () => {} },
  });

  // Fase 1 skal nu rapportere updated=true (ikke skipped, ikke inserted)
  assert.equal(result.log[0].phase, "insert_next_season");
  assert.equal(result.log[0].updated, true, "skal promotere upcoming → active");
  assert.match(result.log[0].reason, /promoted upcoming/);

  const sæson1 = supabase.__state.seasons.find((s) => s.number === 1);
  assert.equal(sæson1.status, "active");
  assert.equal(sæson1.start_date, "2026-05-21T21:00:00.000Z");

  // Sæson 0 skal stadig markeres completed
  const sæson0 = supabase.__state.seasons.find((s) => s.number === 0);
  assert.equal(sæson0.status, "completed");
});

test("transitionToNextSeason — bevarer eksisterende start_date hvis sæson 1 allerede har en", async () => {
  // Edge: admin har sat start_date manuelt via legacy endpoint. Engine må ikke
  // overskrive den.
  const supabase = createMockSupabase({
    seasons: [
      { id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" },
      { id: "00000000-0000-0000-0000-000000000001", number: 1, status: "upcoming", start_date: "2026-05-20" },
    ],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-21T21:00:00Z"),
    deps: { processSeasonStart: async () => [], notifySeasonEvent: async () => {}, expireAndRenewContracts: async () => {} },
  });

  const sæson1 = supabase.__state.seasons.find((s) => s.number === 1);
  assert.equal(sæson1.start_date, "2026-05-20", "bevarer admin-sat start_date");
});

test("transitionToNextSeason — Discord-broadcast: notifySeasonEvent kaldes nøjagtigt 1 gang per transition", async () => {
  // Pre-incident 2026-05-21 var cron-fyrede transitions silent — bruger spotted
  // først loopen efter 30 min. Discord-broadcast er nu en phase i engine'n så
  // både cron + /admin/season-transition broadcaster ens.
  const notifyCalls = [];
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    transitionAt: new Date("2026-05-15T06:00:00Z"),
    deps: {
      processSeasonStart: async () => [],
      notifySeasonEvent: async (payload) => { notifyCalls.push(payload); },
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(notifyCalls.length, 1, "notifySeasonEvent skal kaldes nøjagtigt 1 gang");
  assert.equal(notifyCalls[0].type, "season_started");
  assert.equal(notifyCalls[0].seasonNumber, 1);
  const broadcastLog = result.log.find((entry) => entry.phase === "discord_broadcast");
  assert.ok(broadcastLog, "discord_broadcast phase skal logges");
  assert.equal(broadcastLog.sent, true);
});

test("transitionToNextSeason — Discord-broadcast: webhook-fejl må aldrig blokere transition", async () => {
  // Discord-webhook kan fejle (5xx, rate-limit, netværk). Engine'n skal stadig
  // returnere ok: true så cron'en kan markere transition fuldført.
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  const result = await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    deps: {
      processSeasonStart: async () => [],
      notifySeasonEvent: async () => { throw new Error("Discord 503"); },
      expireAndRenewContracts: async () => {},
    },
  });

  assert.equal(result.ok, true);
  const broadcastLog = result.log.find((entry) => entry.phase === "discord_broadcast");
  assert.equal(broadcastLog.sent, false);
  assert.match(broadcastLog.error, /Discord 503/);
});

test("transitionToNextSeason — sæson 1's transfer_window oprettes som 'closed' (ikke open)", async () => {
  const supabase = createMockSupabase({
    seasons: [{ id: "00000000-0000-0000-0000-000000000000", number: 0, status: "active" }],
    transfer_windows: [{ id: "win-0", season_id: "00000000-0000-0000-0000-000000000000", status: "open", created_at: "2026-05-08" }],
    teams: [{ id: "t1", name: "T1", sponsor_income: 240000, division: 3, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false }],
  });

  await transitionToNextSeason({
    supabase,
    fromSeasonId: "00000000-0000-0000-0000-000000000000",
    deps: { processSeasonStart: async () => [], notifySeasonEvent: async () => {}, expireAndRenewContracts: async () => {} },
  });

  const sæson1Window = supabase.__state.transfer_windows.find(
    (w) => w.season_id === "00000000-0000-0000-0000-000000000001"
  );
  assert.ok(sæson1Window, "Sæson 1's transfer_window skal oprettes");
  assert.equal(sæson1Window.status, "closed", "Racing-sæson har lukket transfervindue");
});

// ─── #532 — exported transfer-window helpers (manual admin flow) ─────────────
//
// Disse helpers var tidligere private til transitionToNextSeason. De er
// eksporteret som del af #532 så `POST /admin/seasons/:id/start` kan opnå samme
// transfer_window-plumbing som engine-flowet. Unit-tests her verificerer at
// helperne fungerer korrekt når de kaldes standalone fra api.js.

test("closePrevTransferWindow — lukker eksisterende open window for prev season", async () => {
  const supabase = createMockSupabase({
    transfer_windows: [
      { id: "win-prev", season_id: "season-prev", status: "open", created_at: "2026-05-01T00:00:00Z" },
    ],
  });

  const result = await closePrevTransferWindow(supabase, "season-prev", "2026-05-26T00:00:00Z");

  assert.equal(result.updated, true);
  assert.equal(result.window_id, "win-prev");
  const updated = supabase.__state.transfer_windows.find((w) => w.id === "win-prev");
  assert.equal(updated.status, "closed");
  assert.equal(updated.closed_at, "2026-05-26T00:00:00Z");
});

test("closePrevTransferWindow — idempotent: skipper hvis window allerede lukket", async () => {
  const supabase = createMockSupabase({
    transfer_windows: [
      { id: "win-prev", season_id: "season-prev", status: "closed", created_at: "2026-05-01T00:00:00Z" },
    ],
  });

  const result = await closePrevTransferWindow(supabase, "season-prev", "2026-05-26T00:00:00Z");

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already closed");
  assert.equal(result.window_id, "win-prev");
});

test("closePrevTransferWindow — skipper hvis intet window findes (e.g. sæson 0 først)", async () => {
  const supabase = createMockSupabase({ transfer_windows: [] });

  const result = await closePrevTransferWindow(supabase, "season-prev", "2026-05-26T00:00:00Z");

  assert.equal(result.skipped, true);
  assert.match(result.reason, /no transfer_window/);
});

test("insertTransferWindowIfMissing — opretter nyt closed window når ikke til stede", async () => {
  const supabase = createMockSupabase({ transfer_windows: [] });

  const result = await insertTransferWindowIfMissing(
    supabase,
    "00000000-0000-0000-0000-00000002aaaa",
    "season-2",
    "2026-05-26T00:00:00Z",
  );

  assert.equal(result.inserted, true);
  assert.equal(result.window_id, "00000000-0000-0000-0000-00000002aaaa");
  const inserted = supabase.__state.transfer_windows[0];
  assert.equal(inserted.id, "00000000-0000-0000-0000-00000002aaaa");
  assert.equal(inserted.season_id, "season-2");
  assert.equal(inserted.status, "closed", "Racing-sæson har lukket window from start");
  assert.equal(inserted.created_at, "2026-05-26T00:00:00Z");
});

test("insertTransferWindowIfMissing — idempotent: skipper hvis window allerede eksisterer", async () => {
  const supabase = createMockSupabase({
    transfer_windows: [
      { id: "00000000-0000-0000-0000-00000002aaaa", season_id: "season-2", status: "open", created_at: "2026-05-26T00:00:00Z" },
    ],
  });

  const result = await insertTransferWindowIfMissing(
    supabase,
    "00000000-0000-0000-0000-00000002aaaa",
    "season-2",
    "2026-05-27T00:00:00Z",
  );

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "window already exists");
  assert.equal(result.status, "open", "rapporterer eksisterende status så caller kan reagere");
  assert.equal(supabase.__state.transfer_windows.length, 1, "ingen ny row indsat");
});

test("insertTransferWindowIfMissing — manual flow på sæson 1 matcher engine's deterministiske UUID", async () => {
  const supabase = createMockSupabase({ transfer_windows: [] });

  // Simulér api.js manual flow: kalder helperen med computeTransferWindowUuid(1)
  await insertTransferWindowIfMissing(
    supabase,
    computeTransferWindowUuid(1),
    "00000000-0000-0000-0000-000000000001",
    "2026-05-26T00:00:00Z",
  );

  const window = supabase.__state.transfer_windows[0];
  assert.equal(window.id, "00000000-0000-0000-0000-00000001aaaa", "matcher engine's UUID-mønster");
});


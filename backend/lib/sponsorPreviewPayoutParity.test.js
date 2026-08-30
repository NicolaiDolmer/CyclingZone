// #2753 · Preview = faktisk payout
// ================================
// buildTransitionPlan's sponsor-preview viste den rå garanterede base, mens
// processSeasonStart udbetalte base × board-modifier × pullout (cappet af
// kontraktloftet). Ejeren planlagde dermed sæsonskiftet på et tal der ikke holdt.
//
// Denne test kører BEGGE stier mod SAMME in-memory-database - et hold med både
// en board-modifier (0.9) og en aktiv sponsor-pullout (0.8) - og kræver at
// preview-tallet er identisk med det beløb der faktisk krediteres holdet.
// Regressions-ankeret: den garanterede base er bevidst FORSKELLIG fra payouten,
// så en tilbagerulning til gross-tallet får testen til at fejle.

import test from "node:test";
import assert from "node:assert/strict";

import { buildTransitionPlan } from "./seasonTransition.js";
import { processSeasonStart } from "./economyEngine.js";
import { MAX_BOARD_MODIFIER } from "./economyConstants.js";

const FROM_SEASON_ID = "00000000-0000-0000-0000-000000000001";
const TO_SEASON_ID = "00000000-0000-0000-0000-000000000002";
const TEAM_ID = "team-parity";

const BOARD_MODIFIER = 0.9;
const PULLOUT_SEVERITY = 800; // → pullout-faktor 0.8
const GUARANTEED_BASE = 400_000;

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Én in-memory database begge motorer læser fra. Bevidst generisk (ingen
 * kolonne-asserts), fordi pointen er at preview og udbetaling ser PRÆCIS samme
 * rækker - ikke at spejle PostgREST i detaljer.
 */
function createSharedSupabase() {
  const state = {
    seasons: [
      { id: FROM_SEASON_ID, number: 1, status: "active", start_date: "2026-01-01", end_date: null },
      { id: TO_SEASON_ID, number: 2, status: "active", start_date: "2026-02-01", end_date: null },
    ],
    season_standings: [],
    teams: [
      {
        id: TEAM_ID,
        name: "Parity CF",
        user_id: null,
        is_ai: false,
        is_bank: false,
        is_frozen: false,
        is_test_account: false,
        division: 2,
        balance: 1_000_000,
        sponsor_income: GUARANTEED_BASE,
        board_profiles: [
          {
            id: "board-parity",
            team_id: TEAM_ID,
            plan_type: "1yr",
            negotiation_status: "completed",
            budget_modifier: BOARD_MODIFIER,
          },
        ],
      },
    ],
    sponsor_contracts: [
      {
        id: "contract-parity",
        team_id: TEAM_ID,
        status: "active",
        sponsor_name: "Parity Sponsor",
        guaranteed_base: GUARANTEED_BASE,
        per_race_day_rate: 1_000,
        length_seasons: 3,
        start_season: 1,
        // Låst hen over sæson 2 → begge stier bruger nøjagtig denne kontrakt.
        expires_after_season: 3,
        variant: "balanced",
        guaranteed_fraction: 0.7,
        race_day_share: 0.3,
        bonus_clauses: [],
      },
    ],
    // Lag 5 sponsor-pullout, aktiv ved skiftet.
    board_consequences: [
      {
        id: "consequence-parity",
        team_id: TEAM_ID,
        layer: 5,
        status: "active",
        severity: PULLOUT_SEVERITY,
      },
    ],
    transfer_windows: [{ id: "window-1", created_at: "2026-01-01", board_test_mode: false }],
    board_profiles: [],
    notifications: [],
    admin_log: [],
  };
  const financeRows = [];

  function rowsFor(table, filters) {
    return (state[table] || []).filter((row) =>
      Object.entries(filters).every(([column, value]) => row[column] === value)
    );
  }

  function query(table, { filters = {}, range = null, updatePayload = null } = {}) {
    const next = (patch) => query(table, { filters, range, updatePayload, ...patch });
    return {
      select: () => next({}),
      eq: (column, value) => next({ filters: { ...filters, [column]: value } }),
      is: (column, value) => next({ filters: { ...filters, [column]: value } }),
      order: () => next({}),
      limit: () => next({}),
      gte: () => next({}),
      range: (from, to) => next({ range: { from, to } }),
      maybeSingle: async () => ({ data: clone(rowsFor(table, filters)[0]) ?? null, error: null }),
      single: async () => ({ data: clone(rowsFor(table, filters)[0]) ?? null, error: null }),
      then(resolve) {
        if (updatePayload) {
          for (const row of rowsFor(table, filters)) Object.assign(row, updatePayload);
          return resolve({ data: null, error: null });
        }
        const rows = rowsFor(table, filters);
        const windowed = range ? rows.slice(range.from, range.to + 1) : rows;
        return resolve({ data: clone(windowed), error: null });
      },
    };
  }

  return {
    __state: state,
    __financeRows: financeRows,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ ...params.p_finance_payload, team_id: params.p_team_id });
      const team = state.teams.find((t) => t.id === params.p_team_id);
      return Promise.resolve({ data: (team?.balance ?? 0) + params.p_delta, error: null });
    },
    from(table) {
      return {
        select: () => query(table),
        update: (payload) => query(table, { updatePayload: payload }),
        insert(payload) {
          const rows = Array.isArray(payload) ? payload : [payload];
          state[table] = state[table] || [];
          for (const row of rows) state[table].push({ ...row });
          return {
            select: () => ({ single: async () => ({ data: rows[0], error: null }) }),
            then: (resolve) => resolve({ data: null, error: null }),
          };
        },
      };
    },
  };
}

test("#2753: transition-previewets sponsor-tal er identisk med den faktiske payout (board-modifier + pullout)", async () => {
  const supabase = createSharedSupabase();

  // 1) Previewet ejeren ser FØR han trykker "kør sæsonskifte".
  const plan = await buildTransitionPlan({ supabase, fromSeasonId: FROM_SEASON_ID });
  const previewRow = plan.sponsor_breakdown.find((row) => row.team_id === TEAM_ID);
  assert.ok(previewRow, "Holdet mangler i sponsor-previewet");

  // 2) Den faktiske udbetaling ved sæson-start (samme database).
  await processSeasonStart(TO_SEASON_ID, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
    developRidersForSeason: async () => ({ developed: 0, grew: 0, declined: 0, retired: 0 }),
  });
  const sponsorRow = supabase.__financeRows.find((row) => row.type === "sponsor");
  assert.ok(sponsorRow, "Ingen sponsor-kreditering fundet");

  const expectedPayout = Math.round(
    GUARANTEED_BASE * BOARD_MODIFIER * (PULLOUT_SEVERITY / 1000)
  );
  assert.equal(sponsorRow.amount, expectedPayout, "Udbetalingen ændrede sig uventet");

  // Kernen i #2753: preview == faktisk payout, både pr. hold og i totalen.
  assert.equal(
    previewRow.sponsor_payout,
    sponsorRow.amount,
    `Preview (${previewRow.sponsor_payout}) skal matche den faktiske payout (${sponsorRow.amount})`
  );
  assert.equal(plan.sponsor_payout_total, sponsorRow.amount);

  // Regressions-anker: den garanterede base er ET ANDET tal. Ruller previewet
  // tilbage til gross_sponsor, fejler assertionen ovenfor.
  assert.equal(previewRow.sponsor_base, GUARANTEED_BASE);
  assert.notEqual(previewRow.sponsor_base, sponsorRow.amount);
  assert.equal(plan.sponsor_base_total, GUARANTEED_BASE);

  // Previewet forklarer HVORFOR tallet er lavere end basen.
  assert.equal(previewRow.sponsor_board_modifier, BOARD_MODIFIER);
  assert.equal(previewRow.sponsor_pullout_factor, PULLOUT_SEVERITY / 1000);
  assert.equal(previewRow.sponsor_modifier, BOARD_MODIFIER * (PULLOUT_SEVERITY / 1000));
  assert.equal(previewRow.sponsor_payout_ceiling, Math.round(GUARANTEED_BASE * MAX_BOARD_MODIFIER));
  assert.equal(previewRow.sponsor_payout_capped, false);
  assert.equal(plan.sponsor_board_test_mode, false);
});

test("#2753: previewet respekterer kontraktloftet præcis som udbetalingen gør", async () => {
  const supabase = createSharedSupabase();
  // Board-modifier over loftet (1.5 > MAX_BOARD_MODIFIER 1.20) og ingen pullout:
  // begge stier skal lande på round(guaranteed_base × MAX_BOARD_MODIFIER).
  supabase.__state.teams[0].board_profiles[0].budget_modifier = 1.5;
  supabase.__state.board_consequences = [];

  const plan = await buildTransitionPlan({ supabase, fromSeasonId: FROM_SEASON_ID });
  const previewRow = plan.sponsor_breakdown.find((row) => row.team_id === TEAM_ID);

  await processSeasonStart(TO_SEASON_ID, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
    developRidersForSeason: async () => ({ developed: 0, grew: 0, declined: 0, retired: 0 }),
  });
  const sponsorRow = supabase.__financeRows.find((row) => row.type === "sponsor");

  const expectedCeiling = Math.round(GUARANTEED_BASE * MAX_BOARD_MODIFIER);
  assert.equal(sponsorRow.amount, expectedCeiling);
  assert.equal(previewRow.sponsor_payout, sponsorRow.amount);
  assert.equal(previewRow.sponsor_payout_capped, true);
});

test("#2753: board test-mode neutraliserer previewet på samme måde som udbetalingen", async () => {
  const supabase = createSharedSupabase();
  supabase.__state.transfer_windows[0].board_test_mode = true;

  const plan = await buildTransitionPlan({ supabase, fromSeasonId: FROM_SEASON_ID });
  const previewRow = plan.sponsor_breakdown.find((row) => row.team_id === TEAM_ID);

  await processSeasonStart(TO_SEASON_ID, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
    developRidersForSeason: async () => ({ developed: 0, grew: 0, declined: 0, retired: 0 }),
  });
  const sponsorRow = supabase.__financeRows.find((row) => row.type === "sponsor");

  // Test-mode → modifier 1.0, altså den fulde garanterede base i BEGGE ender.
  assert.equal(sponsorRow.amount, GUARANTEED_BASE);
  assert.equal(previewRow.sponsor_payout, sponsorRow.amount);
  assert.equal(previewRow.sponsor_modifier, 1.0);
  assert.equal(plan.sponsor_board_test_mode, true);
});

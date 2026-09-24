// #4592 · Sæsonskifte-previewet = faktisk udbetaling, også med et parkeret hold
// ==========================================================================
// processSeasonStart springer parkerede hold over i sponsor-loopet. Previewet
// (buildTransitionPlan) regnede før sponsor for ALLE menneskehold, så ejerens
// bekræftelses-dialog og admin_log-posten (meta.sponsor_payout_total) viste en
// for høj udbetaling, og teams_affected passede ikke med sponsor_payout.count.
//
// Testen kører BEGGE stier mod SAMME in-memory-database med Hold A (aktivt) og
// Hold P (parkeret) og kræver at previewets total, holdantal og parkerings-
// antal er præcis det udbetalingen gør. Kontrollen kører samme database med
// Hold P aktivt, så testen ikke kan bestå ved at previewet altid viser ét hold.
//
// Mocken respekterer kolonnelisten i teams-selecten. Uden det ville en select
// der glemmer parked_at se ud som om alle hold var aktive, og testen ville
// stadig være grøn (isParkedTeam tæller et manglende felt som ikke parkeret).

import test from "node:test";
import assert from "node:assert/strict";

import { buildTransitionPlan } from "./seasonTransition.js";
import { processSeasonStart } from "./economyEngine.js";

const FROM_SEASON_ID = "00000000-0000-0000-0000-000000000001";
const TO_SEASON_ID = "00000000-0000-0000-0000-000000000002";
const TEAM_A = "team-a";
const TEAM_P = "team-p";
const PARKED_AT = "2026-09-20T10:00:00.000Z";

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** Top-niveau-kolonner i en PostgREST-select ("a, b, rel(x, y)" → [a, b, rel]). */
function topLevelColumns(columns) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of String(columns ?? "*")) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((col) => col.trim().split("(")[0].trim()).filter(Boolean);
}

function project(table, row, columns) {
  if (table !== "teams") return row;
  const cols = topLevelColumns(columns);
  if (cols.includes("*")) return row;
  return Object.fromEntries(cols.filter((col) => col in row).map((col) => [col, row[col]]));
}

function team(id, name, { parked }) {
  return {
    id,
    name,
    user_id: null,
    is_ai: false,
    is_bank: false,
    is_frozen: false,
    is_test_account: false,
    parked_at: parked ? PARKED_AT : null,
    division: 2,
    balance: 1_000_000,
    sponsor_income: 400_000,
    board_profiles: [
      {
        id: `board-${id}`,
        team_id: id,
        plan_type: "1yr",
        negotiation_status: "completed",
        budget_modifier: 1.0,
      },
    ],
  };
}

function contract(teamId, guaranteedBase) {
  return {
    id: `contract-${teamId}`,
    team_id: teamId,
    status: "active",
    sponsor_name: `Sponsor ${teamId}`,
    guaranteed_base: guaranteedBase,
    per_race_day_rate: 1_000,
    length_seasons: 3,
    start_season: 1,
    // Låst hen over sæson 2 → preview og udbetaling bruger samme kontrakt.
    expires_after_season: 3,
    variant: "balanced",
    guaranteed_fraction: 0.7,
    race_day_share: 0.3,
    bonus_clauses: [],
  };
}

/** Én in-memory database begge stier læser fra (samme mønster som sponsorPreviewPayoutParity.test.js). */
function createSharedSupabase({ parkP }) {
  const state = {
    seasons: [
      { id: FROM_SEASON_ID, number: 1, status: "active", start_date: "2026-01-01", end_date: null },
      { id: TO_SEASON_ID, number: 2, status: "active", start_date: "2026-02-01", end_date: null },
    ],
    season_standings: [],
    teams: [team(TEAM_A, "Hold A", { parked: false }), team(TEAM_P, "Hold P", { parked: parkP })],
    // Forskellige baser, så en total der tæller Hold P med, altid er et andet tal.
    sponsor_contracts: [contract(TEAM_A, 400_000), contract(TEAM_P, 300_000)],
    board_consequences: [],
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

  function query(table, { columns = "*", filters = {}, range = null, updatePayload = null } = {}) {
    const next = (patch) => query(table, { columns, filters, range, updatePayload, ...patch });
    const read = (rows) => rows.map((row) => project(table, clone(row), columns));
    return {
      select: () => next({}),
      eq: (column, value) => next({ filters: { ...filters, [column]: value } }),
      is: (column, value) => next({ filters: { ...filters, [column]: value } }),
      order: () => next({}),
      limit: () => next({}),
      gte: () => next({}),
      range: (from, to) => next({ range: { from, to } }),
      maybeSingle: async () => ({ data: read(rowsFor(table, filters))[0] ?? null, error: null }),
      single: async () => ({ data: read(rowsFor(table, filters))[0] ?? null, error: null }),
      then(resolve) {
        if (updatePayload) {
          for (const row of rowsFor(table, filters)) Object.assign(row, updatePayload);
          return resolve({ data: null, error: null });
        }
        const rows = rowsFor(table, filters);
        const windowed = range ? rows.slice(range.from, range.to + 1) : rows;
        return resolve({ data: read(windowed), error: null });
      },
    };
  }

  return {
    __state: state,
    __financeRows: financeRows,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      financeRows.push({ ...params.p_finance_payload, team_id: params.p_team_id });
      const row = state.teams.find((t) => t.id === params.p_team_id);
      return Promise.resolve({ data: (row?.balance ?? 0) + params.p_delta, error: null });
    },
    from(table) {
      return {
        select: (columns) => query(table, { columns }),
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

async function runPreviewAndPayout({ parkP }) {
  const supabase = createSharedSupabase({ parkP });
  // 1) Previewet ejeren ser FØR han trykker "kør sæsonskifte".
  const plan = await buildTransitionPlan({ supabase, fromSeasonId: FROM_SEASON_ID });
  // 2) Den faktiske udbetaling ved sæson-start (samme database).
  const seasonStart = await processSeasonStart(TO_SEASON_ID, {
    supabase,
    runSeasonPayroll: async () => ({ results: [], summary: {} }),
    developRidersForSeason: async () => ({ developed: 0, grew: 0, declined: 0, retired: 0 }),
  });
  const sponsorRows = supabase.__financeRows.filter((row) => row.type === "sponsor");
  const paidTotal = sponsorRows.reduce((sum, row) => sum + row.amount, 0);
  return { plan, seasonStart, sponsorRows, paidTotal };
}

test("#4592: previewet springer et parkeret hold over præcis som udbetalingen, total og antal matcher", async () => {
  const { plan, seasonStart, sponsorRows, paidTotal } = await runPreviewAndPayout({ parkP: true });

  // Udbetalingen: kun Hold A får sponsor, Hold P tælles som parkeret.
  assert.deepEqual(sponsorRows.map((row) => row.team_id), [TEAM_A]);
  assert.equal(seasonStart.parked.count, 1);

  // Kernen: previewet siger det samme som udbetalingen.
  assert.equal(plan.sponsor_payout_total, paidTotal, "previewets total skal være det der faktisk udbetales");
  assert.equal(plan.teams_affected, seasonStart.sponsor.length, "teams_affected skal matche sponsor_payout.count");
  assert.equal(plan.teams_parked, seasonStart.parked.count);
  assert.deepEqual(plan.sponsor_breakdown.map((row) => row.team_id), [TEAM_A]);

  // Hold P's garanterede base er heller ikke med i reference-tallet.
  const rowA = plan.sponsor_breakdown[0];
  assert.equal(plan.sponsor_base_total, rowA.sponsor_base);
  assert.equal(plan.sponsor_contract_sources.locked, 1);
});

test("#4592: kontrol med Hold P aktivt, begge hold i previewet og totalen matcher stadig", async () => {
  const { plan, seasonStart, sponsorRows, paidTotal } = await runPreviewAndPayout({ parkP: false });

  assert.deepEqual(sponsorRows.map((row) => row.team_id).sort(), [TEAM_A, TEAM_P]);
  assert.equal(seasonStart.parked.count, 0);

  assert.equal(plan.sponsor_payout_total, paidTotal);
  assert.equal(plan.teams_affected, 2);
  assert.equal(plan.teams_parked, 0);
});

test("#4592: det parkerede hold flytter previewets total med præcis sin egen sponsor", async () => {
  const parked = await runPreviewAndPayout({ parkP: true });
  const active = await runPreviewAndPayout({ parkP: false });

  const paidToP = active.sponsorRows.find((row) => row.team_id === TEAM_P).amount;
  assert.ok(paidToP > 0);
  assert.equal(active.plan.sponsor_payout_total - parked.plan.sponsor_payout_total, paidToP);
});

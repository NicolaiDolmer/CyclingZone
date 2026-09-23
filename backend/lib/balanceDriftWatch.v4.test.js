import test from "node:test";
import assert from "node:assert/strict";

import { runBalanceDriftWatch } from "./balanceDriftWatch.js";

// Golden-capture (midlertidig): koeres mod koden FOER #5516 for at fastlaase
// v3-vagtens persisterede raekke + alarmtekst byte for byte.

const TARGET_DATE = "2026-09-10";
const NOW = new Date("2026-09-11T02:00:00.000Z");
const DAY_TS = "2026-09-10T12:00:00.000Z";

function makeTableStub(tables) {
  const upserts = [];
  const selects = [];
  function query(table) {
    const filters = [];
    let orderCol = null;
    let ascending = true;
    let limitN = null;
    let rangeFrom = null;
    let rangeTo = null;
    const run = () => {
      let rows = (tables[table] || []).filter((row) => filters.every((f) => f(row)));
      if (orderCol) {
        rows = [...rows].sort((a, b) => {
          const x = a[orderCol];
          const y = b[orderCol];
          const c = x < y ? -1 : x > y ? 1 : 0;
          return ascending ? c : -c;
        });
      }
      if (rangeFrom != null) rows = rows.slice(rangeFrom, rangeTo + 1);
      if (limitN != null) rows = rows.slice(0, limitN);
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const q = {
      select: () => q,
      eq: (c, v) => { filters.push((r) => r[c] === v); return q; },
      in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return q; },
      gte: (c, v) => { filters.push((r) => r[c] >= v); return q; },
      lt: (c, v) => { filters.push((r) => r[c] < v); return q; },
      gt: (c, v) => { filters.push((r) => r[c] > v); return q; },
      order: (c, opts) => { orderCol = c; ascending = opts?.ascending !== false; return q; },
      limit: (n) => { limitN = n; return q; },
      range: (f, t) => { rangeFrom = f; rangeTo = t; return q; },
      maybeSingle: () => {
        const { data } = run();
        return Promise.resolve({ data: data[0] ?? null, error: null });
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  }
  return {
    selects,
    upserts,
    from(table) {
      return {
        select: (...args) => {
          selects.push(table);
          return query(table).select(...args);
        },
        upsert: (row, opts) => {
          upserts.push({ table, row, opts });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

// ── v3-fixture (engine_version=2) ────────────────────────────────────────────
function v3Fixture() {
  const runs = [
    { id: "run-a1", race_id: "race-a", stage_number: 1, engine_version: 2, created_at: DAY_TS,
      entrant_snapshot: Array.from({ length: 12 }, (_, i) => `a${String(i + 1).padStart(2, "0")}`) },
    { id: "run-b1", race_id: "race-b", stage_number: 1, engine_version: 2, created_at: DAY_TS,
      entrant_snapshot: Array.from({ length: 10 }, (_, i) => `b${String(i + 1).padStart(2, "0")}`) },
  ];
  const scores = [];
  const results = [];
  let resultSeq = 0;
  // race-a: a01 er favorit (hoejeste terrain) og vinder. a01-a04 paa samme hold.
  for (let i = 1; i <= 11; i++) {
    const rider = `a${String(i).padStart(2, "0")}`;
    scores.push({ run_id: "run-a1", rider_id: rider, rank: i,
      components: { terrain: i === 1 ? 90 : 50 - i, ...(i === 5 ? { jour_sans: -2 } : {}) } });
    results.push({ id: `res-${String(++resultSeq).padStart(4, "0")}`, race_id: "race-a", stage_number: 1,
      result_type: "stage", rider_id: rider, team_id: i <= 4 ? "team-1" : `team-a${i}`, rank: i,
      in_breakaway: false, imported_at: DAY_TS });
  }
  // race-b: b01 er favorit men bliver nr. 2; vinderen kom fra udbruddet.
  for (let i = 1; i <= 10; i++) {
    const rider = `b${String(i).padStart(2, "0")}`;
    const rank = i === 1 ? 2 : i === 2 ? 1 : i;
    scores.push({ run_id: "run-b1", rider_id: rider, rank, components: { terrain: i === 1 ? 88 : 40 - i } });
    results.push({ id: `res-${String(++resultSeq).padStart(4, "0")}`, race_id: "race-b", stage_number: 1,
      result_type: "stage", rider_id: rider, team_id: `team-b${i}`, rank,
      in_breakaway: rank === 1, imported_at: DAY_TS });
  }
  return {
    race_simulation_runs: runs,
    race_simulation_rider_scores: scores,
    race_results: results,
    races: [
      { id: "race-a", league_division_id: "div-1" },
      { id: "race-b", league_division_id: "div-3" },
    ],
    league_divisions: [
      { id: "div-1", tier: 1 },
      { id: "div-3", tier: 3 },
    ],
    race_incidents: [
      { id: "inc-0001", race_id: "race-a", stage_number: 1, rider_id: "a12", kind: "crash", outcome: "abandon" },
    ],
    race_balance_drift_daily: [
      { metric_date: "2026-09-08", metrics: { favoriteWinRate: 0.5, stageInstances: 2 },
        statuses: { favoriteWinRate: { status: "red" } } },
      { metric_date: "2026-09-09", metrics: { favoriteWinRate: 0.5, stageInstances: 2 },
        statuses: { favoriteWinRate: { status: "red" } } },
    ],
    ops_alert_state: [],
  };
}

async function runWith(tables, extra = {}) {
  const supabase = makeTableStub(tables);
  const sent = [];
  const captured = [];
  const result = await runBalanceDriftWatch({
    supabase,
    now: NOW,
    sendWebhookFn: async (url, payload) => { sent.push({ url, payload }); },
    getOpsWebhookFn: async () => "https://example.invalid/ops",
    captureExceptionFn: (err) => captured.push(err),
    ...extra,
  });
  const driftUpserts = supabase.upserts.filter((u) => u.table === "race_balance_drift_daily");
  return { result, supabase, sent, captured, driftUpserts };
}

function stripVolatile({ driftUpserts, sent }) {
  const row = driftUpserts[0]?.row ?? null;
  const persisted = row ? { metric_date: row.metric_date, metrics: row.metrics, statuses: row.statuses } : null;
  const embeds = sent.map((s) => s.payload.embeds.map(({ timestamp: _ts, ...rest }) => rest));
  return { persisted: JSON.stringify(persisted), embeds: JSON.stringify(embeds) };
}

test("CAPTURE", async () => {
  const out = await runWith(v3Fixture());
  const s = stripVolatile(out);
  console.log("GOLDEN_PERSISTED=" + s.persisted);
  console.log("GOLDEN_EMBEDS=" + s.embeds);
  assert.ok(true);
});

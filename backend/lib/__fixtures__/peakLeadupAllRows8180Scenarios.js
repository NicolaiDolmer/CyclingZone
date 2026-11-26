// #8180: scenarios for the form-peak lead-up in a large field, against a fake PostgREST that keeps
// the server's row cap.
//
// The fake answers the two query shapes loadTeamTrainingRuns can send for the copy
// (training_day_runs): main's single call (no order, no range) returns the rows in the order of the
// (team_id, tick_date DESC) index and stops at the cap, as the prod plan does; the paged call must
// carry a total order and gets one page per .range(). The rows are synthetic (no prod data), and the
// frozen fixture peakLeadupAllRows8180OffBase.json holds only sha256 digests produced by the
// merge-base module (hard rule 17).
import { createHash } from "node:crypto";

export const ROW_CAP_8180 = 1000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;
const isoDate = (ord) => new Date(ord * DAY_MS).toISOString().slice(0, 10);
const FOCUSES = ["vo2max", "sprint", "threshold", "climbing", "endurance", "tt"];

/**
 * Fourteen teams, more than the cap in total, so the last team in id order gets nothing from main's
 * single call. Dates with five race-day runs and dates with one run, rest days, a pending report.
 */
export function buildScenario8180(seed) {
  const rand = mulberry32(seed);
  const baseOrd = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
  const teams = Array.from({ length: 14 }, (_, i) => `team-${String(i + 1).padStart(2, "0")}`);
  const riders = {};
  for (const t of teams) riders[t] = Array.from({ length: 5 + Math.floor(rand() * 4) }, (_, i) => `${t}-r${i}`);
  const rows = [];
  let id = 0;
  for (let d = 0; d < 30; d++) {
    for (const t of teams) {
      if (rand() < 0.1) continue;
      const runs = rand() < 0.4 ? 1 : 5;
      for (let g = 0; g < runs; g++) {
        const lines = [];
        for (const r of riders[t]) {
          if (rand() < 0.05) continue;
          const rest = rand() < 0.25;
          const entry = { rider_id: r, status: rest ? "rest" : (rand() < 0.05 ? "injured" : "trained") };
          if (!rest) entry.focus = FOCUSES[Math.floor(rand() * FOCUSES.length)];
          lines.push(entry);
        }
        id += 1;
        rows.push({
          id: `run-${String(id).padStart(6, "0")}`,
          team_id: t,
          tick_date: isoDate(baseOrd + d),
          game_day: 100 + d * 5 + g,
          report: rand() < 0.02 ? { pending: true } : { riders: lines },
        });
      }
    }
  }
  const entrants = teams.flatMap((t) => riders[t].map((r) => ({ rider_id: r, team_id: t })));
  const windows = new Map();
  for (const e of entrants) {
    if (rand() < 0.2) continue;
    const start = baseOrd + 16 + Math.floor(rand() * 14);
    const list = [{ start, end: start + 3 + Math.floor(rand() * 4), targetRaceId: rand() < 0.8 ? "race-1" : null }];
    if (rand() < 0.25) list.push({ start: Math.min(start + 6, baseOrd + 30), end: start + 10, targetRaceId: "race-2" });
    windows.set(e.rider_id, list);
  }
  const conditions = new Map(entrants.map((e) => [e.rider_id, {
    injured_until: rand() < 0.08 ? isoDate(baseOrd + 18 + Math.floor(rand() * 10)) : null,
    fatigue: Math.floor(rand() * 100),
  }]));
  const demands = new Map([["race-1", { climbing: 0.6, endurance: 0.4 }], ["race-2", { sprint: 0.7, vo2max: 0.3 }]]);
  return { teams, rows, entrants, windows, conditions, demands };
}

function compare(a, b, keys) {
  for (const [col, asc] of keys) {
    const x = a[col], y = b[col];
    if (x === y) continue;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : 1) * (asc ? 1 : -1);
  }
  return 0;
}

/**
 * Fake client. `flags` answers app_config by key (missing key = no row). Records every
 * training_day_runs request as "single" or "page:<from>-<to>" in `calls`.
 */
export function fakeClient8180(rows, { flags = {}, cap = ROW_CAP_8180 } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      if (table === "app_config") {
        return { select: () => ({ eq: (_col, key) => ({
          maybeSingle: async () => ({ data: Object.hasOwn(flags, key) && flags[key] != null ? { value: flags[key] } : null, error: null }),
        }) }) };
      }
      if (table !== "training_day_runs") throw new Error(`unexpected table ${table}`);
      const q = { order: [] };
      const run = () => {
        let out = rows.filter((r) => q.teams.has(r.team_id) && r.tick_date >= q.gte && r.tick_date < q.lt);
        if (q.range) {
          if (!q.order.some(([col]) => col === "id")) throw new Error("a paged read needs a total order");
          out = [...out].sort((a, b) => compare(a, b, q.order)).slice(q.range[0], q.range[1] + 1);
          calls.push(`page:${q.range[0]}-${q.range[1]}`);
        } else {
          // The plan's index scan: (team_id, tick_date DESC), heap order inside a date.
          out = [...out].sort((a, b) => compare(a, b, [["team_id", true], ["tick_date", false], ["id", true]]));
          calls.push("single");
        }
        const cols = q.cols.split(",").map((c) => c.trim());
        return out.slice(0, cap).map((r) => Object.fromEntries(cols.map((c) => [c, structuredClone(r[c])])));
      };
      const chain = {
        select(cols) { q.cols = cols; return chain; },
        in(_col, v) { q.teams = new Set(v); return chain; },
        gte(_col, v) { q.gte = v; return chain; },
        lt(_col, v) { q.lt = v; return chain; },
        order(col, opts = {}) { q.order.push([col, opts.ascending !== false]); return chain; },
        range(from, to) { q.range = [from, to]; return chain; },
        then(resolve, reject) { return Promise.resolve().then(() => ({ data: run(), error: null })).then(resolve, reject); },
      };
      return chain;
    },
    rpc() { calls.push("rpc"); throw new Error("the ticks switch is off: no rpc expected"); },
  };
}

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Run one scenario through `mod` (a racePeakPlans module). Returns the raw outputs (tests only). */
export async function runScenario8180(mod, seed, { allRows = false, flags = {} } = {}) {
  const s = buildScenario8180(seed);
  const client = fakeClient8180(s.rows, { flags });
  const peakPlansByRider = new Map([...s.windows].map(([k, v]) => [k, v.map((w) => ({ ...w }))]));
  await mod.resolvePeakTrainingQualities({
    supabase: client,
    entrants: s.entrants,
    peakPlansByRider,
    ...(allRows ? { allRows: true } : {}),
    loadRiderConditions: async () => s.conditions,
    loadTargetRaceDemands: async () => s.demands,
  });
  const qualities = [...peakPlansByRider].sort(([a], [b]) => a.localeCompare(b)).map(([k, ws]) => [k, ws.map((w) => w.trainingQuality ?? null)]);
  const runsClient = fakeClient8180(s.rows, { flags });
  const runs = await mod.loadTeamTrainingRuns({
    supabase: runsClient, teamIds: s.teams, startDate: "2026-10-01", endDate: "2026-11-15", ...(allRows ? { allRows: true } : {}),
  });
  return { scenario: s, qualities, runs, calls: client.calls, runsCalls: runsClient.calls };
}

/** Digests only: what is compared with the merge-base fixture. */
export async function runScenarios8180(mod, { allRows = false, flags = {}, seeds = [1, 2, 3, 4, 5, 6] } = {}) {
  const out = [];
  for (const seed of seeds) {
    const { qualities, runs, calls, runsCalls } = await runScenario8180(mod, seed, { allRows, flags });
    const runsView = runs.map((r) => [r.team_id, r.ord, [...r.riderMap]]);
    out.push({ seed, qualities: digest(qualities), runs: digest(runsView), calls, runsCalls });
  }
  return out;
}

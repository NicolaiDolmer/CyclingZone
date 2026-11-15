// #6490 trin c: frozen golden for the peak signal with the switch OFF.
//
// The scenarios run the REAL loadTeamTrainingRuns (via resolvePeakTrainingQualities) of a given
// racePeakPlans module against a fake PostgREST client over generated training_day_runs rows. The
// fixture peakLeadup6490OffBase.json holds the digests produced by the merge-base module (before
// #6490); the test runs the new module with the switch off and must produce the same digests.
// Only sha256 digests are stored, never the values (hard rule 17).
import { createHash } from "node:crypto";

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

/** Generated rows: several teams, dates with five race-day runs, legacy one-run dates, rest days. */
export function buildScenario(seed) {
  const rand = mulberry32(seed);
  const baseOrd = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
  const teams = ["team-a", "team-b", "team-c", "team-d"].slice(0, 2 + Math.floor(rand() * 3));
  const riders = {};
  for (const t of teams) riders[t] = Array.from({ length: 4 + Math.floor(rand() * 5) }, (_, i) => `${t}-r${i}`);
  const rows = [];
  for (let d = 0; d < 40; d++) {
    for (const t of teams) {
      if (rand() < 0.15) continue;
      const runs = rand() < 0.3 ? 1 : 5;
      for (let g = 0; g < runs; g++) {
        const lines = [];
        for (const r of riders[t]) {
          if (rand() < 0.1) continue;
          const rest = rand() < 0.3;
          const entry = { rider_id: r, status: rest ? "rest" : (rand() < 0.1 ? "injured" : "trained") };
          if (!rest || rand() < 0.5) entry.focus = rest ? null : FOCUSES[Math.floor(rand() * FOCUSES.length)];
          lines.push(entry);
        }
        rows.push({ team_id: t, tick_date: isoDate(baseOrd + d), report: rand() < 0.05 ? { pending: true } : { riders: lines } });
      }
    }
  }
  const entrants = teams.flatMap((t) => riders[t].map((r) => ({ rider_id: r, team_id: t })));
  const windows = new Map();
  for (const e of entrants) {
    if (rand() < 0.3) continue;
    const start = baseOrd + 15 + Math.floor(rand() * 25);
    const list = [{ start, end: start + 3 + Math.floor(rand() * 4), targetRaceId: rand() < 0.7 ? "race-1" : null }];
    if (rand() < 0.3) list.push({ start: start + 8, end: start + 12, targetRaceId: "race-2" });
    windows.set(e.rider_id, list);
  }
  const conditions = new Map(entrants.map((e) => [e.rider_id, {
    injured_until: rand() < 0.1 ? isoDate(baseOrd + 20 + Math.floor(rand() * 10)) : null,
    fatigue: Math.floor(rand() * 100),
  }]));
  const demands = new Map([["race-1", { climbing: 0.6, endurance: 0.4 }], ["race-2", { sprint: 0.7, vo2max: 0.3 }]]);
  return { rows, entrants, windows, conditions, demands };
}

/**
 * Fake client: the table query loadTeamTrainingRuns sends, plus app_config for the switches.
 * `flag` answers every key; `flags` (by key) overrides it for the keys it names.
 */
export function fakeClient(rows, { flag = null, flags = {} } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      if (table === "app_config") {
        calls.push("app_config");
        return { select: () => ({ eq: (_col, key) => {
          const value = Object.hasOwn(flags, key) ? flags[key] : flag;
          return { maybeSingle: async () => ({ data: value == null ? null : { value }, error: null }) };
        } }) };
      }
      if (table !== "training_day_runs") throw new Error(`unexpected table ${table}`);
      const q = {};
      const chain = {
        select(cols) { q.cols = cols; return chain; },
        in(col, v) { q.teams = new Set(v); return chain; },
        gte(col, v) { q.gte = v; return chain; },
        lt(col, v) {
          q.lt = v;
          calls.push(`training_day_runs:${q.cols}`);
          const data = rows.filter((r) => q.teams.has(r.team_id) && r.tick_date >= q.gte && r.tick_date < q.lt)
            .map((r) => structuredClone(r));
          return Promise.resolve({ data, error: null });
        },
      };
      return chain;
    },
    rpc() { calls.push("rpc"); throw new Error("the switch is off: no rpc expected"); },
  };
}

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Run every scenario through `mod` (a racePeakPlans module). Returns digests only. */
export async function runOffScenarios(mod, { flag = null, flags = {}, seeds = [1, 2, 3, 4, 5, 6, 7, 8] } = {}) {
  const out = [];
  for (const seed of seeds) {
    const s = buildScenario(seed);
    const client = fakeClient(s.rows, { flag, flags });
    const peakPlansByRider = new Map([...s.windows].map(([k, v]) => [k, v.map((w) => ({ ...w }))]));
    await mod.resolvePeakTrainingQualities({
      supabase: client,
      entrants: s.entrants,
      peakPlansByRider,
      loadRiderConditions: async () => s.conditions,
      loadTargetRaceDemands: async () => s.demands,
    });
    const qualities = [...peakPlansByRider].sort(([a], [b]) => a.localeCompare(b)).map(([k, ws]) => [k, ws.map((w) => w.trainingQuality ?? null)]);
    const runs = await mod.loadTeamTrainingRuns({ supabase: fakeClient(s.rows, { flag, flags }), teamIds: [...new Set(s.entrants.map((e) => e.team_id))], startDate: "2026-10-01", endDate: "2026-11-15" });
    const runsView = runs.map((r) => [r.team_id, r.ord, [...r.riderMap]]);
    out.push({ seed, qualities: digest(qualities), runs: digest(runsView), tableQueries: client.calls.filter((c) => c.startsWith("training_day_runs")) });
  }
  return out;
}

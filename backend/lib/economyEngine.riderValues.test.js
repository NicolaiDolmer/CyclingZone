import test from "node:test";
import assert from "node:assert/strict";

import { updateRiderValues } from "./economyEngine.js";

// Minimal chainable Supabase-double for updateRiderValues. Honors the filters the
// function relies on — crucially .gt("race_days_total", 0) on completed seasons —
// so a missing filter (regression) would let the empty placeholder season back in
// and change the computed bonus.
function makeClient({ seasons, races, raceResults, riders }) {
  const updatedRiders = {};
  function from(table) {
    if (table === "seasons") {
      const b = { status: null, gtTotal: null };
      const api = {
        select: () => api,
        eq: (col, val) => { if (col === "status") b.status = val; return api; },
        gt: (col, val) => { if (col === "race_days_total") b.gtTotal = val; return api; },
        order: () => api,
        limit: (n) => {
          let rows = seasons.filter(s => s.status === b.status);
          if (b.gtTotal !== null) rows = rows.filter(s => (s.race_days_total || 0) > b.gtTotal);
          rows = rows.slice().sort((a, c) => c.number - a.number).slice(0, n);
          return Promise.resolve({ data: rows, error: null });
        },
        maybeSingle: () => {
          const rows = seasons.filter(s => s.status === b.status);
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
      };
      return api;
    }
    if (table === "races") {
      const b = { ids: [] };
      const api = {
        select: () => api,
        in: (_col, ids) => { b.ids = ids; return api; },
        range: (from0) => Promise.resolve({
          data: from0 === 0 ? races.filter(r => b.ids.includes(r.season_id)) : [],
          error: null,
        }),
      };
      return api;
    }
    if (table === "race_results") {
      const b = { ids: [], gt: 0 };
      const api = {
        select: () => api,
        in: (_col, ids) => { b.ids = ids; return api; },
        gt: (_col, val) => { b.gt = val; return api; },
        range: (from0) => Promise.resolve({
          data: from0 === 0
            ? raceResults.filter(r => b.ids.includes(r.race_id) && (r.prize_money || 0) > b.gt)
            : [],
          error: null,
        }),
      };
      return api;
    }
    if (table === "riders") {
      return {
        select: () => ({
          range: (from0) => Promise.resolve({ data: from0 === 0 ? riders : [], error: null }),
        }),
        update: (payload) => ({
          eq: (_col, id) => { updatedRiders[id] = payload; return Promise.resolve({ error: null }); },
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  }
  return { client: { from }, updatedRiders };
}

test("updateRiderValues excludes empty placeholder seasons (race_days_total=0) from the value average", async () => {
  const { client, updatedRiders } = makeClient({
    seasons: [
      // Active season, halfway through → weight 0.5
      { id: "active", number: 2, status: "active", race_days_completed: 5, race_days_total: 10 },
      // Real completed season → weight 1
      { id: "prev", number: 1, status: "completed", race_days_completed: 8, race_days_total: 8 },
      // Empty placeholder (like prod season 0) → MUST be excluded
      { id: "seed", number: 0, status: "completed", race_days_completed: 0, race_days_total: 0 },
    ],
    races: [
      { id: "r-active", season_id: "active" },
      { id: "r-prev", season_id: "prev" },
      { id: "r-seed", season_id: "seed" },
    ],
    raceResults: [
      { rider_id: "rider-1", race_id: "r-active", prize_money: 1000 },
      { rider_id: "rider-1", race_id: "r-prev", prize_money: 600 },
    ],
    riders: [{ id: "rider-1" }],
  });

  const result = await updateRiderValues(client);

  // Window = active (0.5) + prev (1); seed excluded → divisor = 1.5.
  // earnings = 1000 + 600 = 1600 → bonus = round(1600 / 1.5) = 1067.
  // If seed leaked in, divisor would be 2.5 → bonus 640 (regression guard).
  assert.equal(updatedRiders["rider-1"].prize_earnings_bonus, 1067);
  assert.equal(result.ridersUpdated, 1);
});

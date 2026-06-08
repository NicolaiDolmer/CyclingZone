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

test("updateRiderValues divides by a fixed 3-season window and excludes empty placeholder seasons", async () => {
  const { client, updatedRiders } = makeClient({
    seasons: [
      // Active season, halfway through (progress no longer affects the divisor)
      { id: "active", number: 2, status: "active", race_days_completed: 5, race_days_total: 10 },
      // Real completed season
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
      // Earnings on the empty placeholder season MUST be ignored (filter guard).
      { rider_id: "rider-1", race_id: "r-seed", prize_money: 5000 },
    ],
    riders: [{ id: "rider-1" }],
  });

  const result = await updateRiderValues(client);

  // Fixed window: divisor = 3 regardless of how many seasons have data.
  // Window = active + prev; seed excluded (race_days_total=0) so its 5000 is not
  // counted. earnings = 1000 + 600 = 1600 → bonus = round(1600 / 3) = 533.
  // If the placeholder filter regressed, earnings would include 5000 → 2200.
  // If the divisor reverted to the season-weight count (1.5), bonus would be 1067.
  assert.equal(updatedRiders["rider-1"].prize_earnings_bonus, 533);
  assert.equal(result.ridersUpdated, 1);
});

test("updateRiderValues dampens season 1 to one third (fixed /3, future seasons count as 0)", async () => {
  const { client, updatedRiders } = makeClient({
    seasons: [
      // Only season 1 has been raced (just completed at the S1->S2 transition).
      { id: "s1", number: 1, status: "completed", race_days_completed: 9, race_days_total: 9 },
    ],
    races: [{ id: "r1", season_id: "s1" }],
    raceResults: [{ rider_id: "rider-1", race_id: "r1", prize_money: 900 }],
    riders: [{ id: "rider-1" }],
  });

  const result = await updateRiderValues(client);

  // Owner model 2026-06-08: seasons 2 and 3 have no results yet → count as 0, but
  // the divisor stays 3. bonus = round(900 / 3) = 300 (not 900).
  assert.equal(updatedRiders["rider-1"].prize_earnings_bonus, 300);
  assert.equal(result.ridersUpdated, 1);
});

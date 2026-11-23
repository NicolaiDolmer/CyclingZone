import test from "node:test";
import assert from "node:assert/strict";
import { sortScoutedRiderPage } from "./potentialEstimateRead.js";

test("orders the filtered roster globally by the viewer's displayed estimate", async () => {
  const riders = [
    { id: "a", best_role_rating: 86 },
    { id: "b", best_role_rating: 50 },
    { id: "c", best_role_rating: 50 },
    { id: "d", best_role_rating: 90 },
    { id: "excluded", best_role_rating: 98 },
  ];
  const estimate = (rider_id, team_id, value, certainty = "fair") => ({ rider_id, team_id, value, certainty });
  const tables = {
    riders,
    rider_potential_estimates: [
      estimate("a", "mine", 60),
      estimate("b", "mine", 72),
      estimate("c", "mine", 72),
      estimate("a", "theirs", 99),
      estimate("d", "theirs", 99),
      estimate("excluded", "mine", 98),
      estimate("d", "mine", null),
    ],
  };
  const supabase = {
    from(table) {
      const filters = [];
      const q = {
        select() { return q; },
        eq(key, value) { filters.push((row) => row[key] === value); return q; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return q; },
        order() { return q; },
        async range(from, to) {
          const rows = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return q;
    },
  };
  const options = { riderIds: ["d", "c", "a", "b", "b", "unknown"], teamId: "mine", pageSize: 2 };
  const page = (ascending, index, teamId = options.teamId) =>
    sortScoutedRiderPage(supabase, { ...options, ascending, page: index, teamId });
  assert.deepEqual(await page(false, 1), { ids: ["a", "b"], count: 5 });
  assert.deepEqual(await page(false, 2), { ids: ["c", "d"], count: 5 });
  assert.deepEqual(await page(true, 1), { ids: ["b", "c"], count: 5 });
  assert.deepEqual(await page(true, 2), { ids: ["a", "d"], count: 5 });
  assert.deepEqual(await page(true, 3), { ids: ["unknown"], count: 5 });
  assert.deepEqual(await page(false, 1, "theirs"), { ids: ["a", "d"], count: 5 });
  assert.deepEqual(await page(true, 4), { ids: [], count: 5 });
});

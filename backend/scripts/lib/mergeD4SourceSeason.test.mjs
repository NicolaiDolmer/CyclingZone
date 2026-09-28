import test from "node:test";
import assert from "node:assert/strict";
import { loadLatestCompletedSeason } from "./mergeD4SourceSeason.mjs";

function seasonsClient(rows) {
  const calls = [];
  const query = {
    select(columns) { calls.push(["select", columns]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    order(column, options) { calls.push(["order", column, options]); return this; },
    limit(n) { calls.push(["limit", n]); return this; },
    maybeSingle() {
      const completedOnly = calls.some(([op, col, value]) => op === "eq" && col === "status" && value === "completed");
      const eligible = completedOnly ? rows.filter((r) => r.status === "completed") : rows;
      return Promise.resolve({ data: [...eligible].sort((a, b) => b.number - a.number)[0] ?? null, error: null });
    },
  };
  return { client: { from(table) { assert.equal(table, "seasons"); return query; } }, calls };
}

test("#5857: default dry-run læser senest completed, ikke højeste upcoming sæson", async () => {
  const { client, calls } = seasonsClient([
    { id: "s3", number: 3, status: "completed" },
    { id: "s4", number: 4, status: "upcoming" },
  ]);
  const result = await loadLatestCompletedSeason(client);
  assert.equal(result.data?.id, "s3");
  assert.ok(calls.some(([op, col, value]) => op === "eq" && col === "status" && value === "completed"));
});

test("#5857: ingen completed sæson giver intet kildesnapshot", async () => {
  const { client } = seasonsClient([{ id: "s4", number: 4, status: "upcoming" }]);
  const result = await loadLatestCompletedSeason(client);
  assert.equal(result.data, null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSeniorStartWarning } from "./seniorStartWarning.ts";

const team = { id: "team-1", user_id: "user-1", league_division_id: "pool-1", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, parked_at: null, retired_at: null };
const rider = (id: string, squad = "senior") => ({ id, squad, is_academy: squad !== "senior", is_retired: false });

test("#5867 shows the missing senior count at 0 and 5, and clears at 6", () => {
  assert.deepEqual(computeSeniorStartWarning({ team, riders: [] }), { count: 0, missing: 6, min: 6 });
  const five = Array.from({ length: 5 }, (_, n) => rider(`r${n}`));
  assert.deepEqual(computeSeniorStartWarning({ team, riders: [...five, rider("u23", "u23"), { ...rider("retired"), is_retired: true }] }), { count: 5, missing: 1, min: 6 });
  assert.equal(computeSeniorStartWarning({ team, riders: [...five, rider("sixth")] }), null);
});

test("#5867 never warns a parked, frozen or pool-less team", () => {
  assert.equal(computeSeniorStartWarning({ team: { ...team, parked_at: "2026-09-27" }, riders: [] }), null);
  assert.equal(computeSeniorStartWarning({ team: { ...team, is_frozen: true }, riders: [] }), null);
  assert.equal(computeSeniorStartWarning({ team: { ...team, league_division_id: null }, riders: [] }), null);
});

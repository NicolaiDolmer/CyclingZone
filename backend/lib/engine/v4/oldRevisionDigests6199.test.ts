// #6199 (PR #6330 follow-up): proof that the exact-place and regroup work on
// official_times_v2 moves nothing it must not. Old revisions keep their complete
// output byte for byte; official_times_v2 keeps every time, rank, group,
// incident and passage (only its timeline events gain/lose what the issue asks).
// Baseline: test-data/oldRevisionDigests6199.json, written from the commit
// before the change (testUtils/oldRevisionDigests6199.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FROZEN_REVISIONS, frozenDigests } from "./testUtils/oldRevisionDigests6199.ts";

const baseline = JSON.parse(readFileSync(new URL("./test-data/oldRevisionDigests6199.json", import.meta.url), "utf8")) as {
  complete: Record<string, Record<string, string>>;
  physicsOnly: Record<string, Record<string, string>>;
};

test("#6199: legacy, orders_gc_v1/v2/v3 and official_times_v1 keep their complete outputs (varied field, AI orders, real stage shapes)", () => {
  assert.deepEqual(Object.keys(baseline.complete), [...FROZEN_REVISIONS]);
  const actual = frozenDigests();
  for (const revision of FROZEN_REVISIONS) {
    assert.ok(Object.keys(baseline.complete[revision]).length >= 20, `${revision}: the baseline covers every profile`);
    assert.deepEqual(actual[revision], baseline.complete[revision], revision);
  }
});

test("#6199: official_times_v2 keeps every time, rank, group snapshot, incident and passage", () => {
  assert.deepEqual(frozenDigests(["official_times_v2"], true), baseline.physicsOnly);
});

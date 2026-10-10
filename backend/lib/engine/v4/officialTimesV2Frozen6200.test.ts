// #6200: official_times_v3 is a NEW, switched-off revision. The live revision
// official_times_v2 must not move by a single byte: its complete stage outputs
// (times, ranks, groups, timeline, incidents, passages) are frozen here. The
// baseline (test-data/officialTimesV2Frozen6200.json) was written on main BEFORE
// the official_times_v3 change, from the same varied field and AI orders as the
// #6199 freeze, on every proxy stage shape plus every mountain stage with a
// descent finish and a summit finish (the shapes #6200 touches).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { digestOf, frozenStageOutput } from "./testUtils/oldRevisionDigests6199.ts";

type StageRow = { profile_type: string; finale_type?: string; stage_number?: number } & Record<string, unknown>;

export const V2_FROZEN_SEEDS = ["6200-frozen-a", "6200-frozen-b"] as const;
const PER_SHAPE = 2;

/** Two stages of every profile/finale shape, plus every mountain descent finish. */
export function v2FrozenStages(): StageRow[] {
  const raw = JSON.parse(readFileSync(new URL("../../../scripts/baselines/v4-proxy-stages-2026-09-06.json", import.meta.url), "utf8"));
  const rows: StageRow[] = Array.isArray(raw) ? raw : raw.stages;
  const seen = new Map<string, number>();
  return rows.filter((row) => {
    const shape = `${row.profile_type}/${row.finale_type ?? "-"}`;
    const n = seen.get(shape) ?? 0;
    seen.set(shape, n + 1);
    const descentFinish = row.finale_type === "descent" && (row.profile_type === "mountain" || row.profile_type === "high_mountain");
    return descentFinish || n < PER_SHAPE;
  });
}

/** "profile/finale#stage@seed" -> sha256 of the complete official_times_v2 output. */
export function officialTimesV2Digests(revision = "official_times_v2"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const seed of V2_FROZEN_SEEDS) {
    for (const row of v2FrozenStages()) {
      out[`${row.profile_type}/${row.finale_type ?? "-"}#${row.stage_number ?? 1}@${seed}`] = digestOf(frozenStageOutput(row, seed, revision));
    }
  }
  return out;
}

test("#6200: official_times_v2 keeps its complete output byte for byte (every stage shape, all descent finishes)", () => {
  const baseline = JSON.parse(readFileSync(new URL("./test-data/officialTimesV2Frozen6200.json", import.meta.url), "utf8")) as {
    complete: Record<string, string>;
  };
  const actual = officialTimesV2Digests();
  assert.ok(Object.keys(baseline.complete).length >= 60, "the baseline covers every shape on both seeds");
  assert.deepEqual(Object.keys(actual), Object.keys(baseline.complete));
  for (const key of Object.keys(baseline.complete)) assert.equal(actual[key], baseline.complete[key], key);
});

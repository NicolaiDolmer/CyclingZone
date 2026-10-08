// #6199 (PR #6330 follow-up): frozen complete outputs for the revisions the
// official_times_v2 work must never move. A varied synthetic field (ten teams,
// specialists and helpers, AI orders built through the production adapter) on
// real proxy-stage shapes from the pinned baseline, so breakaways, splits,
// catches, descents and finales are all exercised. The digests were written
// from the commit BEFORE the exact-place and regroup changes; the test in
// oldRevisionDigests6199.test.ts proves they did not move.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { simulateStageV4 } from "../index.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { routeFromStageProfileRow } from "../adapters/routeAdapter.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import type { AbilityKey, Entrant, RiderRole, StageInput, StageOutput } from "../types.ts";

export const FROZEN_REVISIONS = ["legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3", "official_times_v1"] as const;
export const DIGEST_SEEDS = ["6199-frozen-a", "6199-frozen-b"] as const;
const PROFILES = ["flat", "rolling", "hilly", "mountain", "high_mountain", "cobbles", "classic"] as const;
const STAGES_PER_PROFILE = 2;

const ABILITIES: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];

/** Deterministic 32-bit PRNG (mulberry32) so the field never depends on Math.random. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECIALTIES: ReadonlyArray<Partial<Record<AbilityKey, number>>> = [
  { climbing: 22, recovery: 10, endurance: 8 },
  { sprint: 24, acceleration: 18, positioning: 10 },
  { punch: 20, acceleration: 10, climbing: 8 },
  { time_trial: 18, tempo: 14, flat: 10 },
  { cobblestone: 22, flat: 10, durability: 10 },
  { aggression: 20, endurance: 14, tempo: 10 },
  { descending: 22, climbing: 6 },
  {},
];

/** Ten teams of six: a captain, a sprint captain on some teams, helpers and free roles. */
export function frozenField(): Entrant[] {
  const next = rng(6199);
  const field: Entrant[] = [];
  for (let team = 0; team < 10; team++) {
    for (let slot = 0; slot < 6; slot++) {
      const specialty = SPECIALTIES[(team * 6 + slot) % SPECIALTIES.length];
      const base = 48 + Math.floor(next() * 16);
      const abilities = Object.fromEntries(ABILITIES.map((key) =>
        [key, Math.min(92, base + Math.floor(next() * 10) + (specialty[key] ?? 0))])) as Record<AbilityKey, number>;
      const role: RiderRole = slot === 0 ? "captain" : slot === 1 && team % 2 === 0 ? "sprint_captain" : slot <= 3 ? "helper" : "free_role";
      field.push({ rider_id: `t${team}r${slot}`, team_id: `team-${team}`, abilities, role, effort: "normal", condition: 1 });
    }
  }
  return field;
}

type StageRow = { profile_type: string; stage_number?: number } & Record<string, unknown>;

export function frozenStages(): StageRow[] {
  const raw = JSON.parse(readFileSync(new URL("../../../../scripts/baselines/v4-proxy-stages-2026-09-06.json", import.meta.url), "utf8"));
  const rows: StageRow[] = Array.isArray(raw) ? raw : raw.stages;
  return PROFILES.flatMap((profile) => rows.filter((row) => row.profile_type === profile).slice(0, STAGES_PER_PROFILE));
}

/** One complete stage output, AI orders included, through the production order adapter. */
export function frozenStageOutput(row: StageRow, seed: string, rulesRevision: string): StageOutput {
  const route = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]);
  const field = frozenField();
  const plan = buildStageOrderPlan({
    rows: [],
    stageNumber: 1,
    roster: field.map((rider) => ({ team_id: rider.team_id as string, rider_id: rider.rider_id, role: rider.role, is_ai: true, abilities: rider.abilities })),
    context: { route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null }, ...(rulesRevision === "legacy" ? {} : { rules_revision: rulesRevision }) },
  } as Parameters<typeof buildStageOrderPlan>[0]);
  const startlist = field.map((rider) => ({ ...rider, effort: plan.aiEffortByRider.get(rider.rider_id) ?? rider.effort }));
  const input: StageInput = {
    route, startlist, orders: plan.orders, seed: `${seed}:${row.stage_number ?? 1}`, tuning: RACE_V4_TUNING,
    ...(rulesRevision === "legacy" ? {} : { rules_revision: rulesRevision }),
  } as StageInput;
  return simulateStageV4(input);
}

export const digestOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Everything but the timeline: times, ranks, groups, incidents, passages. */
export function physicsOf(output: StageOutput): Omit<StageOutput, "timeline"> {
  const { timeline: _timeline, ...physics } = output;
  return physics;
}

/**
 * revision -> "profile#stage@seed" -> sha256 of the complete stage output, or
 * (with `physicsOnly`) of the output without its timeline.
 */
export function frozenDigests(revisions: readonly string[] = FROZEN_REVISIONS, physicsOnly = false): Record<string, Record<string, string>> {
  const stages = frozenStages();
  const out: Record<string, Record<string, string>> = {};
  for (const revision of revisions) {
    const byStage: Record<string, string> = {};
    for (const seed of DIGEST_SEEDS) {
      for (const row of stages) {
        const output = frozenStageOutput(row, seed, revision);
        byStage[`${row.profile_type}#${row.stage_number ?? 1}@${seed}`] = digestOf(physicsOnly ? physicsOf(output) : output);
      }
    }
    out[revision] = byStage;
  }
  return out;
}

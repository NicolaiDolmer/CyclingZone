// #8189: frosne digests for kontakten hilly_finish_8189 slukket. Samme felt og samme rigtige
// etapeformer som #6199's frosne digests (oldRevisionDigests6199.ts), plus S5-varianter af de
// flade, boelgede og kuperede etaper (flad og stigende spurt), saa kontaktens kaldesteder koeres.
// Fixturen (test-data/hillyFinish8189Off.json) er skrevet af merge-base-koden, FOER kontakten
// fandtes (#7587); testen koerer den nye kode slukket og sammenligner bit for bit.
import { RACE_V4_TUNING } from "../tuning.ts";
import { simulateStageV4 } from "../index.ts";
import { routeFromStageProfileRow } from "../adapters/routeAdapter.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import { digestOf, frozenField, frozenStages } from "./oldRevisionDigests6199.ts";
import type { StageInput, StageOutput } from "../types.ts";

export const GOLDEN_8189_REVISIONS = ["s5_profiles_v3", "s5_profiles_v2"] as const;
export const GOLDEN_8189_SEEDS = ["8189-frozen-a", "8189-frozen-b"] as const;

type StageRow = { profile_type: string; stage_number?: number; finale_type?: string | null } & Record<string, unknown>;

/** De frosne etaper + S5-spurtvarianter af de flade, boelgede og kuperede. */
export function golden8189Stages(): Array<{ key: string; row: StageRow }> {
  const rows = frozenStages() as StageRow[];
  const out: Array<{ key: string; row: StageRow }> = rows.map((row) => ({ key: `${row.profile_type}#${row.stage_number ?? 1}`, row }));
  for (const row of rows) {
    if (row.profile_type === "flat" || row.profile_type === "rolling" || row.profile_type === "hilly") {
      out.push({ key: `${row.profile_type}#${row.stage_number ?? 1}/flat_sprint`, row: { ...row, finale_type: "flat_sprint" } });
    }
    if (row.profile_type === "hilly") {
      out.push({ key: `${row.profile_type}#${row.stage_number ?? 1}/uphill_sprint`, row: { ...row, finale_type: "uphill_sprint" } });
    }
  }
  return out;
}

/** Én komplet etape med AI-ordrer gennem produktionens ordre-adapter; `extra` laegges paa StageInput. */
export function golden8189Output(row: StageRow, seed: string, rulesRevision: string, extra: Partial<StageInput> = {}): StageOutput {
  const route = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]);
  const field = frozenField();
  const plan = buildStageOrderPlan({
    rows: [],
    stageNumber: 1,
    roster: field.map((rider) => ({ team_id: rider.team_id as string, rider_id: rider.rider_id, role: rider.role, is_ai: true, abilities: rider.abilities })),
    context: { route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null }, rules_revision: rulesRevision },
  } as Parameters<typeof buildStageOrderPlan>[0]);
  const startlist = field.map((rider) => ({ ...rider, effort: plan.aiEffortByRider.get(rider.rider_id) ?? rider.effort }));
  const input = {
    route, startlist, orders: plan.orders, seed: `${seed}:${row.stage_number ?? 1}`, tuning: RACE_V4_TUNING, rules_revision: rulesRevision, ...extra,
  } as StageInput;
  return simulateStageV4(input);
}

/** revision -> "noegle@seed" -> sha256 af hele etape-outputtet. */
export function golden8189Digests(extra: Partial<StageInput> = {}): Record<string, Record<string, string>> {
  const stages = golden8189Stages();
  const out: Record<string, Record<string, string>> = {};
  for (const revision of GOLDEN_8189_REVISIONS) {
    const byStage: Record<string, string> = {};
    for (const seed of GOLDEN_8189_SEEDS) {
      for (const { key, row } of stages) byStage[`${key}@${seed}`] = digestOf(golden8189Output(row, seed, revision, extra));
    }
    out[revision] = byStage;
  }
  return out;
}

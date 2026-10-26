// #6804 P2.4 (test-hjaelper): testportens frosne felt (ti hold af seks, AI-ordrer gennem
// produktions-adapteren) koert som FOERSTE ETAPE AF ET ETAPELOEB, saa udbrudspakken (P2 og
// klatre-jagten), der kun gaelder i etapeloeb, faar noget at virke paa. Samme felt og etaper
// som oldRevisionDigests6199, kun klassements-konteksten er tilfoejet.
import { simulateStageV4 } from "../index.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { routeFromStageProfileRow } from "../adapters/routeAdapter.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import { frozenField, frozenStages } from "./oldRevisionDigests6199.ts";
import type { GcContext, RouteV2, StageInput, StageOutput } from "../types.ts";

export const FIRST_STAGE_GC: GcContext = { status: "first_stage", stage_number: 1 } as GcContext;

export type StageRaceRun = { key: string; route: RouteV2; output: StageOutput };

/** Alle frosne etaper af de givne profiler, koert som etapeloebets foerste etape under `rulesRevision`. */
export function stageRaceRuns(rulesRevision: string, profiles: readonly string[], seeds: readonly string[]): StageRaceRun[] {
  const out: StageRaceRun[] = [];
  for (const row of frozenStages().filter((r) => profiles.includes(r.profile_type))) {
    const route = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]);
    const field = frozenField();
    const plan = buildStageOrderPlan({
      rows: [],
      stageNumber: 1,
      roster: field.map((rider) => ({ team_id: rider.team_id as string, rider_id: rider.rider_id, role: rider.role, is_ai: true, abilities: rider.abilities })),
      context: { route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null }, race: { is_stage_race: true, later_stages: [] }, rules_revision: rulesRevision },
    } as Parameters<typeof buildStageOrderPlan>[0]);
    // #5981: AI-holdenes delte kaptajn (plan.aiRoleByRider), som broen giver motoren.
    const startlist = field.map((rider) => ({ ...rider, role: plan.aiRoleByRider?.get(rider.rider_id) ?? rider.role, effort: plan.aiEffortByRider.get(rider.rider_id) ?? rider.effort }));
    for (const seed of seeds) {
      const input = { route, startlist, orders: plan.orders, seed: `${seed}:${row.stage_number ?? 1}`, tuning: RACE_V4_TUNING, rules_revision: rulesRevision, gc_context: FIRST_STAGE_GC } as StageInput;
      out.push({ key: `${row.profile_type}#${row.stage_number ?? 1}@${seed}`, route, output: simulateStageV4(input) });
    }
  }
  return out;
}

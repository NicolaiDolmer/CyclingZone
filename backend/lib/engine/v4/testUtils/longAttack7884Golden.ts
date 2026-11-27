// #8828 (test-hjaelper): de scenarier den frosne golden for "Angrib paa" daekker.
// Testportens frosne felt (ti hold af seks; to hold er "menneskehold" med gemte etapeplaner UDEN
// steder, resten AI-ordrer gennem produktions-adapteren) paa proxy-profilerne, som etapeloebets
// foerste etape, midt i et etapeloeb og som endagsloeb. Hver koersel giver hash af hele motorens
// output og af traethedens arbejdsandel (raceFatigue.stageWorkExposure).
//
// Filen koeres UAENDRET i merge-basen (foer tilslutningen) og i den nye kode. Fixturen
// (__fixtures__/longAttack7884Golden.json) skrives KUN af merge-basen og genereres aldrig med den
// nye kode (#7587). `longAttack` saetter kontakten paa motorens input (merge-basen kender ikke
// feltet), saa "taendt uden nogen Angrib paa-ordre" ogsaa bevises bit-identisk. Kun hashes forlader
// modulet (hard rule 17).
import { simulateStageV4 } from "../index.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { routeFromStageProfileRow } from "../adapters/routeAdapter.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import { digestOf, frozenField, frozenStages } from "./oldRevisionDigests6199.ts";
import { legacyOrderFromPlan, type StagePlanLeg } from "../../../stagePlan.ts";
import { stageWorkExposure } from "../../../raceFatigue.js";
import type { GcContext, StageInput, StageOutput } from "../types.ts";

export const GOLDEN_8828_SEEDS = ["8828-golden-a", "8828-golden-b"] as const;
const REVISION = "s5_profiles_v3";
const HUMAN = new Set(["team-0", "team-1"]);
const exposureOf = stageWorkExposure as unknown as (output: unknown, profileType: string | null) => Map<string, unknown>;

/** Planer uden steder paa menneskeholdene (laeet, gamle angreb fra toppen, sidste km, udbrud, sat-led). */
export const PLANS_8828: Readonly<Record<string, readonly StagePlanLeg[]>> = Object.freeze({
  t0r0: [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }],
  t0r1: [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }],
  t0r2: [{ task: "tempo" }],
  t0r3: [{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }],
  t1r0: [{ task: "follow_moves" }, { task: "ride_for_result", from: { at: "final_km" } }],
  t1r2: [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }],
  t1r4: [{ task: "breakaway" }, { task: "ride_for_result", from: { at: "dropped" } }],
});

type Context = { key: string; gc: GcContext; stageNumber: number };

function contexts(fieldIds: readonly string[]): Context[] {
  const standings = fieldIds.map((id, i) => ({ rider_id: id, rank: i + 1, gap_seconds: i * 7 }));
  return [
    { key: "first", gc: { status: "first_stage", stage_number: 1 } as GcContext, stageNumber: 1 },
    { key: "mid", gc: { status: "standings", stage_number: 4, leader_id: fieldIds[0], standings, stages_remaining: 3 } as GcContext, stageNumber: 4 },
    { key: "oneday", gc: { status: "one_day" } as GcContext, stageNumber: 1 },
  ];
}

type Row = ReturnType<typeof frozenStages>[number];

/**
 * Én etape: menneskeholdenes gemte raekker (`riders`, som race_team_orders.riders) gennem
 * produktions-adapteren, AI-ordrer for resten. `longAttack` = kontakten paa motorens input.
 */
export function runStage8828(row: Row, seed: string, ctx: Context, teamRiders: ReadonlyMap<string, readonly Record<string, unknown>[]>, longAttack: boolean): StageOutput {
  const route = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]);
  const field = frozenField();
  const human = (team: string) => teamRiders.has(team);
  const plan = buildStageOrderPlan({
    rows: [...teamRiders.entries()].map(([team_id, riders]) => ({ team_id, stage_number: ctx.stageNumber, riders: [...riders] })),
    stageNumber: ctx.stageNumber,
    roster: field.map((r) => ({ team_id: r.team_id as string, rider_id: r.rider_id, role: r.role, is_ai: !human(String(r.team_id)), abilities: r.abilities })),
    context: { route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null }, race: { is_stage_race: ctx.gc.status !== "one_day", later_stages: [] }, rules_revision: REVISION },
  } as Parameters<typeof buildStageOrderPlan>[0]);
  const savedEffort = new Map<string, string>();
  for (const riders of teamRiders.values()) for (const r of riders) if (typeof r["effort"] === "string") savedEffort.set(String(r["rider_id"]), r["effort"] as string);
  const startlist = field.map((r) => ({
    ...r,
    role: plan.aiRoleByRider?.get(r.rider_id) ?? r.role,
    effort: plan.aiEffortByRider.get(r.rider_id) ?? savedEffort.get(r.rider_id) ?? r.effort,
  }));
  const input = {
    route, startlist, orders: plan.orders, seed: `${seed}:${ctx.stageNumber}`, tuning: RACE_V4_TUNING, rules_revision: REVISION, gc_context: ctx.gc,
    ...(longAttack ? { long_attack_7884: true } : {}),
  } as StageInput;
  return simulateStageV4(input);
}

/** Menneskeholdenes raekker for planerne (uden steder), som API'et ville gemme dem. */
export function humanRows8828(plans: Readonly<Record<string, readonly StagePlanLeg[]>>): Map<string, Record<string, unknown>[]> {
  const out = new Map<string, Record<string, unknown>[]>();
  for (const r of frozenField()) {
    const legs = plans[r.rider_id];
    if (!legs || !HUMAN.has(String(r.team_id))) continue;
    if (!out.has(String(r.team_id))) out.set(String(r.team_id), []);
    out.get(String(r.team_id))!.push({ rider_id: r.rider_id, ...legacyOrderFromPlan(legs), plan: legs });
  }
  return out;
}

/** Alle koersler: profil x kontekst x froe x (med/uden menneskeholdenes planer). */
export function golden8828Digests(longAttack: boolean): Record<string, { output: string; exposure: string }> {
  const field = frozenField();
  const ids = field.map((r) => r.rider_id).sort();
  const out: Record<string, { output: string; exposure: string }> = {};
  const rows = frozenStages().filter((_, i) => i % 2 === 0);
  for (const row of rows) {
    for (const ctx of contexts(ids)) {
      for (const withPlans of [false, true]) {
        const teamRiders = withPlans ? humanRows8828(PLANS_8828) : new Map<string, Record<string, unknown>[]>();
        for (const seed of GOLDEN_8828_SEEDS) {
          const output = runStage8828(row, seed, ctx, teamRiders, longAttack);
          const exposure = exposureOf(output, row.profile_type);
          const key = `${row.profile_type}#${row.stage_number ?? 1}:${ctx.key}:${withPlans ? "plans" : "ai"}@${seed}`;
          out[key] = { output: digestOf(output), exposure: digestOf([...exposure.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) };
        }
      }
    }
  }
  return out;
}

export { contexts as contexts8828 };

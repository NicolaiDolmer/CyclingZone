// #7855 (ejerens tre valg 12/11, test-hjaelper): de scenarier den frosne golden daekker.
// Testportens frosne felt (ti hold af seks; to hold er "menneskehold" med gemte etapeplaner UDEN
// troejejagt, resten AI-ordrer gennem produktions-adapteren) paa alle proxy-profiler med passager,
// som etapeloebets foerste etape, midt i et etapeloeb (klassement + troejefoerere + #6937-
// bjergjaegere), sen Grand Tour-etape og endagsloeb. Hver koersel giver hash af hele motorens output
// og af traethedens arbejdsandel (raceFatigue.stageWorkExposure).
//
// Filen koeres UAENDRET i merge-basen (foer ejerens tre valg) og i den nye kode. Fixturen
// (__fixtures__/jerseyHunt7855Golden.json) skrives KUN af merge-basen og genereres aldrig med
// den nye kode (#7587). Kun hashes forlader modulet (hard rule 17).
import { simulateStageV4 } from "../index.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { routeFromStageProfileRow } from "../adapters/routeAdapter.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import { digestOf, frozenField, frozenStages } from "./oldRevisionDigests6199.ts";
import { legacyOrderFromPlan, type StagePlanLeg } from "../../../stagePlan.ts";
import { stageWorkExposure } from "../../../raceFatigue.js";
import type { GcContext, JerseyLeaders, StageInput } from "../types.ts";

export const GOLDEN_7855_SEEDS = ["7855-golden-a", "7855-golden-b"] as const;
const REVISION = "s5_profiles_v3";
const HUMAN = new Set(["team-0", "team-1"]);
// raceFatigue.js er JS (JSDoc-typer); kun formen vi bruger.
const exposureOf = stageWorkExposure as unknown as (output: unknown, profileType: string | null) => Map<string, unknown>;

/** Planer uden troejejagt paa menneskeholdene (udbrud, tempo, tog, laeet, sat-led). */
const PLANS: Readonly<Record<string, readonly StagePlanLeg[]>> = Object.freeze({
  t0r1: [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }],
  t0r2: [{ task: "tempo" }],
  t0r3: [{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }],
  t1r2: [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }],
  t1r4: [{ task: "breakaway" }, { task: "ride_for_result", from: { at: "dropped" } }],
});

type Context = { key: string; gc: GcContext; jersey?: JerseyLeaders; stageNumber: number };

function contexts(fieldIds: readonly string[]): Context[] {
  const standings = fieldIds.map((id, i) => ({ rider_id: id, rank: i + 1, gap_seconds: i * 7 }));
  const leaders: JerseyLeaders = { points: fieldIds[7], kom: fieldIds[13], kom_hunters: [fieldIds[13], fieldIds[25], fieldIds[40]] };
  return [
    { key: "first", gc: { status: "first_stage", stage_number: 1 } as GcContext, stageNumber: 1 },
    { key: "mid", gc: { status: "standings", stage_number: 4, leader_id: fieldIds[0], standings, stages_remaining: 3 } as GcContext, jersey: leaders, stageNumber: 4 },
    { key: "gt", gc: { status: "standings", stage_number: 17, leader_id: fieldIds[0], standings, stages_remaining: 4 } as GcContext, jersey: leaders, stageNumber: 17 },
    { key: "oneday", gc: { status: "one_day" } as GcContext, stageNumber: 1 },
  ];
}

/**
 * Alle koersler: profil x kontekst x frø x (med/uden menneskeholdenes planer). `jerseyHunt` saetter
 * kontakten paa motorens input (i merge-basen kendes den, men ingen plan har jagt).
 */
export function golden7855Digests(jerseyHunt: boolean): Record<string, { output: string; exposure: string }> {
  const field = frozenField();
  const ids = field.map((r) => r.rider_id).sort();
  const out: Record<string, { output: string; exposure: string }> = {};
  const rows = frozenStages();
  // En flad etape med to indlagte spurter (som dommens), saa spurt-passagerne ogsaa er flere.
  const flatTwo = { ...rows.find((r) => r.profile_type === "flat")!, sprints: [{ name: "Sprint A", km: 60, kind: "intermediate" }, { name: "Sprint B", km: 120, kind: "intermediate" }] };
  (flatTwo as { sprints: unknown[] }).sprints.push({ name: "Finish", km: (flatTwo as unknown as { distance_km: number }).distance_km, kind: "finish" });
  const stageRows = [...rows.filter((_, i) => i % 2 === 0), { ...flatTwo, profile_type: "flat", __key: "flat2sprints" }];
  for (const row of stageRows) {
    const route = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]);
    for (const ctx of contexts(ids)) {
      for (const withPlans of [false, true]) {
        const human = (team: string) => withPlans && HUMAN.has(team);
        const teamRows = new Map<string, { team_id: string; stage_number: number; riders: unknown[] }>();
        for (const r of field) {
          const legs = PLANS[r.rider_id];
          if (!legs || !human(String(r.team_id))) continue;
          if (!teamRows.has(String(r.team_id))) teamRows.set(String(r.team_id), { team_id: String(r.team_id), stage_number: ctx.stageNumber, riders: [] });
          teamRows.get(String(r.team_id))!.riders.push({ rider_id: r.rider_id, ...legacyOrderFromPlan(legs), plan: legs });
        }
        const plan = buildStageOrderPlan({
          rows: [...teamRows.values()],
          stageNumber: ctx.stageNumber,
          roster: field.map((r) => ({ team_id: r.team_id as string, rider_id: r.rider_id, role: r.role, is_ai: !human(String(r.team_id)), abilities: r.abilities })),
          context: { route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null }, race: { is_stage_race: ctx.gc.status !== "one_day", later_stages: [] }, rules_revision: REVISION },
        } as Parameters<typeof buildStageOrderPlan>[0]);
        const startlist = field.map((r) => ({
          ...r,
          role: plan.aiRoleByRider?.get(r.rider_id) ?? r.role,
          effort: plan.aiEffortByRider.get(r.rider_id) ?? (PLANS[r.rider_id] && human(String(r.team_id)) ? legacyOrderFromPlan(PLANS[r.rider_id]).effort : r.effort),
        }));
        for (const seed of GOLDEN_7855_SEEDS) {
          const input = {
            route, startlist, orders: plan.orders, seed: `${seed}:${ctx.stageNumber}`, tuning: RACE_V4_TUNING, rules_revision: REVISION, gc_context: ctx.gc,
            ...(ctx.jersey ? { jersey_leaders: ctx.jersey } : {}),
            ...(jerseyHunt ? { jersey_hunt_7855: true } : {}),
          } as StageInput;
          const output = simulateStageV4(input);
          const exposure = exposureOf(output, route.profile_type);
          const key = `${(row as { __key?: string }).__key ?? `${row.profile_type}#${row.stage_number ?? 1}`}:${ctx.key}:${withPlans ? "plans" : "ai"}@${seed}`;
          out[key] = { output: digestOf(output), exposure: digestOf([...exposure.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) };
        }
      }
    }
  }
  return out;
}

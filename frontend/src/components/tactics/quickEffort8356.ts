import {
  TERMINAL_TASKS,
  validateStagePlanLegs,
  type StagePlanLeg,
  type StagePlanRole,
  type StagePlanRoute,
  type StagePlanTask,
} from "../race/StagePlanModel.ts";

export type QuickEffort = "easy" | "normal" | "hard";
export const QUICK_EFFORTS: readonly QuickEffort[] = ["easy", "normal", "hard"];

/** Rollens opgave pr. indsats. Kun opgaver rollen må få (StagePlanModel.TASK_ROLES). */
export const QUICK_TASK: Readonly<Record<StagePlanRole, Readonly<Record<QuickEffort, StagePlanTask>>>> = Object.freeze({
  captain: { easy: "stay_sheltered", normal: "ride_for_result", hard: "follow_moves" },
  co_captain: { easy: "stay_sheltered", normal: "ride_for_result", hard: "follow_moves" },
  sprint_captain: { easy: "stay_sheltered", normal: "ride_for_result", hard: "follow_moves" },
  helper: { easy: "stay_sheltered", normal: "shelter_leader", hard: "tempo" },
  hunter: { easy: "stay_sheltered", normal: "breakaway", hard: "attack" },
  free_role: { easy: "stay_sheltered", normal: "ride_for_result", hard: "attack" },
});

const isTerminal = (leg: StagePlanLeg) => TERMINAL_TASKS.has(leg.task);

/** Apply the role task and merge redundant neighbours before validating. */
export function applyQuickEffort(
  base: readonly StagePlanLeg[] | null | undefined, role: StagePlanRole, effort: QuickEffort, route: StagePlanRoute,
): { legs: StagePlanLeg[] | null; error: string | null } {
  const task = QUICK_TASK[role][effort];
  if (base?.length && base.every(isTerminal)) return { legs: null, error: "stage_plan_terminal_not_last" };
  const legs: StagePlanLeg[] = [];
  for (const current of base?.length ? base : [{ task }]) {
    const leg = isTerminal(current) || current.task === task ? current : { task, ...(current.from ? { from: current.from } : {}) };
    const previous = legs.at(-1);
    // A hunt affects behaviour even when the two task names match.
    if (previous?.task === leg.task && previous.hunt === leg.hunt && !isTerminal(leg)) continue;
    legs.push(leg);
  }
  const error = validateStagePlanLegs(legs, role, route);
  return { legs: error ? null : legs, error };
}

/** Hvilket hurtigvalg planen svarer til; null når den er blandet (intet trin markeres). */
export function quickEffortOf(legs: readonly StagePlanLeg[] | null | undefined, role: StagePlanRole): QuickEffort | null {
  const open = (legs ?? []).filter((l) => !isTerminal(l));
  if (!open.length) return null;
  for (const effort of QUICK_EFFORTS) if (open.every((l) => l.task === QUICK_TASK[role][effort])) return effort;
  return null;
}

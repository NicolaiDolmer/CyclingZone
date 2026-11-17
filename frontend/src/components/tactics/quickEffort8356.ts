// #8356 · Hurtigvalget Let | Normal | Hård på en vejetape (ejer 17/11: "Hurtigvalg som genvej").
// En genvej, ikke en ny motor: knappen sætter rytterens opgaver langs ruten til dem, rollen har
// for den indsats. Indsatsen følger opgaven (backend/lib/stagePlan.ts TASK_EFFORT), så knappen
// skriver kun opgaver, etapeplanen allerede kender, og gemmes med det eksisterende gem.
// Udløsere (stigning, sidste 10 km, sat af) og slut-opgaverne (kør ind, grupetto, spurttog)
// bevares; er resultatet ikke gyldigt for rollen og ruten, bliver det én opgave for hele etapen.
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

/**
 * Planen efter et tryk. `base` er rytterens gemte plan eller assistentens forslag (null = ingen):
 * de ikke-afsluttende led får rollens opgave; udløsere og slut-led står. Ugyldigt = ét led.
 */
export function applyQuickEffort(
  base: readonly StagePlanLeg[] | null | undefined,
  role: StagePlanRole,
  effort: QuickEffort,
  route: StagePlanRoute,
): StagePlanLeg[] {
  const task = QUICK_TASK[role][effort];
  const legs = (base ?? []).map((leg) => (isTerminal(leg) ? { ...leg } : { task, ...(leg.from ? { from: leg.from } : {}) }));
  // To ens led i træk er det samme som ét: slå dem sammen, så planen ikke skifter til sig selv.
  const merged: StagePlanLeg[] = [];
  for (const leg of legs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.task === leg.task && !isTerminal(leg)) continue;
    merged.push(leg);
  }
  if (merged.length && merged.some((l) => !isTerminal(l)) && validateStagePlanLegs(merged, role, route) === null) return merged;
  return [{ task }];
}

/** Hvilket hurtigvalg planen svarer til; null når den er blandet (intet trin markeres). */
export function quickEffortOf(legs: readonly StagePlanLeg[] | null | undefined, role: StagePlanRole): QuickEffort | null {
  const open = (legs ?? []).filter((l) => !isTerminal(l));
  if (!open.length) return null;
  for (const effort of QUICK_EFFORTS) if (open.every((l) => l.task === QUICK_TASK[role][effort])) return effort;
  return null;
}

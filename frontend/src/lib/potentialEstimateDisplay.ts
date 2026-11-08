// #6110 Udvikling 2.0 trin 6: klientens ENE læsning af `potentialView`.
//
// Serveren sender potentialet som ét skønnet tal + et sikkerhedsord, eller som en
// af to tomme tilstande. Med slukket flag findes feltet ikke, og fladerne bruger
// uændret den gamle visning. Tændt er tallet det eneste potentiale, klienten ser:
// ingen flade må regne på det eller læse interval og loft ved siden af det.
//
// Spec: docs/superpowers/specs/2026-10-23-6110-potentiale-et-tal-samlet-design.md §3.4, §3.6.

export const CERTAINTIES = ["unsure", "fair", "sure"] as const;
export type Certainty = (typeof CERTAINTIES)[number];

export type PotentialViewShown = {
  hidden: false;
  value: number;
  certainty: Certainty;
  previousValue: number | null;
  previousCertainty: Certainty | null;
  changedAt: string | null;
};
export type PotentialViewUnscouted = { hidden: true; reason: "unscouted" };
export type PotentialViewLearning = {
  hidden: true;
  reason: "learning";
  trainings: number;
  trainingsNeeded: number;
};
export type PotentialView = PotentialViewShown | PotentialViewUnscouted | PotentialViewLearning;

export type EstimatePoint = { season: number; value: number };

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function certaintyOf(value: unknown): Certainty | null {
  return CERTAINTIES.find((word) => word === value) ?? null;
}

/**
 * Læser `potentialView` fra et estimat, en rapport eller en projektion. null =
 * feltet mangler (slukket flag) eller er ugyldigt; så viser fladen sin gamle gren
 * frem for at gætte på en tilstand.
 */
export function potentialViewOf(source: unknown): PotentialView | null {
  const raw = (source as { potentialView?: unknown } | null | undefined)?.potentialView;
  if (!raw || typeof raw !== "object") return null;
  const view = raw as Record<string, unknown>;
  if (view.hidden === true) {
    if (view.reason === "unscouted") return { hidden: true, reason: "unscouted" };
    if (view.reason === "learning" && finite(view.trainings) && finite(view.trainingsNeeded)) {
      return { hidden: true, reason: "learning", trainings: view.trainings, trainingsNeeded: view.trainingsNeeded };
    }
    return null;
  }
  const certainty = certaintyOf(view.certainty);
  if (view.hidden !== false || !finite(view.value) || !certainty) return null;
  return {
    hidden: false,
    value: view.value,
    certainty,
    previousValue: finite(view.previousValue) ? view.previousValue : null,
    previousCertainty: certaintyOf(view.previousCertainty),
    changedAt: typeof view.changedAt === "string" ? view.changedAt : null,
  };
}

/** Tallet spilleren ser, til sortering og grafer. null for begge tomme tilstande. */
export function potentialViewValue(view: PotentialView | null | undefined): number | null {
  return view && !view.hidden ? view.value : null;
}

/** Hvor mange af måleren tre trin der er fyldt. */
export function certaintyStep(certainty: Certainty): number {
  return CERTAINTIES.indexOf(certainty) + 1;
}

/** Udvikling-fanens kurve mod skønnet, sorteret efter sæson. Tom = ingen linje. */
export function estimateLineOf(projection: unknown): EstimatePoint[] {
  const raw = (projection as { estimateLine?: unknown } | null | undefined)?.estimateLine;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((point): point is EstimatePoint => finite(point?.season) && finite(point?.value))
    .map(({ season, value }) => ({ season, value }))
    .sort((a, b) => a.season - b.season);
}

/**
 * Trænerens ord på Graduation Day med tændt flag: dommen bygger på det viste tal,
 * og kun et sikkert skøn er nok til en endelig dom.
 */
export function coachInputFromView(view: PotentialView): {
  band: { lo: number; hi: number } | null;
  knowledgeStage: "learning" | "final";
} {
  if (view.hidden) return { band: null, knowledgeStage: "learning" };
  return {
    band: { lo: view.value, hi: view.value },
    knowledgeStage: view.certainty === "sure" ? "final" : "learning",
  };
}

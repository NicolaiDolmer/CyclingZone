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
// #8523: "aiTeam" = rytter på et AI-hold uden holdets skøn; han kan ikke scoutes.
export type PotentialViewUnscouted = { hidden: true; reason: "unscouted" };
export type PotentialViewAiTeam = { hidden: true; reason: "aiTeam" };
export type PotentialViewLearning = {
  hidden: true;
  reason: "learning";
  trainings: number;
  trainingsNeeded: number;
};
export type PotentialView = PotentialViewShown | PotentialViewUnscouted | PotentialViewAiTeam | PotentialViewLearning;

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
    if (view.reason === "aiTeam") return { hidden: true, reason: "aiTeam" };
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

// #8523 (spec 2026-11-20 §5): den samlede prognose for egne ryttere, "fortsætter du
// den nuværende fart, ender du omkring her ved toppen". Serveren regner den; feltet
// findes kun for egne ryttere med tændt flag.
// #8604: trend-prognosen bag sin kontakt bærer `basis: "trend"`, `learning` (tallet er usikkert,
// mens det læres på eget hold) og `horizon: "year"` (forbi toppen: forventet rating om et år).
// Ingen bånd. Uden felterne er visningen som før.
export type PrognosisView =
  | { hidden: false; value: number; basis?: "trend"; learning?: true; horizon?: "year" }
  | { hidden: true; reason: "noEstimate" | "pastPeak" };

/** Læser `prognosisView`. null = feltet mangler (andres rytter eller slukket flag). */
export function prognosisViewOf(source: unknown): PrognosisView | null {
  const raw = (source as { prognosisView?: unknown } | null | undefined)?.prognosisView;
  if (!raw || typeof raw !== "object") return null;
  const view = raw as Record<string, unknown>;
  if (view.hidden === false && finite(view.value)) {
    return {
      hidden: false,
      value: view.value,
      ...(view.basis === "trend" ? { basis: "trend" as const } : {}),
      ...(view.learning === true ? { learning: true as const } : {}),
      ...(view.horizon === "year" ? { horizon: "year" as const } : {}),
    };
  }
  if (view.hidden === true && (view.reason === "noEstimate" || view.reason === "pastPeak")) {
    return { hidden: true, reason: view.reason };
  }
  return null;
}

/** Tooltip-nøglen til prognosen. Den gamle fart-prognose beholder sin tekst. */
export function prognosisTitleKey(view: PrognosisView): string {
  if (view.hidden) {
    return view.reason === "pastPeak" ? "riders:potentialNumber.prognosisPastPeakTitle" : "riders:potentialNumber.prognosisNoEstimateTitle";
  }
  if (view.learning) return "riders:potentialNumber.prognosisLearningTitle";
  if (view.horizon === "year") return "riders:potentialNumber.prognosisYearTitle";
  return view.basis === "trend" ? "riders:potentialNumber.prognosisTrendTitle" : "riders:potentialNumber.prognosisTitle";
}

/** Prognosen som sorteringsværdi. null for begge tomme tilstande, så de falder sidst. */
export function prognosisViewValue(view: PrognosisView | null | undefined): number | null {
  return view && !view.hidden ? view.value : null;
}

/** Tallet spilleren ser, til sortering og grafer. null for begge tomme tilstande. */
export function potentialViewValue(view: PotentialView | null | undefined): number | null {
  return view && !view.hidden ? view.value : null;
}

/** Hvor mange af måleren tre trin der er fyldt. */
export function certaintyStep(certainty: Certainty): number {
  return CERTAINTIES.indexOf(certainty) + 1;
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

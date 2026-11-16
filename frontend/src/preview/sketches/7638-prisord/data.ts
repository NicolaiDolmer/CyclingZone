// Syntetiske data til prisord-skitsen (#7638). Ingen rigtige hold, managere eller balance-tal.
// Prisordene for indsatstrin og ordreknapper kommer fra spillets egen model (samme kilde som
// etapeplanen), så skitsen kan ikke vise et andet ord end spillet ville. Kun udbrudsholdningen
// har ikke et prisord i koden i dag; dens forslag står i STANCE_PRICE og er markeret som åbent.
import da from "../../../../public/locales/da/races.json";
import { EFFORT_COST_WORD, taskCostWord, type TaskCostWord } from "../../../components/race/tacticsReady7864.ts";

export type Variant = { id: "a" | "b" | "c"; letter: string; name: string; line: string; recommended?: boolean };

export const VARIANTS: readonly Variant[] = [
  {
    id: "a",
    letter: "A",
    name: "Ordet i knappen",
    line: "Prisordet står i selve knappen, efter navnet og i dæmpet tekst, præcis som på etapeplanens opgaver.",
    recommended: true,
  },
  {
    id: "b",
    letter: "B",
    name: "Ord og trappe",
    line: "Samme ord som A plus en lille trappe med fire firkanter, så man kan sammenligne prisen uden at læse.",
  },
  {
    id: "c",
    letter: "C",
    name: "Ordet i forklaringen",
    line: "Knapperne er som i dag; prisordet står i en linje under eller ved siden af valget.",
  },
];

export function variantById(id: string | null): Variant | null {
  return VARIANTS.find((v) => v.id === id) ?? null;
}

export const T = {
  price: da.stagePlanReady.price as Record<TaskCostWord, string>,
  step: da.intention.step as Record<string, string>,
  why: da.intention.why as Record<string, string>,
  whyIttSave: da.intention.whyItt.save,
  stance: da.tacticsOrders.ordersGc.stance as Record<Stance, string>,
  stanceLabel: da.tacticsOrders.ordersGc.stanceLabel,
  gcNote: da.tacticsOrders.ordersGc.gcNote,
  tryBreak: da.tacticsOrders.tryBreak,
  leadout: da.tacticsOrders.leadout,
  planLabel: da.tacticsOrders.planLabel,
};

/** Rækkefølgen på et prisord, så trappen i variant B kan tegnes. Kun visning, ingen motorværdi. */
export const PRICE_LEVEL: Readonly<Record<TaskCostWord, 1 | 2 | 3 | 4>> = { easy: 1, medium: 2, hard: 3, veryHard: 4 };

// 1) Enkeltstartens trin: spillets egne trin på en enkeltstart (grupetto og arbejd findes ikke dér).
export const ITT_STEPS = ["save", "normal", "all_out"] as const;
export type IttStep = (typeof ITT_STEPS)[number];
export const ittPrice = (step: IttStep): TaskCostWord => EFFORT_COST_WORD[step];
export const ittWhy = (step: IttStep): string => (step === "save" ? T.whyIttSave : T.why[step]);

// 2) Udbrudsholdningen. FORSLAG, ikke i koden: prisen gælder de ryttere, der jager.
export type Stance = "chase" | "neutral" | "let_go";
export const STANCES: readonly Stance[] = ["chase", "neutral", "let_go"];
export const STANCE_PRICE: Readonly<Record<Stance, TaskCostWord>> = { chase: "hard", neutral: "medium", let_go: "easy" };

// 3) De gamle ordreknapper: samme opgaver som i etapeplanen (udbrud og sprinttog).
export const TOGGLE_PRICE = { tryBreak: taskCostWord("breakaway"), leadout: taskCostWord("sprint_train") } as const;

export type SketchRider = { id: string; name: string; role: string; effort: IttStep; tryBreak?: boolean; leadout?: boolean; sprintCaptain?: boolean };

export const ITT_RIDERS: readonly SketchRider[] = [
  { id: "r1", name: "Mads Kjærgaard", role: "Kaptajn", effort: "all_out" },
  { id: "r2", name: "Tobias Lindqvist", role: "Hjælper", effort: "save" },
  { id: "r3", name: "Elias Brandt", role: "Fri rolle", effort: "normal" },
  { id: "r4", name: "Jonas Vermeer", role: "Hjælper", effort: "save" },
];
/** Rytteren hvis vælger står åben i skitsen. */
export const ITT_OPEN = "r3";

export const ORDER_RIDERS: readonly SketchRider[] = [
  { id: "o1", name: "Lucas Moreau", role: "Spurt-kaptajn", effort: "normal", sprintCaptain: true },
  { id: "o2", name: "Tobias Lindqvist", role: "Hjælper", effort: "normal", leadout: true },
  { id: "o3", name: "Jonas Vermeer", role: "Hjælper", effort: "normal", leadout: true },
  { id: "o4", name: "Elias Brandt", role: "Fri rolle", effort: "normal", tryBreak: true },
];

export const PLAN_LINE = "Mads Kjærgaard er kaptajn. Holdet aflæser løbet undervejs.";
export const TRAIN_LINE = "2 ryttere kører sprint-tog for Lucas Moreau.";

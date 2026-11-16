// #7535 valg-skitser: ÉN trup, ÉT løb og ÉN løbsliste, som alle 24 varianter tegner fra.
// Ejeren så sidst forskellige ryttere i Trup og Taktik (taktik kom fra løbssidens seed);
// her er der kun denne ene liste, så samme seks ryttere står i hver visning.
// Alle navne og tal er syntetiske preview-data, intet er motorens værdier. Prisen for
// en formtop og for en etapeplan står i ord, aldrig som tal.

export type StageKind = "flat" | "hilly" | "mountain" | "itt";

export interface Stage {
  n: number;
  kind: StageKind;
  km: number;
  gain: number;
  climbs: number;
  label: string;
  /** Etapens taktik: gemt af manageren eller rollens standard. */
  tactic: "saved" | "default";
}

export interface Rider {
  id: string;
  name: string;
  nation: string;
  type: string;
  u23?: boolean;
  rating: number;
  form: number;
  fatigue: number;
  /** Forventet ekstra træthed ved mål på sidste etape ved den gemte plan. */
  finishDelta: number;
  routeMatch: number;
  selected: boolean;
  role?: string;
  /** Etape 1-planen som chips: [opgave, indsats] pr. del af etapen. */
  plan?: Array<[string, string]>;
  /** Hvad planen koster i ord. */
  planCost?: string;
  /** Andet løb samme dage. */
  busy?: string;
  injured?: string;
  peak?: { race: string; when: string; cost: string; here: boolean };
}

export const RACE = {
  name: "Tour de Preview",
  meta: "Starter tirs. 17. nov., 12.00 · om 26 t · ProSeries · 4 etaper",
  shares: "Deler løbsdage med Omloop van de Denderstreek og Grand Prix de Wallonie",
  squadSize: 6,
};

export const STAGES: Stage[] = [
  { n: 1, kind: "flat", km: 190, gain: 268, climbs: 1, label: "Flad", tactic: "saved" },
  { n: 2, kind: "hilly", km: 168, gain: 2140, climbs: 5, label: "Kuperet", tactic: "default" },
  { n: 3, kind: "mountain", km: 176, gain: 3820, climbs: 4, label: "Bjerg", tactic: "default" },
  { n: 4, kind: "itt", km: 28, gain: 310, climbs: 0, label: "Enkeltstart", tactic: "default" },
];

const lead: Array<[string, string]> = [["Hold lederen fremme", "Middel"]];

export const RIDERS: Rider[] = [
  { id: "r1", name: "Nebiyu Berhane", nation: "er", type: "Klatrer", rating: 71, form: 72, fatigue: 30, finishDelta: 18, routeMatch: 61, selected: true, role: "Kaptajn", plan: [["Bliv i læ", "Let"], ["Følg de bedste", "Hård"]], planCost: "Sparer kræfter", peak: { race: "Vuelta a Navarra", when: "søn. 22. nov. · om 6 dage", cost: "lille formdyk bagefter", here: false } },
  { id: "r2", name: "Raul Gil", nation: "es", type: "Klatrer", rating: 73, form: 66, fatigue: 22, finishDelta: 21, routeMatch: 61, selected: true, role: "Hjælper", plan: lead, planCost: "Koster en del", peak: { race: "Tour du Jura", when: "man. 30. nov. · om 14 dage", cost: "lille formdyk bagefter", here: false } },
  { id: "r3", name: "Nicolas Sanz", nation: "es", type: "Klatrer", rating: 71, form: 62, fatigue: 18, finishDelta: 20, routeMatch: 61, selected: true, role: "Hjælper", plan: lead, planCost: "Koster en del" },
  { id: "r4", name: "Hajun Pyo", nation: "kr", type: "Enkeltstart", rating: 73, form: 74, fatigue: 29, finishDelta: 16, routeMatch: 60, selected: true, role: "Hjælper", plan: lead, planCost: "Koster en del", peak: { race: "Tour de Preview", when: "tirs. 17. nov. · om 1 dag", cost: "mærkbart formdyk bagefter", here: true } },
  { id: "r5", name: "Robbe Bos", nation: "be", type: "Rouleur", rating: 69, form: 72, fatigue: 27, finishDelta: 22, routeMatch: 59, selected: true, role: "Hjælper", plan: [["Træk feltet", "Hård"]], planCost: "Koster meget" },
  { id: "r6", name: "Zhen Ren", nation: "cn", type: "Sprinter", rating: 72, form: 72, fatigue: 30, finishDelta: 14, routeMatch: 58, selected: true, role: "Spurtkaptajn", plan: [["Bliv i læ", "Let"], ["Spurt", "Meget hård"]], planCost: "Sparer kræfter" },
  { id: "r7", name: "Ignacio Moreno", nation: "es", type: "Puncheur", rating: 67, form: 74, fatigue: 38, finishDelta: 19, routeMatch: 58, selected: false, peak: { race: "Tour de Preview", when: "tirs. 17. nov. · om 1 dag", cost: "lille formdyk bagefter", here: true } },
  { id: "r8", name: "Wilson Maldonado", nation: "co", type: "Klatrer", rating: 73, form: 64, fatigue: 29, finishDelta: 21, routeMatch: 56, selected: false },
  { id: "r9", name: "Jonas Baumann", nation: "de", type: "Puncheur", rating: 68, form: 72, fatigue: 29, finishDelta: 18, routeMatch: 56, selected: false, busy: "I Omloop" },
  { id: "r10", name: "Abdel Jaziri", nation: "tn", type: "Rouleur", rating: 68, form: 62, fatigue: 20, finishDelta: 20, routeMatch: 55, selected: false },
  { id: "r11", name: "Fei Fu", nation: "cn", type: "Sprinter", u23: true, rating: 73, form: 72, fatigue: 26, finishDelta: 17, routeMatch: 54, selected: false },
  { id: "r12", name: "Riad Zerouali", nation: "ma", type: "Sprinter", rating: 67, form: 72, fatigue: 30, finishDelta: 18, routeMatch: 54, selected: false },
  { id: "r13", name: "Rik Maes", nation: "be", type: "Puncheur", u23: true, rating: 67, form: 70, fatigue: 25, finishDelta: 18, routeMatch: 53, selected: false, busy: "I Wallonie" },
  { id: "r14", name: "Joaquin Ibarra", nation: "ar", type: "Klatrer", rating: 69, form: 70, fatigue: 26, finishDelta: 19, routeMatch: 52, selected: false, injured: "Skadet · rask igen 20. nov." },
];

export const SELECTED = RIDERS.filter((r) => r.selected);

export type TacticStatus = "saved" | "partial" | "default" | "unsaved";

export interface ListRace {
  id: string;
  name: string;
  date: string;
  meta: string;
  stages: StageKind[];
  picked: number;
  size: number;
  tactic: TacticStatus;
  tacticNote?: string;
  peakRiders?: number;
  shares?: string;
}

export const LIST: ListRace[] = [
  { id: "piceno", name: "Giro del Piceno", date: "man. 16. nov.", meta: "Klasse 1 · endagsløb", stages: ["hilly"], picked: 6, size: 6, tactic: "saved" },
  { id: "omloop", name: "Omloop van de Denderstreek", date: "tirs. 17. nov.", meta: "Klasse 2 · endagsløb", stages: ["flat"], picked: 3, size: 6, tactic: "unsaved", shares: "Deler løbsdage med Tour de Preview" },
  { id: "preview", name: "Tour de Preview", date: "tirs. 17.–fre. 20. nov.", meta: "ProSeries · 4 etaper", stages: ["flat", "hilly", "mountain", "itt"], picked: 6, size: 6, tactic: "partial", tacticNote: "1 af 4 gemt", peakRiders: 2, shares: "Deler løbsdage med Omloop, Wallonie" },
  { id: "wallonie", name: "Grand Prix de Wallonie", date: "tors. 19. nov.", meta: "Klasse 1 · endagsløb", stages: ["hilly"], picked: 5, size: 6, tactic: "default", shares: "Deler løbsdage med Tour de Preview" },
  { id: "rovigo", name: "Gran Premio di Rovigo", date: "lør. 21. nov.", meta: "Klasse 1 · endagsløb", stages: ["flat"], picked: 0, size: 6, tactic: "unsaved" },
  { id: "navarra", name: "Vuelta a Navarra", date: "søn. 22.–26. nov.", meta: "ProSeries · 5 etaper", stages: ["hilly", "flat", "mountain", "mountain", "itt"], picked: 1, size: 6, tactic: "unsaved", peakRiders: 1 },
];

export const WEEK = [
  { day: "Man.", date: "16. nov.", races: [{ name: "Giro del Piceno", picked: "6/6", ok: true, span: 1 }] },
  { day: "Tirs.", date: "17. nov.", races: [{ name: "Omloop van d…", picked: "3/6", ok: false, span: 1 }, { name: "Tour de Preview", picked: "6/6", ok: true, span: 4, active: true }] },
  { day: "Ons.", date: "18. nov.", races: [] },
  { day: "Tors.", date: "19. nov.", races: [{ name: "Grand Prix de W…", picked: "5/6", ok: false, span: 1 }] },
  { day: "Fre.", date: "20. nov.", races: [] },
  { day: "Lør.", date: "21. nov.", races: [{ name: "Gran Premio di R…", picked: "0/6", ok: false, span: 1 }] },
  { day: "Søn.", date: "22. nov.", races: [{ name: "Vuelta a Navarra", picked: "1/6", ok: false, span: 1 }] },
];

/** Antal løb i listen der mangler trup, og der mangler taktik (til 3B's underlinje). */
export function listCounts(list: ListRace[] = LIST): { squad: number; tactic: number } {
  return {
    squad: list.filter((r) => r.picked < r.size).length,
    tactic: list.filter((r) => r.tactic === "unsaved").length,
  };
}

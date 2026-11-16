// #5101 skitse: tekster. EN foerst, DA under (sprogprioritet). Ordene for trin,
// skiftpunkter og markeringer er dem Taktik allerede bruger i races.json.

import type { Lang } from "./data.ts";

export type VariantId = "now" | "a" | "b" | "c";

type Copy = {
  sketch: string;
  recommended: string;
  variants: Record<VariantId, { name: string; line: string }>;
  raceName: string;
  raceMeta: string;
  tabs: string[];
  activeTab: number;
  sectionTitle: string;
  sectionMeta: string;
  intro: string;
  introToday: string;
  colRider: string;
  colOrder: string;
  colDid: string;
  colWhy: string;
  colPlan: string;
  colRecord: string;
  step: (n: number) => string;
  km: (km: number) => string;
  startedAt: (km: number) => string;
  planned: (from: string) => string;
  notSeen: string;
  notReached: string;
  noMoments: string;
  noPlan: string;
  rodeOnRole: string;
  change: string;
  noChange: string;
  unknownReason: string;
  events: (n: number) => string;
  finish: string;
  legendPlan: string;
  legendEvents: string;
  legendClimb: string;
  stageFinish: string;
  rider: (n: number) => string;
};

const EN: Copy = {
  sketch: "Sketch #5101",
  recommended: "Recommended",
  variants: {
    now: {
      name: "Today · plan against the record",
      line: "This is Taktik on a ridden stage today behind race_page_v6: each step next to the record, but no list of moments and no reason for the switch.",
    },
    a: {
      name: "A · Three questions in one row",
      line: "Each rider is one row with three columns: the order you gave, what he did (2-4 moments with km), and why the plan switched.",
    },
    b: {
      name: "B · Route strip",
      line: "Each rider gets the stage profile in small: the plan's steps as bands under the route, the moments as numbered dots, the switch marked at its km.",
    },
    c: {
      name: "C · Plan first, open for detail",
      line: "The order stands as a chain per rider with the switch and its reason on one line; open a rider to see the moments under the step they belong to.",
    },
  },
  raceName: "Giro di Prova",
  raceMeta: "Stage race · 7 stages · fictional data",
  tabs: ["Results", "Story", "Tactics", "Start list", "Team"],
  activeTab: 2,
  sectionTitle: "Your plan against what happened",
  sectionMeta: "Stage 4 · 6 riders",
  intro: "The order you gave, what he did, and why the plan switched. Not seen is not failed.",
  introToday: "Each step of your plan next to what the stage record shows. A step with nothing in the record is marked not seen. That does not mean it failed.",
  colRider: "Rider",
  colOrder: "The order",
  colDid: "What he did",
  colWhy: "Why the plan switched",
  colPlan: "Your plan",
  colRecord: "What the record shows",
  step: (n) => `Step ${n}`,
  km: (km) => `km ${km}`,
  startedAt: (km) => `started at km ${km}`,
  planned: (from) => `plan: ${from}`,
  notSeen: "Not seen in the record",
  notReached: "Not reached",
  noMoments: "No moments of his own in this step",
  noPlan: "No saved plan",
  rodeOnRole: "He rode on his role",
  change: "Switch",
  noChange: "No switch",
  unknownReason: "Reason not in the record",
  events: (n) => `${n} moments from the race film`,
  finish: "Finish",
  legendPlan: "Plan steps",
  legendEvents: "Moments",
  legendClimb: "Categorised climb",
  stageFinish: "Finish",
  rider: (n) => `Rider ${n}`,
};

const DA: Copy = {
  sketch: "Skitse #5101",
  recommended: "Anbefalet",
  variants: {
    now: {
      name: "Nu · plan mod optegnelsen",
      line: "Sådan ser Taktik på en kørt etape ud i dag bag race_page_v6: hvert trin ved siden af optegnelsen, men ingen liste over øjeblikke og ingen årsag til skiftet.",
    },
    a: {
      name: "A · Tre spørgsmål på én række",
      line: "Hver rytter er én række med tre kolonner: ordren du gav, hvad han gjorde (2-4 øjeblikke med km) og hvorfor planen skiftede.",
    },
    b: {
      name: "B · Rute-strimmel",
      line: "Hver rytter får etapens profil i lille format: planens trin som bånd under ruten, øjeblikkene som nummererede prikker og skiftet markeret på sin km.",
    },
    c: {
      name: "C · Planen først, fold ud",
      line: "Ordren står som en kæde pr. rytter med skiftet og årsagen på én linje; fold en rytter ud for at se øjeblikkene under det trin, de hører til.",
    },
  },
  raceName: "Giro di Prova",
  raceMeta: "Etapeløb · 7 etaper · opdigtede data",
  tabs: ["Resultater", "Historie", "Taktik", "Startliste", "Hold"],
  activeTab: 2,
  sectionTitle: "Din plan mod det der skete",
  sectionMeta: "Etape 4 · 6 ryttere",
  intro: "Ordren du gav, hvad han gjorde, og hvorfor planen skiftede. Ikke set er ikke mislykket.",
  introToday: "Hvert trin i din plan ved siden af det, etapens optegnelse viser. Et trin uden noget i optegnelsen står som ikke set. Det betyder ikke, at det mislykkedes.",
  colRider: "Rytter",
  colOrder: "Ordren",
  colDid: "Hvad han gjorde",
  colWhy: "Hvorfor planen skiftede",
  colPlan: "Din plan",
  colRecord: "Det optegnelsen viser",
  step: (n) => `Trin ${n}`,
  km: (km) => `km ${km}`,
  startedAt: (km) => `begyndte ved km ${km}`,
  planned: (from) => `plan: ${from}`,
  notSeen: "Ikke set i optegnelsen",
  notReached: "Ikke nået",
  noMoments: "Ingen egne øjeblikke i dette trin",
  noPlan: "Ingen gemt plan",
  rodeOnRole: "Han kørte på sin rolle",
  change: "Skift",
  noChange: "Intet skift",
  unknownReason: "Årsagen står ikke i optegnelsen",
  events: (n) => `${n} øjeblikke fra løbsfilmen`,
  finish: "Mål",
  legendPlan: "Planens trin",
  legendEvents: "Øjeblikke",
  legendClimb: "Kategoriseret stigning",
  stageFinish: "Mål",
  rider: (n) => `Rytter ${n}`,
};

export const COPY: Record<Lang, Copy> = { en: EN, da: DA };

// #5101 skitse: syntetisk etape og seks egne ryttere. Ingen rigtige ryttere,
// hold, managers eller stigninger. Navnene er "Rytter 1-6", stigningerne er
// opdigtede, og alle km, tidsgab og point er sat i haanden, saa kortet ligner en
// rigtig dag i bjergene. Intet her er laest fra motoren eller databasen.
//
// Ordforraadet foelger det, Taktik allerede bruger (stagePlan.task / from /
// recap i races.json), saa skitsen ikke opfinder nye ord for de samme ting.

export type Lang = "en" | "da";
export type Txt = { en: string; da: string };

/** Samme markeringer som planVsActualModel.ts (valg 11 og 14 paa #7778). */
export type StepMark = "seen" | "differs" | "fact" | "not_reached" | "not_seen";

export type PlanStep = {
  task: Txt;
  /** Hvornaar trinnet skulle starte ifoelge planen; null = fra start. */
  plannedFrom: Txt | null;
  /** Hvor trinnet faktisk startede, naar det afviger fra planen. */
  actualFromKm: number | null;
  mark: StepMark;
  /** Km-interval paa ruten, hvor trinnet var aktivt (til rute-strimlen). */
  span: [number, number] | null;
};

export type RideEvent = {
  km: number;
  text: Txt;
  /** Den haendelse der fik planen til at skifte. */
  trigger?: boolean;
};

/**
 * Hvorfor planen skiftede. `source` siger hvor sikkert det er:
 *   record  = optegnelsen viser aarsagen direkte (fx "sat ved km 118")
 *   none    = planen skiftede ikke (kaeden gik som planlagt)
 *   unknown = optegnelsen viser ingen aarsag; vises som ukendt, aldrig som fejl
 */
export type ChangeReason = {
  source: "record" | "none" | "unknown";
  km: number | null;
  text: Txt;
};

export type SketchRider = {
  id: string;
  no: number;
  role: Txt;
  /** false = holdet gemte ingen plan; han koerte paa sin rolle. */
  planned: boolean;
  steps: PlanStep[];
  events: RideEvent[];
  change: ChangeReason;
  finish: Txt;
};

export type Climb = { name: string; cat: Txt; crestKm: number; lengthKm: number };

export const STAGE = {
  number: 4,
  lengthKm: 172,
  type: { en: "Mountain · summit finish", da: "Bjerg · topankomst" } as Txt,
  climbs: [
    { name: "Passo Rocca", cat: { en: "Cat. 2", da: "Kat. 2" }, crestKm: 64, lengthKm: 7.4 },
    { name: "Colle Ferro", cat: { en: "Cat. 1", da: "Kat. 1" }, crestKm: 131, lengthKm: 11.2 },
    { name: "Monte Calvo", cat: { en: "HC", da: "HC" }, crestKm: 172, lengthKm: 14.6 },
  ] as Climb[],
  sprintKm: 92,
  // Hoejdeprofil (km, m) til den lille rute-strimmel. Haandtegnet, ikke rigtige data.
  profile: [
    [0, 320], [20, 360], [40, 420], [56.6, 520], [64, 1180], [72, 760], [86, 540], [92, 500],
    [104, 560], [119.8, 760], [131, 1640], [140, 1120], [150, 860], [157.4, 900], [172, 2040],
  ] as Array<[number, number]>,
};

const t = (en: string, da: string): Txt => ({ en, da });

export const RIDERS: SketchRider[] = [
  {
    id: "r1",
    no: 1,
    role: t("Captain", "Kaptajn"),
    planned: true,
    steps: [
      { task: t("Stay sheltered", "Bliv i læ"), plannedFrom: null, actualFromKm: null, mark: "seen", span: [0, 131] },
      { task: t("Attack", "Angrib"), plannedFrom: t("after Colle Ferro", "efter Colle Ferro"), actualFromKm: null, mark: "differs", span: [131, 166] },
      { task: t("Ride for a result", "Kør for resultat"), plannedFrom: t("when dropped", "når han er sat"), actualFromKm: 166, mark: "fact", span: [166, 172] },
    ],
    events: [
      { km: 131, text: t("Over Colle Ferro in the front group of 14", "Over Colle Ferro i forreste gruppe på 14") },
      { km: 158, text: t("Attacks at the foot of Monte Calvo", "Angriber ved foden af Monte Calvo") },
      { km: 166, text: t("Runs empty after the attack and is dropped", "Løber tør efter angrebet og bliver sat"), trigger: true },
      { km: 172, text: t("Finished no. 7, +0:48", "Nr. 7 i mål, +0:48") },
    ],
    change: {
      source: "record",
      km: 166,
      text: t("Ran empty 6 km from the line, so the attack ended there", "Løb tør 6 km fra mål, så angrebet sluttede dér"),
    },
    finish: t("No. 7 · +0:48", "Nr. 7 · +0:48"),
  },
  {
    id: "r2",
    no: 2,
    role: t("Domestique", "Hjælper"),
    planned: true,
    steps: [
      { task: t("Keep the leader up front", "Hold lederen fremme"), plannedFrom: null, actualFromKm: null, mark: "seen", span: [0, 124] },
      { task: t("Ride in easy", "Kør roligt i mål"), plannedFrom: t("last 10 km", "sidste 10 km"), actualFromKm: 124, mark: "seen", span: [124, 172] },
    ],
    events: [
      { km: 48, text: t("Closes the gap to a move with the captain on his wheel", "Lukker hullet til et angreb med kaptajnen på hjul") },
      { km: 82, text: t("Sets the pace on the front for 38 km", "Kører tempo forrest i feltet i 38 km") },
      { km: 124, text: t("Dropped on Colle Ferro", "Sat på Colle Ferro"), trigger: true },
      { km: 172, text: t("Finished no. 61, +19:02", "Nr. 61 i mål, +19:02") },
    ],
    change: {
      source: "record",
      km: 124,
      text: t("Dropped on Colle Ferro, so step 2 started 38 km early", "Sat på Colle Ferro, så trin 2 begyndte 38 km før planen"),
    },
    finish: t("No. 61 · +19:02", "Nr. 61 · +19:02"),
  },
  {
    id: "r3",
    no: 3,
    role: t("Breakaway rider", "Udbrudsrytter"),
    planned: true,
    steps: [
      { task: t("Go in the break", "Gå i udbrud"), plannedFrom: null, actualFromKm: null, mark: "seen", span: [0, 141] },
      { task: t("Ride in easy", "Kør roligt i mål"), plannedFrom: t("when caught", "når han er hentet"), actualFromKm: null, mark: "seen", span: [141, 172] },
    ],
    events: [
      { km: 12, text: t("In the break of 6", "Med i udbruddet på 6") },
      { km: 64, text: t("2nd over Passo Rocca, 3 KOM points", "Nr. 2 over Passo Rocca, 3 bjergpoint") },
      { km: 92, text: t("1st at the intermediate sprint, 20 pts", "Nr. 1 i mellemspurten, 20 point") },
      { km: 141, text: t("Caught by the bunch", "Hentet af feltet"), trigger: true },
    ],
    change: {
      source: "record",
      km: 141,
      text: t("Caught at km 141, as the plan said", "Hentet ved km 141, som planen sagde"),
    },
    finish: t("No. 48 · +14:30", "Nr. 48 · +14:30"),
  },
  {
    id: "r4",
    no: 4,
    role: t("Sprinter", "Sprinter"),
    planned: true,
    steps: [
      { task: t("Grupetto", "Grupetto"), plannedFrom: null, actualFromKm: null, mark: "seen", span: [0, 172] },
    ],
    events: [
      { km: 66, text: t("In the grupetto from Passo Rocca", "I grupettoen fra Passo Rocca") },
      { km: 172, text: t("Finished inside the time limit, +24:10", "I mål inden for tidsgrænsen, +24:10") },
    ],
    change: {
      source: "none",
      km: null,
      text: t("No change. One step all day", "Intet skift. Ét trin hele dagen"),
    },
    finish: t("No. 97 · +24:10", "Nr. 97 · +24:10"),
  },
  {
    id: "r5",
    no: 5,
    role: t("Domestique", "Hjælper"),
    planned: true,
    steps: [
      { task: t("Follow the moves", "Følg angrebene"), plannedFrom: null, actualFromKm: null, mark: "not_seen", span: [0, 162] },
      { task: t("Ride in easy", "Kør roligt i mål"), plannedFrom: t("last 10 km", "sidste 10 km"), actualFromKm: null, mark: "seen", span: [162, 172] },
    ],
    events: [
      { km: 131, text: t("Over Colle Ferro in the second group", "Over Colle Ferro i anden gruppe") },
      { km: 172, text: t("Finished no. 33, +6:15", "Nr. 33 i mål, +6:15") },
    ],
    change: {
      source: "unknown",
      km: null,
      text: t("The record shows no move for him to follow. Not seen is not failed", "Optegnelsen viser intet angreb, han kunne følge. Ikke set er ikke mislykket"),
    },
    finish: t("No. 33 · +6:15", "Nr. 33 · +6:15"),
  },
  {
    id: "r6",
    no: 6,
    role: t("Domestique", "Hjælper"),
    planned: false,
    steps: [],
    events: [
      { km: 64, text: t("Over Passo Rocca with the bunch", "Over Passo Rocca med feltet") },
      { km: 127, text: t("Lost contact on Colle Ferro", "Mistede kontakten på Colle Ferro") },
      { km: 172, text: t("Finished no. 74, +21:40", "Nr. 74 i mål, +21:40") },
    ],
    change: {
      source: "none",
      km: null,
      text: t("No saved plan. He rode on his role", "Ingen gemt plan. Han kørte på sin rolle"),
    },
    finish: t("No. 74 · +21:40", "Nr. 74 · +21:40"),
  },
];

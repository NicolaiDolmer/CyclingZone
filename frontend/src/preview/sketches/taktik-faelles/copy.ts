// #7535 skitse: al tekst paa siden, EN og DA. Opgavenavne, prisord, holdplaner,
// udbrudsvalg og gem-ord er spillets egne (races.json), saa skitsen taler samme
// sprog som det byggede. Nyt er kun: Haard/Normal/Let (valg 16), "I aften" (T5)
// og ordene om planlaegningssidens visninger.

import type { StagePlanTask } from "../../../components/race/StagePlanModel.ts";
import type { TaskCostWord } from "../../../components/race/tacticsReady7864.ts";
import type { Effort, Lang, RoleKey, Stance, TeamPlanKey, Tonight } from "./data.ts";

export type ViewId = "race" | "plan";
type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type Copy = {
  sketch: string;
  recommended: string;
  views: Record<ViewId, { tab: string; name: string; line: string }>;
  shared: string;
  task: Record<StagePlanTask, string>;
  price: Record<TaskCostWord, string>;
  role: Record<RoleKey, string>;
  effort: Record<Effort, string>;
  effortLabel: string;
  tonight: Record<Tonight, string>;
  teamPlan: Record<TeamPlanKey, { name: string; named?: (n: string) => string; desc: string }>;
  teamPlanLabel: string;
  stance: Record<Stance, string>;
  stanceLabel: string;
  stanceNote: string;
  from: { kom: (c: string) => string; final_km: string; dropped: string; caught: string };
  col: { rider: string; role: string; rating: string; form: string; fatigue: string; match: string; effort: string; plan: string; tonight: string };
  short: { rating: string; form: string; fatigue: string; match: string };
  routeAxis: (km: number) => string;
  suggestion: string;
  suggestionWhy: string;
  change: string;
  editPlan: string;
  editTitle: (n: string) => string;
  step: (n: number) => string;
  switchAt: string;
  task1: string;
  addStep: string;
  useSuggestion: string;
  clearPlan: string;
  done: string;
  close: string;
  priceNote: string;
  rulesNote: string;
  legendDarker: string;
  legendOpen: string;
  saveStage: (n: number) => string;
  copyTo: (n: number) => string;
  notSaved: string;
  saved: string;
  defaultPlan: string;
  ifNothing: string;
  locks: (t: string) => string;
  day: Record<Day, string>;
  stage: (n: number) => string;
  stageOf: (n: number, total: number) => string;
  race: { tabs: string[]; meta: string; stats: Array<[string, string]>; hideRoute: string; ridden: string };
  plan: {
    title: string; subtitle: string; nav: string[]; next7: string; views: string[]; saveTactics: string;
    squad: string; tactics: string; squadOk: string; squadMissing: string; weekLine: string; showProfile: string; oneDay: string; stages: (n: number) => string;
    raceMeta: string;
  };
  stateWord: Record<"ridden" | "unsaved" | "default" | "saved", string>;
};

export const COPY: Record<Lang, Copy> = {
  en: {
    sketch: "Sketch #7535",
    recommended: "Same component",
    views: {
      race: { tab: "Race page · Tactics", name: "One tactics panel · on the race page", line: "The race page's Tactics tab and the planning page share one panel: team plan, chase choice and a row or card per rider with Hard, Normal or Easy and the plan along the route; the gold save stays in the header." },
      plan: { tab: "Planning · Tactics", name: "One tactics panel · on the planning page", line: "The same panel inside the planning page's Tactics view: it narrows to the column it gets, the rating, form and fatigue fold into one line, and the gold button in the race header saves tactics." },
    },
    shared: "Shared: TacticsPanel",
    task: { breakaway: "Go in the break", stay_sheltered: "Stay sheltered", shelter_leader: "Keep the leader up front", tempo: "Set the tempo", follow_moves: "Follow the moves", attack: "Attack", ride_for_result: "Ride for a result", sprint_train: "Sprint train", grupetto: "Grupetto", ride_in: "Ride in easy", hunt_points: "Go for sprint points", hunt_kom: "Go for KOM points" },
    price: { easy: "Easy", medium: "Medium", hard: "Hard", veryHard: "Very hard" },
    role: { captain: "Captain", co_captain: "Co-captain", sprint_captain: "Sprint captain", helper: "Domestique", hunter: "Hunter", free_role: "Free role" },
    effort: { hard: "Hard", normal: "Normal", easy: "Easy" },
    effortLabel: "Effort",
    tonight: { fresh: "Fresh", ok: "OK", tired: "Tired", very_tired: "Very tired" },
    teamPlan: {
      gc: { name: "Ride for GC", named: (n) => `Ride for GC with ${n}`, desc: "The domestiques ride for your GC leader." },
      stage: { name: "Stage win", desc: "The domestiques work for the rider who suits today's route best." },
      sprint: { name: "Sprint", named: (n) => `Sprint for ${n}`, desc: "The team saves him for the finish, with a train in the last 10 km." },
      break: { name: "Go for the break", desc: "Two riders try the break. The rest ride easy." },
      save: { name: "Save the legs", desc: "Everyone rides in. The lightest of the five plans." },
    },
    teamPlanLabel: "Team plan",
    stance: { chase: "Chase", neutral: "Read the race", let_go: "Leave it to others" },
    stanceLabel: "Chasing the break",
    stanceNote: "Reacts if the break threatens your GC.",
    from: { kom: (c) => `after ${c}`, final_km: "last 10 km", dropped: "when dropped", caught: "when caught" },
    col: { rider: "Rider", role: "Role", rating: "Rating", form: "Form", fatigue: "Fatigue", match: "Route", effort: "Effort", plan: "Plan along the route", tonight: "Tonight" },
    short: { rating: "Rating", form: "Form", fatigue: "Fatigue", match: "Route" },
    routeAxis: (km) => `${km} km`,
    suggestion: "Assistant's suggestion",
    suggestionWhy: "Not saved. He rides this if you do nothing.",
    change: "Change",
    editPlan: "Change plan",
    editTitle: (n) => `Plan for ${n}`,
    step: (n) => `Step ${n}`,
    switchAt: "Switch",
    task1: "Task",
    addStep: "Add a step",
    useSuggestion: "Use the suggestion",
    clearPlan: "Remove the plan",
    done: "Done",
    close: "Close",
    priceNote: "The price is the task's own. Hard, Normal or Easy sets how hard he rides it.",
    rulesNote: "The break can only be the first task. Grupetto, riding in and the sprint train always come last.",
    legendDarker: "Darker = harder task",
    legendOpen: "Open end = switches when it happens",
    saveStage: (n) => `Save stage ${n}`,
    copyTo: (n) => `Copy to stage ${n}`,
    notSaved: "Not saved",
    saved: "Saved",
    defaultPlan: "Default plan",
    ifNothing: "If you do nothing, they ride exactly this.",
    locks: (t) => `Locks ${t}`,
    day: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
    stage: (n) => `Stage ${n}`,
    stageOf: (n, total) => `Stage ${n} of ${total}`,
    race: {
      tabs: ["Stage", "Start list", "Tactics", "Team"],
      meta: "WorldTour · stage race · example data",
      stats: [["Stage", "2 of 7"], ["Terrain", "High mountain"], ["Selected", "7 of 7"], ["Overall", "4th · +0:38"]],
      hideRoute: "Hide route",
      ridden: "4th",
    },
    plan: {
      title: "Planning", subtitle: "Season 5 · next 7 days · example data",
      nav: ["Dashboard", "My team", "Training", "Planning", "Races", "Transfers", "Finance"],
      next7: "Next 7 days", views: ["Squad", "Tactics", "Peak form"], saveTactics: "Save tactics",
      squad: "Squad", tactics: "Tactics", squadOk: "Squad set", squadMissing: "Squad missing",
      weekLine: "2 missing squad · 3 missing tactics", showProfile: "Show profile", oneDay: "one-day", stages: (n) => `${n} stages`,
      raceMeta: "Tue 3/11 · class 2 · 7 stages · 7 of 7 picked",
    },
    stateWord: { ridden: "4th", unsaved: "Not saved", default: "Default plan", saved: "Saved" },
  },
  da: {
    sketch: "Skitse #7535",
    recommended: "Samme komponent",
    views: {
      race: { tab: "Løbsside · Taktik", name: "Ét taktikpanel · på løbssiden", line: "Løbssidens Taktik-fane og planlægningssiden deler ét panel: holdplan, jagtvalg og en række eller et kort pr. rytter med Hård, Normal eller Let og planen langs ruten; guld-knappen til at gemme bliver i hovedet." },
      plan: { tab: "Planlægning · Taktik", name: "Ét taktikpanel · på planlægningssiden", line: "Det samme panel i planlægningssidens Taktik-visning: det tilpasser sig den kolonne, det får, rating, form og træthed samles i én linje, og guld-knappen i løbets hoved gemmer taktikken." },
    },
    shared: "Fælles: TaktikPanel",
    task: { breakaway: "Gå i udbrud", stay_sheltered: "Bliv i læ", shelter_leader: "Hold lederen fremme", tempo: "Kør tempo", follow_moves: "Følg angrebene", attack: "Angrib", ride_for_result: "Kør for resultat", sprint_train: "Sprinttog", grupetto: "Grupetto", ride_in: "Kør roligt i mål", hunt_points: "Hent point i spurterne", hunt_kom: "Hent bjergpoint" },
    price: { easy: "Let", medium: "Middel", hard: "Hård", veryHard: "Meget hård" },
    role: { captain: "Kaptajn", co_captain: "Medkaptajn", sprint_captain: "Spurtkaptajn", helper: "Hjælper", hunter: "Jæger", free_role: "Fri rolle" },
    effort: { hard: "Hård", normal: "Normal", easy: "Let" },
    effortLabel: "Indsats",
    tonight: { fresh: "Frisk", ok: "OK", tired: "Træt", very_tired: "Meget træt" },
    teamPlan: {
      gc: { name: "Kør for klassementet", named: (n) => `Klassement med ${n}`, desc: "Hjælperne kører for klassementsrytteren." },
      stage: { name: "Etapesejr", desc: "Hjælperne kører for den rytter, der passer bedst til dagens rute." },
      sprint: { name: "Spurt", named: (n) => `Spurt til ${n}`, desc: "Holdet sparer spurteren til målet og kører spurttog de sidste 10 km." },
      break: { name: "Gå i udbrud", desc: "To ryttere prøver at komme i udbrud. Resten kører roligt." },
      save: { name: "Spar benene", desc: "Alle kører roligt i mål. Den letteste af de fem planer." },
    },
    teamPlanLabel: "Holdplan",
    stance: { chase: "Jag", neutral: "Vurder undervejs", let_go: "Overlad til andre" },
    stanceLabel: "Jagten på udbruddet",
    stanceNote: "Reagerer, hvis udbruddet truer klassementet.",
    from: { kom: (c) => `efter ${c}`, final_km: "sidste 10 km", dropped: "når han er sat", caught: "når han er hentet" },
    col: { rider: "Rytter", role: "Rolle", rating: "Rating", form: "Form", fatigue: "Træthed", match: "Rute", effort: "Indsats", plan: "Planen langs ruten", tonight: "I aften" },
    short: { rating: "Rating", form: "Form", fatigue: "Træthed", match: "Rute" },
    routeAxis: (km) => `${km} km`,
    suggestion: "Assistentens forslag",
    suggestionWhy: "Ikke gemt. Han kører dette, hvis du intet gør.",
    change: "Ændr",
    editPlan: "Ændr plan",
    editTitle: (n) => `Plan for ${n}`,
    step: (n) => `Trin ${n}`,
    switchAt: "Skift",
    task1: "Opgave",
    addStep: "Tilføj et trin",
    useSuggestion: "Brug forslaget",
    clearPlan: "Fjern planen",
    done: "Færdig",
    close: "Luk",
    priceNote: "Prisen er opgavens egen. Hård, Normal eller Let afgør, hvor hårdt han kører den.",
    rulesNote: "Udbrud kan kun være første opgave. Grupetto, kør i mål og sprinttog kommer altid sidst.",
    legendDarker: "Mørkere = hårdere opgave",
    legendOpen: "Åben ende = skifter, når det sker",
    saveStage: (n) => `Gem etape ${n}`,
    copyTo: (n) => `Kopiér til etape ${n}`,
    notSaved: "Ikke gemt",
    saved: "Gemt",
    defaultPlan: "Standardplan",
    ifNothing: "Gør du intet, kører de præcis dette.",
    locks: (t) => `Låser ${t}`,
    day: { mon: "man", tue: "tir", wed: "ons", thu: "tor", fri: "fre", sat: "lør", sun: "søn" },
    stage: (n) => `Etape ${n}`,
    stageOf: (n, total) => `Etape ${n} af ${total}`,
    race: {
      tabs: ["Etape", "Startliste", "Taktik", "Hold"],
      meta: "WorldTour · etapeløb · eksempeldata",
      stats: [["Etape", "2 af 7"], ["Terræn", "Højt bjerg"], ["Udtaget", "7 af 7"], ["Samlet", "4. · +0:38"]],
      hideRoute: "Skjul rute",
      ridden: "4.",
    },
    plan: {
      title: "Planlægning", subtitle: "Sæson 5 · næste 7 dage · eksempeldata",
      nav: ["Overblik", "Mit hold", "Træning", "Planlægning", "Løb", "Transfers", "Økonomi"],
      next7: "Næste 7 dage", views: ["Trup", "Taktik", "Formtop"], saveTactics: "Gem taktik",
      squad: "Trup", tactics: "Taktik", squadOk: "Trup klar", squadMissing: "Mangler trup",
      weekLine: "2 mangler trup · 3 mangler taktik", showProfile: "Vis profil", oneDay: "endagsløb", stages: (n) => `${n} etaper`,
      raceMeta: "tir 3/11 · klasse 2 · 7 etaper · 7 af 7 udtaget",
    },
    stateWord: { ridden: "4.", unsaved: "Ikke gemt", default: "Standardplan", saved: "Gemt" },
  },
};

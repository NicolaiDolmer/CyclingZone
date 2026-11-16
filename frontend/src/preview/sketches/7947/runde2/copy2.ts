// Tekster til runde 2, EN foerst og DA under. Kun til billederne: ingen noegle
// findes i locales, og intet her er godkendt spillertekst. Traeningsnavnene
// kommer fra runde 1 (../copy.ts), som bruger spillets navne.

import { COPY, type Lang } from "../copy.ts";

export type VariantId = "then" | "d1" | "d2" | "d3" | "d4";

type Banner = { name: string; what: string; taps: string };

type Dict = {
  sketch: string;
  pageTitle: string;
  pageSub: string;
  trainNow: string;
  trainNowNote: string;
  fullRest: string;
  full: string;
  active: string;
  activeLong: string;
  restGroup: string;
  trainGroup: string;
  change: string;
  changeTraining: string;
  saved: string;
  rider: string;
  fatigue: string;
  tonight: string;
  own: string;
  teamDay: string;
  teamDayNote: string;
  restToday: string;
  resting: string;
  followsTeam: string;
  assistantTitle: string;
  assistantNote: string;
  useAll: (n: number) => string;
  assistant: string;
  yours: string;
  reasons: Record<string, string>;
  thenFocus: string;
  thenSeason: string;
  thenProgram: string;
  thenRecovery: string;
  feelTitle: string;
  feelRows: [string, string, string, string, string];
  feel: Record<Exclude<VariantId, "then">, [string, string, string, string, string]>;
  banners: Record<VariantId, Banner>;
};

const en: Dict = {
  sketch: "Sketch #7947, round 2",
  pageTitle: "Training",
  pageSub: "Today",
  trainNow: "Train now",
  trainNowNote: "Unchanged",
  fullRest: "Full rest",
  full: "Full",
  active: "Active",
  activeLong: "Active recovery",
  restGroup: "Rest",
  trainGroup: "Train",
  change: "Change",
  changeTraining: "Change training",
  saved: "Saved",
  rider: "Rider",
  fatigue: "Fatigue",
  tonight: "Fatigue tonight",
  own: "Own training",
  teamDay: "Team day",
  teamDayNote: "Everyone who is not resting rides their own training at this effort.",
  restToday: "Rest today",
  resting: "Resting",
  followsTeam: "follows the team",
  assistantTitle: "The assistant's day",
  assistantNote: "Set from fatigue and each rider's training. Change a rider with one tap.",
  useAll: (n) => `Use all ${n} suggestions`,
  assistant: "Assistant",
  yours: "Your pick",
  reasons: {
    fresh: "fresh",
    tired: "tired after racing",
    veryTired: "very tired",
    overLimit: "over the injury line",
    steady: "steady day",
  },
  thenFocus: "Focus",
  thenSeason: "This season",
  thenProgram: "Program",
  thenRecovery: "Recovery",
  feelTitle: "How it feels",
  feelRows: ["Rest or train", "Active recovery", "Another training", "Whole team", "Save button"],
  feel: {
    d1: ["1 tap", "1 tap", "2 (list in the row)", "Set for several, as today", "None, a tap saves"],
    d2: ["1 tap", "2 taps", "2 (Change, then pick)", "Set for several, as today", "None, a tap saves"],
    d3: ["1 tap for the team, 1 per rider who rests", "2 taps", "2 (list in the row)", "1 tap", "None, a tap saves"],
    d4: ["0 if you accept, 1 to change", "0 if suggested, otherwise 2 taps", "2 (list in the row)", "1 tap", "None, a tap saves"],
  },
  banners: {
    then: {
      name: "The old training page (September to mid October)",
      what: "Rebuilt faithfully from the code, with the training catalog of the time. Desktop until 23/9: three quick buttons per rider, Rest, Active recovery and the rider's own training. Phone from 1/10: Rest, Recovery and Program with one tap. Players missed the buttons when a dropdown replaced them.",
      taps: "One tap per rider. New training: open the focus panel.",
    },
    d1: {
      name: "D1 · Like before, only better",
      what: "The old quick buttons back in the row: Full rest and Active under Rest, Long ride and the rider's own training. One tap saves. A new training is picked in the list next to them.",
      taps: "Taps per rider: 1 · Active recovery: 1 · New training: 2",
    },
    d2: {
      name: "D2 · Four efforts, one tap",
      what: "Rest, Easy, Medium and Hard as four buttons. One tap saves, and the rider gets his own training at that effort. Under Rest you pick Full or Active.",
      taps: "Taps per rider: 1 · Active recovery: 2 · New training: 2",
    },
    d3: {
      name: "D3 · Team day plus exceptions",
      what: "Pick the effort for the whole team with one tap. Every rider rides his own training. You only tap the riders who should rest.",
      taps: "Taps: 1 for the team + 1 per rider who rests · New training: 2",
    },
    d4: {
      name: "D4 · The assistant suggests, you correct",
      what: "The assistant sets the day for each rider from fatigue and training. One tap uses every suggestion; a rider is changed with one tap.",
      taps: "Taps: 1 for the team · Correct a rider: 1 · New training: 2",
    },
  },
};

const da: Dict = {
  sketch: "Skitse #7947, runde 2",
  pageTitle: "Træning",
  pageSub: "I dag",
  trainNow: "Træn nu",
  trainNowNote: "Uændret",
  fullRest: "Fuld hvile",
  full: "Fuld",
  active: "Aktiv",
  activeLong: "Aktiv restitution",
  restGroup: "Hvile",
  trainGroup: "Træn",
  change: "Skift",
  changeTraining: "Skift træning",
  saved: "Gemt",
  rider: "Rytter",
  fatigue: "Træthed",
  tonight: "Træthed i aften",
  own: "Egen træning",
  teamDay: "Holdets dag",
  teamDayNote: "Alle, der ikke hviler, kører deres egen træning på denne indsats.",
  restToday: "Hvil i dag",
  resting: "Hviler",
  followsTeam: "følger holdet",
  assistantTitle: "Assistentens dag",
  assistantNote: "Sat ud fra træthed og hver rytters træning. Ret en rytter med ét tryk.",
  useAll: (n) => `Brug alle ${n} forslag`,
  assistant: "Assistenten",
  yours: "Dit valg",
  reasons: {
    fresh: "frisk",
    tired: "træt efter løb",
    veryTired: "meget træt",
    overLimit: "over skadegrænsen",
    steady: "jævn dag",
  },
  thenFocus: "Fokus",
  thenSeason: "Denne sæson",
  thenProgram: "Program",
  thenRecovery: "Restitution",
  feelTitle: "Sådan føles det",
  feelRows: ["Hvil eller træn", "Aktiv restitution", "En anden træning", "Hele holdet", "Gem-knap"],
  feel: {
    d1: ["1 tryk", "1 tryk", "2 (listen i rækken)", "Sæt for flere, som i dag", "Ingen, et tryk gemmer"],
    d2: ["1 tryk", "2 tryk", "2 (Skift, så vælg)", "Sæt for flere, som i dag", "Ingen, et tryk gemmer"],
    d3: ["1 tryk for holdet, 1 pr. rytter der hviler", "2 tryk", "2 (listen i rækken)", "1 tryk", "Ingen, et tryk gemmer"],
    d4: ["0 hvis du tager forslaget, 1 for at rette", "0 hvis foreslået, ellers 2 tryk", "2 (listen i rækken)", "1 tryk", "Ingen, et tryk gemmer"],
  },
  banners: {
    then: {
      name: "Den gamle træningsflade (september til midt oktober)",
      what: "Genskabt tro mod koden, med datidens træningskatalog. Pc indtil 23/9: tre hurtigknapper pr. rytter, Hvile, Aktiv restitution og rytterens egen træning. Telefon fra 1/10: Hvile, Restitution og Program med ét tryk. Spillerne savnede knapperne, da en rulleliste afløste dem.",
      taps: "Ét tryk pr. rytter. Ny træning: åbn fokuspanelet.",
    },
    d1: {
      name: "D1 · Som før, bare bedre",
      what: "De gamle hurtigknapper tilbage i rækken: Fuld hvile og Aktiv under Hvile, Lang tur og rytterens egen træning. Ét tryk gemmer. En ny træning vælges i listen ved siden af.",
      taps: "Tryk pr. rytter: 1 · Aktiv restitution: 1 · Ny træning: 2",
    },
    d2: {
      name: "D2 · Fire indsatser, ét tryk",
      what: "Hvile, Let, Mellem og Hård som fire knapper. Ét tryk gemmer, og rytteren får sin egen træning på den indsats. Under Hvile vælger du Fuld eller Aktiv.",
      taps: "Tryk pr. rytter: 1 · Aktiv restitution: 2 · Ny træning: 2",
    },
    d3: {
      name: "D3 · Holdets dag plus undtagelser",
      what: "Vælg indsatsen for hele holdet med ét tryk. Hver rytter kører sin egen træning. Du trykker kun på de ryttere, der skal hvile.",
      taps: "Tryk: 1 for holdet + 1 pr. rytter der hviler · Ny træning: 2",
    },
    d4: {
      name: "D4 · Assistenten foreslår, du retter",
      what: "Assistenten sætter dagen for hver rytter ud fra træthed og træning. Ét tryk bruger alle forslag; en rytter rettes med ét tryk.",
      taps: "Tryk: 1 for holdet · Ret en rytter: 1 · Ny træning: 2",
    },
  },
};

export const COPY2: Record<Lang, Dict> = { en, da };

export function sessionName(lang: Lang, s: string | null): string {
  if (!s) return "";
  return COPY[lang].sessions[s] ?? s;
}

export function effortName(lang: Lang, e: "rest" | "easy" | "normal" | "hard"): string {
  return COPY[lang].efforts[e];
}

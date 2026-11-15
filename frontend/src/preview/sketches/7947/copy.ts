// Tekster til skitsen, EN foerst og DA under. Kun til billederne: ingen af
// noeglerne findes i locales, og intet her er godkendt spillertekst (Claude ejer
// ny spillertekst ved et senere byg). Session-navnene er de samme som spillet
// bruger i dag.

export type Lang = "en" | "da";

type Dict = {
  pageTitle: string;
  pageSub: string;
  trainToday: string;
  trainTodayNote: string;
  colRider: string;
  colEffort: string;
  colTraining: string;
  colDay: string;
  efforts: Record<"rest" | "easy" | "normal" | "hard", string>;
  effortNotes: Record<"rest" | "easy" | "normal" | "hard", string>;
  sessions: Record<string, string>;
  groupRide: string;
  groupSkill: string;
  noSession: string;
  chooseTraining: string;
  chooseEffortFirst: string;
  saveDay: string;
  saved: string;
  cancel: string;
  change: string;
  assistantPick: string;
  fullRest: string;
  activeRecovery: string;
  fatigue: string;
  form: string;
  types: Record<string, string>;
  transitionTitle: string;
  transitionSub: string;
  transitionCols: [string, string, string];
  transitionKept: string;
  transitionRestFocus: string;
  decisionsTitle: string;
  decisionsSub: string;
  recoveryQ: string;
  tacticsQ: string;
  cooldownQ: string;
  mergeQ: string;
  placeholder: string;
  mediumNote: string;
};

export const COPY: Record<Lang, Dict> = {
  en: {
    pageTitle: "Training",
    pageSub: "Pick the effort first, then the training.",
    trainToday: "Train today",
    trainTodayNote: "Unchanged, owned by the Train now work",
    colRider: "Rider",
    colEffort: "Effort",
    colTraining: "Training",
    colDay: "Day",
    efforts: { rest: "Rest", easy: "Easy", normal: "Medium", hard: "Hard" },
    effortNotes: {
      rest: "Fatigue comes down. Full rest has no growth; active recovery gives a little.",
      easy: "Low load. Long rides, recovery and craft.",
      normal: "Steady load.",
      hard: "Highest load. The intervals live here.",
    },
    sessions: {
      recovery: "Active recovery",
      endurance: "Long ride",
      tempo: "Tempo",
      vo2max: "Mixed intervals",
      vo2max_climb: "Mountain intervals",
      vo2max_punch: "VO2max (punch)",
      threshold: "Threshold",
      sprint: "Sprint",
      cobbled_sectors: "Cobbled Sectors",
      echelon_drills: "Echelon Drills",
      attack_repeats: "Attack Repeats",
      long_climbs: "Long climbs",
      lead_out: "Lead-out",
      itt_short: "Short time trials",
      itt_long: "Long time trials",
      cobbled_classic: "Cobbled classic",
      technique: "Technique",
      aero: "Aero",
      loebslaere: "Race craft",
    },
    groupRide: "Riding",
    groupSkill: "Skill day",
    noSession: "No session on a rest day",
    chooseTraining: "Choose training",
    chooseEffortFirst: "Choose effort",
    saveDay: "Save day",
    saved: "Saved",
    cancel: "Cancel",
    change: "Change",
    assistantPick: "Assistant's pick",
    fullRest: "Full rest",
    activeRecovery: "Active recovery",
    fatigue: "Fatigue",
    form: "Form",
    types: { climber: "Climber", sprinter: "Sprinter", allround: "All-rounder", puncheur: "Puncheur", tt: "Time triallist", classics: "Classics rider" },
    transitionTitle: "Saved plans after the switch",
    transitionSub: "Nothing is rewritten. The saved plan keeps its focus and intensity, and the screen reads effort and training from it.",
    transitionCols: ["Rider", "Saved today", "Shown after"],
    transitionKept: "Same plan, new reading",
    transitionRestFocus: "Old focus is kept in the plan but not trained",
    decisionsTitle: "Open points, and where this sketch puts them",
    decisionsSub: "These were open on the issue. The sketch shows one answer each so you can react to it. None is decided.",
    recoveryQ: "Active recovery",
    tacticsQ: "Tactics",
    cooldownQ: "Cool-down",
    mergeQ: "Merge or remove sessions",
    placeholder: "Pending owner decision",
    mediumNote: "Medium has one training today, so the choice is a single option.",
  },
  da: {
    pageTitle: "Træning",
    pageSub: "Vælg først indsatsen, så træningen.",
    trainToday: "Træn i dag",
    trainTodayNote: "Uændret, ejes af Træn nu-sporet",
    colRider: "Rytter",
    colEffort: "Indsats",
    colTraining: "Træning",
    colDay: "Dag",
    efforts: { rest: "Hvile", easy: "Let", normal: "Mellem", hard: "Hård" },
    effortNotes: {
      rest: "Trætheden falder. Fuld hvile giver ingen udvikling; aktiv restitution lidt.",
      easy: "Lav belastning. Lange ture, restitution og færdighed.",
      normal: "Jævn belastning.",
      hard: "Højeste belastning. Intervallerne bor her.",
    },
    sessions: {
      recovery: "Aktiv restitution",
      endurance: "Lang tur",
      tempo: "Tempo",
      vo2max: "Blandede intervaller",
      vo2max_climb: "Bjergintervaller",
      vo2max_punch: "VO2max (punch)",
      threshold: "Tærskel",
      sprint: "Sprint",
      cobbled_sectors: "Brostenssektorer",
      echelon_drills: "Vifteøvelser",
      attack_repeats: "Angrebsintervaller",
      long_climbs: "Lange stigninger",
      lead_out: "Lead-out",
      itt_short: "Korte enkeltstarter",
      itt_long: "Lange enkeltstarter",
      cobbled_classic: "Brostensklassiker",
      technique: "Teknik",
      aero: "Aero",
      loebslaere: "Løbslære",
    },
    groupRide: "Kørsel",
    groupSkill: "Færdighedsdag",
    noSession: "Ingen træning på en hviledag",
    chooseTraining: "Vælg træning",
    chooseEffortFirst: "Vælg indsats",
    saveDay: "Gem dag",
    saved: "Gemt",
    cancel: "Annuller",
    change: "Skift",
    assistantPick: "Assistentens valg",
    fullRest: "Fuld hvile",
    activeRecovery: "Aktiv restitution",
    fatigue: "Træthed",
    form: "Form",
    types: { climber: "Klatrer", sprinter: "Sprinter", allround: "Allrounder", puncheur: "Puncheur", tt: "Enkeltstartsrytter", classics: "Klassikerrytter" },
    transitionTitle: "Gemte planer efter skiftet",
    transitionSub: "Intet skrives om. Den gemte plan beholder fokus og intensitet, og skærmen læser indsats og træning ud af den.",
    transitionCols: ["Rytter", "Gemt i dag", "Vises efter"],
    transitionKept: "Samme plan, ny læsning",
    transitionRestFocus: "Det gamle fokus ligger i planen, men trænes ikke",
    decisionsTitle: "Åbne punkter, og hvor skitsen placerer dem",
    decisionsSub: "Disse var åbne på issuet. Skitsen viser ét svar hver, så du kan reagere på det. Intet er afgjort.",
    recoveryQ: "Aktiv restitution",
    tacticsQ: "Taktik",
    cooldownQ: "Nedkørsel",
    mergeQ: "Slå sammen eller fjern træninger",
    placeholder: "Afventer ejerens beslutning",
    mediumNote: "Mellem har én træning i dag, så valget er én mulighed.",
  },
};

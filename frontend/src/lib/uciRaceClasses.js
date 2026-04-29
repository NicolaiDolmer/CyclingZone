export const RACE_CLASSES = [
  { key: "TourFrance", label: "Tour de France (kat. 1)", type: "Grand Tour", uciCode: "2.UWT" },
  { key: "GiroVuelta", label: "Giro, Vuelta (kat. 2)", type: "Grand Tour", uciCode: "2.UWT" },
  { key: "Monuments", label: "Monuments (kat. 3)", type: "Endagsløb", uciCode: "1.UWT" },
  { key: "OtherWorldTourA", label: "Other WorldTour A (kat. 4)", type: "WorldTour", uciCode: "1.UWT / 2.UWT" },
  { key: "OtherWorldTourB", label: "Other WorldTour B (kat. 5)", type: "WorldTour", uciCode: "1.UWT / 2.UWT" },
  { key: "OtherWorldTourC", label: "Other WorldTour C (kat. 6)", type: "WorldTour", uciCode: "1.UWT / 2.UWT" },
  { key: "ProSeries", label: "ProSeries races (kat. 7)", type: "Continental Circuit", uciCode: "1.Pro / 2.Pro" },
  { key: "Class1", label: "Class 1 races (kat. 8)", type: "Continental Circuit", uciCode: "1.1 / 2.1" },
  { key: "Class2", label: "Class 2 races (kat. 9)", type: "Continental Circuit", uciCode: "1.2 / 2.2" },
];

export const RESULT_TYPES = [
  { key: "Etapeplacering", label: "Etapeplacering" },
  { key: "Klassement", label: "Klassement" },
  { key: "Klassiker", label: "Klassiker" },
  { key: "Pointtroje", label: "Pointtrøje" },
  { key: "Bjergtroje", label: "Bjergtrøje" },
  { key: "Forertroje", label: "Førertrøje" },
  { key: "Ungdomstroje", label: "Ungdomstrøje" },
  { key: "EtapelobHold", label: "Etapeløb Hold" },
  { key: "KlassikerHold", label: "Klassiker Hold" },
];

export const MAX_RANKS = {
  Etapeplacering: 15,
  Klassement: 60,
  Klassiker: 60,
  Pointtroje: 3,
  Bjergtroje: 3,
  Forertroje: 1,
  Ungdomstroje: 3,
  EtapelobHold: 1,
  KlassikerHold: 1,
};

export function getRaceClassLabel(raceClass) {
  return RACE_CLASSES.find(item => item.key === raceClass)?.label || raceClass;
}

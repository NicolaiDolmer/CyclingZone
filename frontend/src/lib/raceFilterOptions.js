// Delte filter-lister til løbs-flader. Værdierne er races.race_class /
// races.status som de står i DB; labels resolves via t(`classOption.${value}`)
// og t(`status.${value}`) i races-namespacet.
//
// #3102 etape 2: listerne stod inline i RacesPage og fulgte ikke med da
// biblioteks-fanen flyttede til Resultat-hubben. De bor her nu, så kalender-
// fanen (RacesPage) og arkiv-fanen (RaceArchiveTable) deler præcis samme
// taksonomi i stedet for at drifte fra hinanden.

export const RACE_CLASS_OPTIONS = [
  { value: "TourFrance" },
  { value: "GiroVuelta" },
  { value: "Monuments" },
  { value: "OtherWorldTourA" },
  { value: "OtherWorldTourB" },
  { value: "OtherWorldTourC" },
  { value: "ProSeries" },
  { value: "Class1" },
  { value: "Class2" },
];

export const RACE_STATUS_OPTIONS = [
  { value: "completed" },
  { value: "active" },
  { value: "scheduled" },
];

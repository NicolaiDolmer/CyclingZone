export const UCI_MEN_RACE_CLASSES = [
  { key: "TourFrance", label: "Tour de France", type: "Grand Tour", uciCode: "2.UWT" },
  { key: "GiroVuelta", label: "Giro, Vuelta", type: "Grand Tour", uciCode: "2.UWT" },
  { key: "Monuments", label: "Monuments", type: "Endagslob", uciCode: "1.UWT" },
  { key: "OtherWorldTourA", label: "Other WorldTour A", type: "WorldTour", uciCode: "1.UWT / 2.UWT" },
  { key: "OtherWorldTourB", label: "Other WorldTour B", type: "WorldTour", uciCode: "1.UWT / 2.UWT" },
  { key: "OtherWorldTourC", label: "Other WorldTour C", type: "WorldTour", uciCode: "1.UWT / 2.UWT" },
  { key: "ProSeries", label: "ProSeries races", type: "Continental Circuit", uciCode: "1.Pro / 2.Pro" },
  { key: "Class1", label: "Class 1 races", type: "Continental Circuit", uciCode: "1.1 / 2.1" },
  { key: "Class2", label: "Class 2 races", type: "Continental Circuit", uciCode: "1.2 / 2.2" },
];

export const UCI_MEN_RESULT_TYPES = [
  { key: "Etapeplacering", label: "Etapeplacering", maxRank: 15 },
  { key: "Klassement", label: "Klassement", maxRank: 60 },
  { key: "Klassiker", label: "Klassiker", maxRank: 60 },
  { key: "Pointtroje", label: "Pointtroje", maxRank: 3 },
  { key: "Bjergtroje", label: "Bjergtroje", maxRank: 3 },
  { key: "Forertroje", label: "Forertroje", maxRank: 1 },
  { key: "Ungdomstroje", label: "Ungdomstroje", maxRank: 3 },
  { key: "EtapelobHold", label: "Etapelob Hold", maxRank: 1 },
  { key: "KlassikerHold", label: "Klassiker Hold", maxRank: 1 },
];

const finalWorldTour = {
  TourFrance: [
    1300, 1040, 880, 750, 620, 520, 425, 360, 295, 230, 190, 165,
    140, 110, 100, 90, 85, 80, 70, 60,
    ...Array(5).fill(50),
    ...Array(5).fill(40),
    ...Array(10).fill(35),
    ...Array(10).fill(25),
    ...Array(5).fill(20),
    ...Array(5).fill(15),
  ],
  GiroVuelta: [
    1100, 885, 750, 600, 495, 415, 340, 285, 235, 180, 155, 130,
    110, 90, 80, 75, 70, 60, 55, 50,
    ...Array(5).fill(50),
    ...Array(5).fill(30),
    ...Array(10).fill(25),
    ...Array(10).fill(20),
    ...Array(5).fill(15),
    ...Array(5).fill(10),
  ],
  Monuments: [
    800, 640, 520, 440, 360, 280, 240, 200, 160, 135, 110, 95,
    85, 65, 55, 50, 50, 50, 50, 50,
    ...Array(10).fill(30),
    ...Array(20).fill(15),
    ...Array(5).fill(10),
    ...Array(5).fill(5),
  ],
  OtherWorldTourA: [
    500, 400, 325, 275, 225, 175, 150, 125, 100, 85, 70, 60,
    50, 40, 35, 30, 30, 30, 30, 30,
    ...Array(10).fill(20),
    ...Array(20).fill(10),
    ...Array(5).fill(5),
    ...Array(5).fill(3),
  ],
  OtherWorldTourB: [
    400, 320, 260, 220, 180, 140, 120, 100, 80, 68, 56, 48,
    40, 32, 28, 24, 24, 24, 24, 24,
    ...Array(10).fill(16),
    ...Array(20).fill(8),
    ...Array(5).fill(4),
    ...Array(5).fill(2),
  ],
  OtherWorldTourC: [
    300, 250, 215, 175, 120, 115, 95, 75, 60, 50, 40, 35,
    30, 25, 20, 20, 20, 20, 20, 20,
    ...Array(10).fill(12),
    ...Array(20).fill(5),
    ...Array(5).fill(2),
    ...Array(5).fill(1),
  ],
};

const finalContinental = {
  ProSeries: [
    200, 150, 125, 100, 85, 70, 60, 50, 40, 35, 30, 25, 20, 15, 10,
    ...Array(15).fill(5),
    ...Array(10).fill(3),
  ],
  Class1: [
    125, 85, 70, 60, 50, 40, 35, 30, 25, 20, 15, 10, 5, 5, 5,
    ...Array(10).fill(3),
  ],
  Class2: [
    40, 30, 25, 20, 15, 10, 5, 3, 3, 3, 3, 3, 3, 3, 3,
    ...Array(5).fill(1),
  ],
};

const stagePoints = {
  TourFrance: [210, 150, 110, 90, 70, 55, 45, 40, 35, 30, 25, 20, 15, 10, 5],
  GiroVuelta: [180, 130, 95, 80, 60, 45, 40, 35, 30, 25, 20, 15, 10, 5, 2],
  OtherWorldTourA: [60, 40, 30, 25, 20, 15, 10, 8, 5, 2],
  OtherWorldTourB: [50, 30, 25, 20, 15, 10, 8, 6, 3, 1],
  OtherWorldTourC: [40, 25, 20, 15, 10, 8, 6, 3, 2, 1],
  ProSeries: [20, 15, 10, 5, 3],
  Class1: [14, 5, 3],
  Class2: [7, 3, 1],
};

const secondaryClassifications = {
  TourFrance: [210, 150, 110],
  GiroVuelta: [180, 130, 95],
};

const leaderJersey = {
  TourFrance: 25,
  GiroVuelta: 20,
  OtherWorldTourA: 10,
  OtherWorldTourB: 8,
  OtherWorldTourC: 6,
  ProSeries: 5,
  Class1: 3,
  Class2: 1,
};

function rowsForScale(raceClass, resultType, points) {
  return points.map((pointValue, index) => ({
    race_class: raceClass,
    result_type: resultType,
    rank: index + 1,
    points: pointValue,
  }));
}

export function buildUciMenRacePointRows() {
  const rows = [];

  for (const [raceClass, points] of Object.entries(finalWorldTour)) {
    const resultType = raceClass === "Monuments" ? "Klassiker" : "Klassement";
    rows.push(...rowsForScale(raceClass, resultType, points));
  }

  for (const [raceClass, points] of Object.entries(finalContinental)) {
    rows.push(...rowsForScale(raceClass, "Klassement", points));
    rows.push(...rowsForScale(raceClass, "Klassiker", points));
  }

  for (const raceClass of ["OtherWorldTourA", "OtherWorldTourB", "OtherWorldTourC"]) {
    rows.push(...rowsForScale(raceClass, "Klassiker", finalWorldTour[raceClass]));
  }

  for (const [raceClass, points] of Object.entries(stagePoints)) {
    rows.push(...rowsForScale(raceClass, "Etapeplacering", points));
  }

  for (const [raceClass, points] of Object.entries(secondaryClassifications)) {
    rows.push(...rowsForScale(raceClass, "Pointtroje", points));
    rows.push(...rowsForScale(raceClass, "Bjergtroje", points));
  }

  for (const [raceClass, points] of Object.entries(leaderJersey)) {
    rows.push({
      race_class: raceClass,
      result_type: "Forertroje",
      rank: 1,
      points,
    });
  }

  return rows;
}

import { applyFlattenToPointRows, PROD_FLATTEN, PROD_BREADTH_BOOST } from "./racePointFlatten.js";

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
  { key: "Ungdomstroje", label: "Ungdomstroje", maxRank: 3 },
  { key: "Forertroje", label: "Forertroje", maxRank: 1 },
  { key: "BjergtrojeDag", label: "Bjergtroje per dag", maxRank: 1 },
  { key: "PointtrojeDag", label: "Pointtroje per dag", maxRank: 1 },
  { key: "UngdomstrojeDag", label: "Ungdomstroje per dag", maxRank: 1 },
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

// Bjerg + Point final classification (top 3). UCI-real for Tour/Giro/Vuelta.
// For øvrige classes: derived ~16/12/8.5% af GC rank 1 (matcher UCI's egen Tour/Giro-skala).
const secondaryClassifications = {
  TourFrance: [210, 150, 110],         // UCI-real
  GiroVuelta: [180, 130, 95],          // UCI-real
  OtherWorldTourA: [80, 60, 42],       // derived (GC=500)
  OtherWorldTourB: [65, 48, 34],       // derived (GC=400)
  OtherWorldTourC: [50, 36, 26],       // derived (GC=300)
  ProSeries: [32, 24, 17],             // derived (GC=200)
  Class1: [20, 15, 11],                // derived (GC=125)
  Class2: [6, 5, 3],                   // derived (GC=40)
};

// Young rider final classification (top 3). UCI publicerer ikke white-jersey points
// — derived ~8/5/3% af GC rank 1. Tweak via /admin race-points override (#505).
const youngRiderFinals = {
  TourFrance: [100, 60, 30],
  GiroVuelta: [80, 50, 25],
  OtherWorldTourA: [40, 25, 15],
  OtherWorldTourB: [32, 20, 12],
  OtherWorldTourC: [24, 15, 9],
  ProSeries: [16, 10, 6],
  Class1: [10, 6, 4],
  Class2: [3, 2, 1],
};

// Yellow leader jersey per stage worn. UCI-real for Grand Tours; derived for resten.
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

// Per-stage holding points for Bjerg/Point/Ungdoms jersey (rank 1 = aktuelle holder).
// ~60% af Forertroje-værdi. Game-design extension — UCI publicerer ikke per-day secondary jerseys.
const secondaryJerseyPerDay = {
  TourFrance: 15,
  GiroVuelta: 12,
  OtherWorldTourA: 6,
  OtherWorldTourB: 5,
  OtherWorldTourC: 4,
  ProSeries: 3,
  Class1: 2,
  Class2: 1,
};

// Team classification (rank 1 only). UCI publicerer ikke team-points i World Ranking
// — derived ~5% af GC rank 1. EtapelobHold = stage races, KlassikerHold = one-day.
const teamClassificationStage = {
  TourFrance: 65,
  GiroVuelta: 55,
  OtherWorldTourA: 25,
  OtherWorldTourB: 20,
  OtherWorldTourC: 15,
  ProSeries: 10,
  Class1: 6,
  Class2: 2,
};

const teamClassificationOneDay = {
  Monuments: 40,
  OtherWorldTourA: 25,
  OtherWorldTourB: 20,
  OtherWorldTourC: 15,
  ProSeries: 10,
  Class1: 6,
  Class2: 2,
};

function rowsForScale(raceClass, resultType, points) {
  return points.map((pointValue, index) => ({
    race_class: raceClass,
    result_type: resultType,
    rank: index + 1,
    points: pointValue,
  }));
}

// Rå (top-tunge) UCI-kurve FØR flatten. Bevaret separat så testene kan asserte den
// uflade form og harnessen kan reshape præcis denne baseline.
function buildRawUciMenRacePointRows() {
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

  for (const [raceClass, points] of Object.entries(youngRiderFinals)) {
    rows.push(...rowsForScale(raceClass, "Ungdomstroje", points));
  }

  for (const [raceClass, points] of Object.entries(leaderJersey)) {
    rows.push({
      race_class: raceClass,
      result_type: "Forertroje",
      rank: 1,
      points,
    });
  }

  for (const [raceClass, points] of Object.entries(secondaryJerseyPerDay)) {
    for (const resultType of ["BjergtrojeDag", "PointtrojeDag", "UngdomstrojeDag"]) {
      rows.push({
        race_class: raceClass,
        result_type: resultType,
        rank: 1,
        points,
      });
    }
  }

  for (const [raceClass, points] of Object.entries(teamClassificationStage)) {
    rows.push({
      race_class: raceClass,
      result_type: "EtapelobHold",
      rank: 1,
      points,
    });
  }

  for (const [raceClass, points] of Object.entries(teamClassificationOneDay)) {
    rows.push({
      race_class: raceClass,
      result_type: "KlassikerHold",
      rank: 1,
      points,
    });
  }

  return rows;
}

// Den SERVEREDE prod-kurve = rå UCI-kurve med den ejer-godkendte flatten (#1607) bagt ind:
// Klassement/Klassiker-kurverne komprimeres 50% mod deres egen middel pr. race-class
// (sum-bevaret → præmie-niveauet uændret, kun formen flader), mens etape/troje/hold-point
// er urørte (breadthBoost=0). Empirisk: skærer p10–p90 net-divergens ~11–26% pr. division
// uden at bryde fresh-population-gaten — se docs/audits/2026-06-21-economy-fase2-calibration.md.
// Kalibrerings-harnessen genbruger SAMME transform (racePointFlatten.js) så scorecardet ved
// PROD (override flatten 0) matcher den shippede kurve bit-for-bit.
export function buildUciMenRacePointRows() {
  return applyFlattenToPointRows(buildRawUciMenRacePointRows(), PROD_FLATTEN, PROD_BREADTH_BOOST);
}

// Eksponér den uflade baseline til tests/diagnostik (ikke prod-serveret).
export { buildRawUciMenRacePointRows };

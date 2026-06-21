// #1607/#1441 race-point flatten transform — DELT kerne (prod + kalibrerings-harness).
//
// FORMÅL: én eneste sum-bevarende fladnings-transform der bruges af BÅDE prod-defaulten
// (uciRacePointDefaults.js bager flatten 0.5 ind i den serverede kurve) OG kalibrerings-
// harnessen (economyCalibrationOverrides.js, der kan variere flatten/breadthBoost i de
// syntetiske scorecards). Fælles modul → harness-resultatet og prod-kurven er bit-identiske
// (samme afrundings-adfærd), så scorecardet ved PROD (override flatten 0) matcher det gamle
// scorecard med flatten 0.5-override, og vi undgår to divergerende implementeringer.
//
// MATEMATIK: komprimér hver top-tung klassement-skala (Klassement/Klassiker) mod dens EGEN
// middel pr. (race_class, result_type)-gruppe. f=0 → uændret; f=1 → helt flad. Summen pr.
// gruppe bevares (ren omfordeling inden for skalaen, op til heltals-afrunding) → præmie-
// NIVEAUET er uændret, kun FORMEN flader. Etape/troje/hold-point er urørte ved breadthBoost=0.

// Result-typer der er "top-tunge" klassementer → komprimeres af flatten.
export const TOP_HEAVY_RESULT_TYPES = new Set(["Klassement", "Klassiker"]);
// Result-typer der belønner bredde (etapesejre + holdklassement) → boostes hvis breadthBoost>0.
export const BREADTH_RESULT_TYPES = new Set(["Etapeplacering", "EtapelobHold", "KlassikerHold"]);

// Den shippede prod-flatten (ejer-godkendt 2026-06-21, #1607). Ren GC-kompression:
// flatten 0.5, breadthBoost 0. Sweep'en viste at breadth-boost ØGER divergens i den
// rige-roster-model, så ren klassement-kompression er den korrekte "fladere fordeling".
export const PROD_FLATTEN = 0.5;
export const PROD_BREADTH_BOOST = 0;

// Komprimér én skala (array af point pr. rank, desc) mod dens gennemsnit med faktor f.
// f=0 → uændret; f=1 → alle ranks = gennemsnit (helt flad). Bevarer total-summen
// (ren omfordeling inden for skalaen) før heltals-afrunding.
export function compressTowardMean(points, f) {
  if (!points.length || f <= 0) return points;
  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  return points.map((p) => p + (mean - p) * f);
}

// Reshape rå UCI-point-rows efter flatten-faktoren:
//   • top-tunge klassementer (Klassement/Klassiker) komprimeres mod deres egen middel
//     (summen bevaret op til afrunding) → mindre forskel mellem stærke og svage hold
//   • breadth-typer (etape + holdklassement) skaleres ×(1+f·breadthBoost) hvis breadthBoost>0
// Returnerer ALTID en ny array af nye row-objekter (input muteres aldrig).
export function applyFlattenToPointRows(rows, flatten, breadthBoost = PROD_BREADTH_BOOST) {
  if (!flatten || flatten <= 0) return rows.map((r) => ({ ...r }));

  // Grupper top-tunge skalaer pr. (race_class, result_type) for sum-bevarende kompression.
  const groups = new Map();
  for (const r of rows) {
    if (!TOP_HEAVY_RESULT_TYPES.has(r.result_type)) continue;
    const key = `${r.race_class}__${r.result_type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const compressed = new Map(); // key → Map(rank → newPoints)
  for (const [key, grp] of groups) {
    const sorted = [...grp].sort((a, b) => a.rank - b.rank);
    const newPts = compressTowardMean(sorted.map((r) => r.points), flatten);
    const rankMap = new Map();
    sorted.forEach((r, i) => rankMap.set(r.rank, newPts[i]));
    compressed.set(key, rankMap);
  }

  return rows.map((r) => {
    const out = { ...r };
    const key = `${r.race_class}__${r.result_type}`;
    if (compressed.has(key)) {
      out.points = Math.round(compressed.get(key).get(r.rank));
    } else if (breadthBoost > 0 && BREADTH_RESULT_TYPES.has(r.result_type)) {
      out.points = Math.round(r.points * (1 + flatten * breadthBoost));
    }
    return out;
  });
}

// Aggregér en rytters race_results-rækker til sæson-totaler for rytter-profilens
// "Sæsonhistorik"-fane. Tæller KUN reelle sejre pr. type — IKKE trøje-leder-dage
// (leader/points_day/mountain_day/young_day), som blot betyder at rytteren bar
// trøjen den dag, ikke at han vandt noget.
//
// Sejrs-kolonner:
//   stageWins      — result_type "stage", rank 1            (etapesejr)
//   gcWins         — result_type "gc" på et etapeløb, rank 1 (samlet sejr)
//   classicWins    — result_type "gc" på et endagsløb, rank 1 (klassikersejr)
//   pointsJerseys  — result_type "points", rank 1            (pointtrøje)
//   mountainJerseys— result_type "mountain", rank 1          (bjergtrøje)
//
// totalPrize summerer prize_money over ALLE rækker (også trøje-dage), da det er
// rytterens reelt optjente præmie.
//
// rows: [{ rank, prize_money, result_type, race: { race_type, season: { number } } }]
// Returnerer et map keyed på sæson-nummer (eller "-" hvis ukendt).
export function aggregateRiderSeasons(rows = []) {
  const bySeason = {};
  for (const r of rows || []) {
    const sn = r?.race?.season?.number ?? null;
    const key = sn ?? "-";
    if (!bySeason[key]) {
      bySeason[key] = {
        season: sn,
        stageWins: 0,
        gcWins: 0,
        classicWins: 0,
        pointsJerseys: 0,
        mountainJerseys: 0,
        totalPrize: 0,
      };
    }
    const a = bySeason[key];
    if (r?.rank === 1) {
      switch (r.result_type) {
        case "stage": a.stageWins += 1; break;
        case "gc": r?.race?.race_type === "single" ? (a.classicWins += 1) : (a.gcWins += 1); break;
        case "points": a.pointsJerseys += 1; break;
        case "mountain": a.mountainJerseys += 1; break;
        default: break; // leder-/dag-trøjer + ungdom = ingen sejr
      }
    }
    a.totalPrize += r?.prize_money || 0;
  }
  return bySeason;
}

// #7258: afgjorde et morgenudbrud klassementet? Maalingen bag testportens gate
// `gcFromBreakaway` (v3Gates.mjs) og kortets linje "GC-vinder sad i udbrud".
//
// Den gamle maaling (motorTestportReport.aggregateRevision, `member`) talte enhver
// tilstedevaerelse i et dannet udbrud, ogsaa et udbrud der blev hentet efter faa km.
// Her taeller kun et morgenudbrud der faktisk afgjorde loebet:
//   - klassementsvinderen W sad i dagens udbrud (breakaway_formed, morgen- eller
//     reformationsudbrud; et sent angreb i finalen er aldrig et udbrud her), og
//   - W vandt mindst saa meget tid den dag paa den bedst placerede rytter R i
//     slutklassementet, der IKKE sad i udbruddet, som W's samlede forspring paa R
//     ved loebets slutning. Uden den dags gevinst havde R altsaa staaet foran W.
// Tiderne er klassementets egne (kumuleret tid minus bonussekunder, som spillet).
//
// "Vandt en etape fra udbrud" er uaendret: W vandt etapen fra dagens udbrud
// (rows[].breakawayWon og winnerId), hentet eller ej undervejs.
//
// REN: ingen IO, ingen motor.

/** Klassementstiderne foer og efter én etape (rider_id -> kumuleret tid). */
export function gcStageTimes(gcBefore, gcAfter) {
  const map = (xs) => new Map((xs ?? []).filter((r) => r?.rider_id != null && Number.isFinite(Number(r.time))).map((r) => [r.rider_id, Number(r.time)]));
  return { before: map(gcBefore), after: map(gcAfter) };
}

/**
 * Pr. seed: afgjorde et morgenudbrud klassementet for vinderen, og vandt han en etape
 * fra udbrud? `rows` er scorecardets etaperaekker (breakawayRiderIds, breakawayWon,
 * winnerId, stage), `gcTimes[i]` er gcStageTimes for etape i, `final` slutklassementet
 * (rangeret, med `time`). null for endagsloeb eller uden vinder.
 */
export function gcWinnerBreakFacts({ rows, gcTimes, final }) {
  const winner = final?.[0]?.rider_id ?? null;
  if (!winner || !Array.isArray(rows) || rows.length < 2) return null;
  const finalTime = new Map((final ?? []).map((r) => [r.rider_id, Number(r.time)]));
  let decisiveStage = null;
  let gainSeconds = null;
  let wonStage = null;
  rows.forEach((r, i) => {
    const ids = new Set(r?.breakawayRiderIds ?? []);
    if (!ids.has(winner)) return;
    if (r.breakawayWon === true && r.winnerId === winner && wonStage === null) wonStage = r.stage ?? i + 1;
    const t = gcTimes?.[i];
    if (!t) return;
    // R: den bedst placerede i slutklassementet uden for dagens udbrud, som koerte etapen.
    const ref = (final ?? []).find((x) => x.rider_id !== winner && !ids.has(x.rider_id) && t.after.has(x.rider_id));
    if (!ref) return;
    const lead = finalTime.get(ref.rider_id) - finalTime.get(winner);
    if (!(lead > 0)) return;
    const before = (id) => t.before.get(id) ?? 0; // foerste etape: ingen tid endnu
    const gain = (t.after.get(ref.rider_id) - t.after.get(winner)) - (before(ref.rider_id) - before(winner));
    if (Number.isFinite(gain) && gain >= lead && decisiveStage === null) {
      decisiveStage = r.stage ?? i + 1;
      gainSeconds = gain;
    }
  });
  return { decisive: decisiveStage !== null, decisiveStage, gainSeconds, wonFromBreak: wonStage !== null, wonStage };
}

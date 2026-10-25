// backend/scripts/dev/lib/komGcOverlap6937.mjs
// #6937 (motor v3, gate G16): maalefunktionen bag G16. Ren, ingen IO, ingen motor.
//
// G16 (spec 2026-10-23-6804-v3-tilvalg-design.md §2.1): andelen af etapeloeb hvor
// klassementsvinderen ogsaa vinder bjergtroejen, inden for et privat baand pr.
// loebsgruppe; bjergtroejens vinder har udbrudspoint i en maerkbar del af loebene.
// Baandet og dommen hoerer til gate-sporet (testporten); her er kun maalingen.
//
// Brug: pr. koersel af et etapeloeb (én revision, ét seed) foedes hver etapes
// passager og dagens udbrudsryttere til `accumulateKomStage`, og slutklassementet
// til `stageRaceJerseyOutcome`. `komGcOverlap` samler koerslerne.
//
// HARD RULE 17: funktionen returnerer andele; de maalte tal skrives kun privat
// (balance-internals/), aldrig i repoet.
//
// Refs #6937 #6804

/** Tom bjergkonto for ét etapeloeb. */
export function emptyKomAccount() {
  return { points: new Map(), breakawayPoints: new Map(), summitPoints: new Map() };
}

/**
 * Laegger én etapes bjergpoint til kontoen. `passages` er motorens passager
 * (kind "kom" med results[].points), `breakawayRiderIds` dagens udbrudsryttere
 * (point taget af en af dem paa en bjergtop undervejs taeller som udbrudspoint),
 * `finishKm` etapens laengde (en top paa maalstregen er en topankomst).
 * Returnerer en NY konto; input muteres aldrig.
 */
export function accumulateKomStage(account, { passages = [], breakawayRiderIds = new Set(), finishKm = Infinity } = {}) {
  const next = {
    points: new Map(account.points),
    breakawayPoints: new Map(account.breakawayPoints),
    summitPoints: new Map(account.summitPoints),
  };
  const add = (m, id, v) => m.set(id, (m.get(id) ?? 0) + v);
  for (const p of passages) {
    if (p?.kind !== "kom") continue;
    const summit = Number(p.km) >= Number(finishKm) - 0.05;
    for (const r of p.results ?? []) {
      const pts = Number(r.points) || 0;
      if (!pts) continue;
      add(next.points, r.rider_id, pts);
      if (summit) add(next.summitPoints, r.rider_id, pts);
      else if (breakawayRiderIds.has(r.rider_id)) add(next.breakawayPoints, r.rider_id, pts);
    }
  }
  return next;
}

/**
 * Bjergtroejens vinder blandt `finisherIds` (ryttere der fuldfoerte loebet) med
 * troejens egen rangering: flest point, rider_id som taerskel (raceClassifications'
 * rankByCompDesc). Ingen point = ingen vinder.
 */
export function komWinnerOf(account, finisherIds) {
  let best = null;
  for (const id of finisherIds) {
    const pts = account.points.get(id) ?? 0;
    if (pts <= 0) continue;
    if (!best || pts > best.pts || (pts === best.pts && String(id).localeCompare(String(best.id)) < 0)) best = { id, pts };
  }
  return best?.id ?? null;
}

/** Ét etapeloebs udfald for G16: klassementsvinder, bjergtroejens vinder og hans udbrudspoint. */
export function stageRaceJerseyOutcome({ gcWinnerId, finisherIds, account }) {
  const komWinnerId = komWinnerOf(account, finisherIds);
  return {
    gcWinnerId: gcWinnerId ?? null,
    komWinnerId,
    komWinnerBreakawayPoints: komWinnerId ? account.breakawayPoints.get(komWinnerId) ?? 0 : 0,
    komWinnerSummitPoints: komWinnerId ? account.summitPoints.get(komWinnerId) ?? 0 : 0,
    komWinnerPoints: komWinnerId ? account.points.get(komWinnerId) ?? 0 : 0,
  };
}

/**
 * G16-maalingen over en raekke etapeloeb (`stageRaceJerseyOutcome`-raekker).
 * `gcWinsKomShare`: andel hvor klassementsvinderen ogsaa vandt bjergtroejen.
 * `komWinnerWithBreakawayPointsShare`: andel hvor bjergtroejens vinder har udbrudspoint.
 * Andele er null uden loeb (aerlig "ingen maaling", aldrig et opdigtet 0).
 */
export function komGcOverlap(outcomes) {
  const rows = outcomes.filter((o) => o && o.gcWinnerId != null);
  const n = rows.length;
  const gcWinsKom = rows.filter((o) => o.komWinnerId != null && o.komWinnerId === o.gcWinnerId).length;
  const withBreak = rows.filter((o) => o.komWinnerId != null && o.komWinnerBreakawayPoints > 0).length;
  return {
    n,
    gcWinsKom,
    gcWinsKomShare: n ? gcWinsKom / n : null,
    komWinnerWithBreakawayPoints: withBreak,
    komWinnerWithBreakawayPointsShare: n ? withBreak / n : null,
  };
}

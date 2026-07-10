// backend/lib/div4CascadeRepair.js
// #2276 — rene hjælpefunktioner til repair2276Div4Cascade.js (node --test'bare uden DB).
//
// To ansvar:
//  1. classifyIllegalTier4Races: find tier 4-løb der IKKE hører til den korrekte
//     kaskade-skabelon (ulovlig klasse, cross-tier-dedup-brud mod tier 1-3, eller
//     pulje A's gamle/skæve ekstra-løb der afviger fra de øvrige 7 puljers signatur).
//  2. computeFinanceReversals: udled pr.-hold tilbageførsler fra finance_transactions
//     (type prize + sponsor_race_day) for et sæt løb-id'er, idempotent nøglet.

import { TIER_CLASS_WHITELIST } from "./tierRaceSelection.js";

/**
 * Find den "kanoniske" signatur (stages, game_day_start) pr. løbsnavn på tværs af
 * tier 4-puljerne — flertallet vinder. Bruges til at opdage pulje A's afvigende
 * datoer/ekstra løb (#2276: "7 fælles løb på forkerte dage", "27 vs 17 løb").
 *
 * @param {Map<number|string, Array<{id, name, race_class, stages, game_day_start}>>} racesByPool
 * @returns {Map<string, { stages: number, game_day_start: number, count: number }>}
 */
export function computeCanonicalSignatures(racesByPool) {
  const byName = new Map(); // name -> Map(sigKey -> count)
  for (const races of racesByPool.values()) {
    for (const r of races) {
      if (r.name == null) continue;
      const sigKey = `${r.stages}:${r.game_day_start}`;
      if (!byName.has(r.name)) byName.set(r.name, new Map());
      const counts = byName.get(r.name);
      counts.set(sigKey, (counts.get(sigKey) || 0) + 1);
    }
  }
  const canonical = new Map();
  for (const [name, counts] of byName) {
    let bestKey = null, bestCount = -1;
    for (const [sigKey, count] of counts) {
      if (count > bestCount) { bestKey = sigKey; bestCount = count; }
    }
    const [stages, gameDayStart] = bestKey.split(":");
    canonical.set(name, { stages: Number(stages), game_day_start: Number(gameDayStart), count: bestCount });
  }
  return canonical;
}

/**
 * Klassificér ALLE tier 4-løb (på tværs af 8 puljer) som lovlige eller ulovlige.
 *
 * Et løb er ULOVLIGT hvis mindst ét er sandt:
 *  (a) race_class er uden for tier 4-whitelisten (Class1/Class2) — kaskade-brud.
 *  (b) navnet allerede kører i tier 1-3 samme sæson — cross-tier-dedup-brud.
 *  (c) navnet optræder i under halvdelen af puljerne (ikke en delt kalender-post),
 *      ELLER dets (stages, game_day_start) afviger fra flertallets kanoniske signatur
 *      for det navn (pulje A's gamle skæve datoer/ekstra løb).
 *
 * @param {{ racesByPool: Map, tier1to3Names?: Set<string>, classWhitelist?: string[] }} args
 * @returns {{ toDelete: Array<{id, pool_id, name, race_class, stages, game_day_start, reasons: string[]}>, canonicalTemplate: Array<{name, stages, game_day_start}> }}
 */
export function classifyIllegalTier4Races({
  racesByPool, tier1to3Names = new Set(), classWhitelist = TIER_CLASS_WHITELIST[4],
} = {}) {
  const allowedClasses = new Set(classWhitelist ?? []);
  const poolCount = racesByPool.size;
  const canonical = computeCanonicalSignatures(racesByPool);

  const toDelete = [];
  const legalNames = new Set();

  for (const [poolId, races] of racesByPool) {
    for (const r of races) {
      const reasons = [];
      if (r.race_class != null && !allowedClasses.has(r.race_class)) {
        reasons.push(`illegal-class:${r.race_class}`);
      }
      if (r.name != null && tier1to3Names.has(r.name)) {
        reasons.push("cross-tier-dedup");
      }
      const canon = r.name != null ? canonical.get(r.name) : null;
      if (!canon || canon.count < Math.ceil(poolCount / 2)) {
        reasons.push("not-shared-across-pools");
      } else if (canon.stages !== r.stages || canon.game_day_start !== r.game_day_start) {
        reasons.push("stale-signature");
      }
      if (reasons.length) {
        toDelete.push({ id: r.id, pool_id: poolId, name: r.name, race_class: r.race_class, stages: r.stages, game_day_start: r.game_day_start, status: r.status ?? null, reasons });
      } else {
        legalNames.add(r.name);
      }
    }
  }

  const canonicalTemplate = [...legalNames].sort().map((name) => {
    const c = canonical.get(name);
    return { name, stages: c.stages, game_day_start: c.game_day_start };
  });

  return { toDelete, canonicalTemplate };
}

/**
 * #2276 fuld nulstilling (arkitekt-beslutning 10/7): sletnings-scope er ALLE tier 4-løb i
 * sæsonen — ikke kun de kaskade-ulovlige — så alle 8 puljer garanteret har kørt samme løb
 * ved sæsonslut. Ren partition af løbene i:
 *  - toReverse: afviklede (status=completed ELLER prize_paid_at sat) — kræver finance-
 *    reversering FØR sletning.
 *  - toDeleteScheduled: alle øvrige (scheduled/aktive) — slettes direkte.
 * Alle løb i BEGGE lister slettes; opdelingen styrer kun reverserings-trinnet + dry-run-
 * rapporteringen.
 *
 * @param {{ races: Array<{id, name, race_class, status, prize_paid_at, league_division_id}> }} args
 * @returns {{ toReverse: Array, toDeleteScheduled: Array, allIds: Array }}
 */
export function partitionTier4FullReset({ races = [] } = {}) {
  const toReverse = [];
  const toDeleteScheduled = [];
  for (const r of races) {
    if (r.status === "completed" || r.prize_paid_at != null) toReverse.push(r);
    else toDeleteScheduled.push(r);
  }
  return { toReverse, toDeleteScheduled, allIds: races.map((r) => r.id) };
}

/**
 * Udled pr.-hold finance-tilbageførsler for et sæt (allerede afviklede, ulovlige)
 * løb-id'er. Summerer type=prize + type=sponsor_race_day pr. hold pr. løb (issue
 * #2276: begge typer er race_id-keyed indkomst der skal reverseres), nøglet
 * idempotent pr. (raceId, teamId) — IKKE pr. transaktion, så et genkørt dry-run/live
 * ikke dobbelt-reverserer selvom transaktionerne var to separate rækker.
 *
 * @param {{ transactions: Array<{race_id, team_id, type, amount}>, raceIds: Array }} args
 * @returns {Array<{ raceId, teamId, amount, idempotencyKey }>}
 */
export function computeFinanceReversals({ transactions = [], raceIds = [] } = {}) {
  const raceIdSet = new Set(raceIds);
  const REVERSIBLE_TYPES = new Set(["prize", "sponsor_race_day"]);
  const byKey = new Map(); // `${raceId}:${teamId}` -> total amount paid out

  for (const tx of transactions) {
    if (!raceIdSet.has(tx.race_id)) continue;
    if (!REVERSIBLE_TYPES.has(tx.type)) continue;
    if (!Number.isFinite(tx.amount) || tx.amount === 0) continue;
    const key = `${tx.race_id}:${tx.team_id}`;
    byKey.set(key, (byKey.get(key) || 0) + tx.amount);
  }

  const reversals = [];
  for (const [key, totalPaid] of byKey) {
    const [raceId, teamId] = key.split(":");
    if (totalPaid === 0) continue;
    reversals.push({
      raceId, teamId, amount: -totalPaid,
      idempotencyKey: `race_prize_reversal:${raceId}:${teamId}`,
    });
  }
  return reversals;
}

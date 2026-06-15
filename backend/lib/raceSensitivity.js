// Per-evne følsomheds-probe (#1122 — "evner skal faktisk afgøre løb").
//
// For en given evne: vælg en probe-rytter (median-overall) i et samplet felt,
// scor feltet, bump KUN probens evne med +delta, scor igen med SAMME seed+felt,
// og mål probens rank-forbedring. Gentaget over `samples` deterministiske felter.
// ≈0 gennemsnitlig gevinst = evnen er dødvægt i motoren. Ren funktion, ingen DB.
//
// Determinisme: makeRng(mulberry32) + stableSeed (FNV-1a), begge fra motoren.

import { makeRng } from "./fictionalRiderGenerator.js";
import { simulateStage, stableSeed } from "./raceSimulator.js";

export const SENSITIVITY_DELTA = 12; // +12 evne-point ≈ et tier-spring

function sampleField(rng, pool, n) {
  const idx = pool.map((_, i) => i);
  const take = Math.min(n, idx.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, take).map((i) => pool[i]);
}

/**
 * @param {object} args
 *   field: [{ id, overall, abilities }]  (in-memory dry-run-felt)
 *   profileType, demandVector: etapens terræn
 *   ability: evne-nøglen der perturberes
 *   delta: perturbation (default SENSITIVITY_DELTA)
 *   samples, fieldSize, seed: sampling
 *   finaleType: valgfri (til descending-finale-modifier)
 *   withCondition: hvis true, bæres r.form/r.fatigue ind (til durability-seam)
 * @returns {number} gennemsnitlig rank-forbedring (positiv = evnen hjælper)
 */
export function abilityRankSensitivity({
  field, profileType, demandVector, ability,
  delta = SENSITIVITY_DELTA, samples = 200, fieldSize = 60, seed = 2026,
  finaleType = null, withCondition = false,
}) {
  const rng = makeRng(stableSeed(`sens:${seed}:${profileType}:${ability}`));
  const stageProfile = { profile_type: profileType, demand_vector: demandVector, ...(finaleType ? { finale_type: finaleType } : {}) };
  const toEntrant = (r) => ({
    rider_id: r.id, team_id: r.id, abilities: r.abilities,
    ...(withCondition && r.form != null ? { form: r.form } : {}),
    ...(withCondition && r.fatigue != null ? { fatigue: r.fatigue } : {}),
  });

  let gainSum = 0, n = 0;
  for (let i = 0; i < samples; i++) {
    const sample = sampleField(rng, field, fieldSize);
    if (sample.length < 4) continue;
    const byOvr = [...sample].sort((a, b) => b.overall - a.overall || String(a.id).localeCompare(String(b.id)));
    const probe = byOvr[Math.floor(byOvr.length / 2)]; // median-overall
    const raceSeed = stableSeed(`${profileType}:${ability}:${i}`);

    const baseEntrants = sample.map(toEntrant);
    const baseRanked = simulateStage({ entrants: baseEntrants, stageProfile, seed: raceSeed }).ranked;
    const baseRank = baseRanked.find((r) => r.rider_id === probe.id).rank;

    const bumped = { ...probe.abilities, [ability]: Math.min(99, (Number(probe.abilities[ability]) || 0) + delta) };
    const pertEntrants = baseEntrants.map((e) => (e.rider_id === probe.id ? { ...e, abilities: bumped } : e));
    const pertRanked = simulateStage({ entrants: pertEntrants, stageProfile, seed: raceSeed }).ranked;
    const pertRank = pertRanked.find((r) => r.rider_id === probe.id).rank;

    gainSum += baseRank - pertRank; // lavere rank-tal = bedre → positiv gevinst
    n++;
  }
  return n ? gainSum / n : 0;
}

/**
 * Aggression driver udbruds-CHANCEN (ikke rank direkte), så en enkelt-rytter
 * rank-probe er for støjende. Robust aggregat: kør feltet over `races` på et
 * udbruds-egnet terræn og mål forskellen i udbruds-DELTAGELSES-rate
 * (components.breakaway > 0) mellem top- og bund-aggression-tercilen.
 * Aggression-EVNEN driver udvælgelsen ⇒ klart positiv forskel; proxy/død ⇒ ~0.
 * @returns {number} top-tercil-deltagelsesrate − bund-tercil-deltagelsesrate
 */
export function breakawayParticipationGapByAggression({
  field, profileType, demandVector, races = 300, fieldSize = 140, seed = 2026,
}) {
  const rng = makeRng(stableSeed(`bwgap:${seed}:${profileType}`));
  const rec = new Map(field.map((r) => [r.id, { agg: Number(r.abilities?.aggression) || 0, hits: 0, starts: 0 }]));
  for (let i = 0; i < races; i++) {
    const sample = sampleField(rng, field, fieldSize);
    if (sample.length < 4) continue;
    const entrants = sample.map((r) => ({ rider_id: r.id, team_id: r.id, abilities: r.abilities }));
    const { ranked } = simulateStage({
      entrants,
      stageProfile: { profile_type: profileType, demand_vector: demandVector },
      seed: stableSeed(`${profileType}:bwgap:${i}`),
    });
    for (const r of ranked) {
      const e = rec.get(r.rider_id);
      e.starts++;
      if (r.components.breakaway > 0) e.hits++;
    }
  }
  const recs = [...rec.values()].filter((r) => r.starts > 0).sort((a, b) => a.agg - b.agg);
  if (recs.length < 6) return 0;
  const t = Math.floor(recs.length / 3);
  const rate = (arr) => {
    const s = arr.reduce((a, r) => a + r.starts, 0);
    return s ? arr.reduce((a, r) => a + r.hits, 0) / s : 0;
  };
  return rate(recs.slice(-t)) - rate(recs.slice(0, t));
}

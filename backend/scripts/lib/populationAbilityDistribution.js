// backend/scripts/lib/populationAbilityDistribution.js
// #4936: populations-snapshottet fra juli var skaevt (median climbing/endurance/
// tempo = 1 af 99) uden at harnesset selv viste det nogen steder — man skulle
// selv koere ad-hoc SQL for at opdage det. Denne fil giver headToHeadV4.js og
// v4TailSpread.js en FAELLES, ren funktion der printer populationens p10/p50/p90
// pr. evne oeverst i output, saa et fremtidigt forældet/skaevt snapshot ses med
// det samme naar man koerer harnesset — ikke kun ved en separat SQL-maaling.
//
// 100% REN: ingen IO, samme percentil-metode (naermeste-rang) som
// headToHeadStats.js's percentile() og exportPopulationSnapshot.js's egen
// percentile()-helper, saa tallene her er sammenlignelige med begge.

import { percentile } from "./headToHeadStats.js";

// De seks evner #4936 bad om at faa vist (issue-titlen: "median climbing/
// endurance/tempo = 1 af 99" + flat/sprint-skaevheden fra samme audit).
// Bevidst IKKE hele ABILITY_KEYS — punch/time_trial/etc. er ikke en del af
// #4936's rapporterede skaevhed, og en kortere liste holder linjen laesbar.
export const DEFAULT_DISTRIBUTION_ABILITIES = Object.freeze([
  "climbing",
  "flat",
  "sprint",
  "endurance",
  "tempo",
  "descending",
]);

/**
 * p10/p50/p90 pr. evne for en liste af population-riders (exportPopulationSnapshot.js-
 * formatet: `{ abilities: { climbing, flat, ... } }` pr. rytter).
 * @param {Array<{abilities?: Record<string, number|null>}>} riders
 * @param {readonly string[]} [abilityKeys]
 * @returns {Array<{ability: string, p10: number|null, p50: number|null, p90: number|null, n: number}>}
 */
export function computeAbilityDistribution(riders, abilityKeys = DEFAULT_DISTRIBUTION_ABILITIES) {
  const values = new Map(abilityKeys.map((key) => [key, []]));
  for (const rider of riders ?? []) {
    for (const key of abilityKeys) {
      const v = rider?.abilities?.[key];
      if (Number.isFinite(v)) values.get(key).push(v);
    }
  }
  return abilityKeys.map((key) => {
    const vals = values.get(key);
    return {
      ability: key,
      n: vals.length,
      p10: percentile(vals, 10),
      p50: percentile(vals, 50),
      p90: percentile(vals, 90),
    };
  });
}

/**
 * Formaterer distributionen som laesbare linjer, én pr. evne — beregnet til at
 * printes OEVERST i et harness-scripts output (headToHeadV4.js/v4TailSpread.js),
 * foer selve maalingen, saa en skaev/forældet population ses uden en separat
 * SQL-maaling.
 * @param {Array<{abilities?: Record<string, number|null>}>} riders
 * @param {readonly string[]} [abilityKeys]
 * @returns {string}
 */
export function formatAbilityDistribution(riders, abilityKeys = DEFAULT_DISTRIBUTION_ABILITIES) {
  const rows = computeAbilityDistribution(riders, abilityKeys);
  const fmtVal = (v) => (v === null ? "n/a" : String(v));
  const lines = ["Populationens evne-fordeling (p10/p50/p90, n pr. evne = ryttere med en gyldig vaerdi):"];
  for (const row of rows) {
    lines.push(`  ${row.ability}: p10=${fmtVal(row.p10)} p50=${fmtVal(row.p50)} p90=${fmtVal(row.p90)} (n=${row.n})`);
  }
  return lines.join("\n");
}

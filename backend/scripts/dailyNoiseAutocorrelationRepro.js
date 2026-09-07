// #4987 — repro-script: måler autokorrelation i dags-trænings-støjen ("over"/"under"/
// "normal" pr. dag) for syntetiske ryttere over N dage, MED og UDEN den nye mixer.
//
// Kald: node backend/scripts/dailyNoiseAutocorrelationRepro.js
//
// Output: for hver mixer, andelen af ryttere der har NUL "over"-dage ud af N dage
// (forventet ved uafhængig 1/3-sandsynlighed pr. dag: (2/3)^N ≈ 0,02 % for N=60),
// samt den samlede over/normal/under-fordeling (bør være ~1/3-1/3-1/3 for begge).
import crypto from "node:crypto";
import { seededUnit, seededUnitMixed } from "../lib/riderProgression.js";

const RIDER_COUNT = 200;
const DAY_COUNT = 60;
const NOISE_SPAN = 0.15; // samme som DAILY_TRAINING_CONFIG.noiseSpan

// UUID-lignende id'er (samme format som `rider.id` i prod — Supabase uuid), ikke
// "rider0/rider1/…": FNV-1a's svaghed rammer HÅRDERE med rigtige uuid'er (målt
// her ~21-25 %, tæt på prods 25 % på 4.998 ryttere) end med korte sekventielle
// test-id'er (~4-5 %) — se PR-body for begge tal.
function makeRiderIds(count) {
  return Array.from({ length: count }, () => crypto.randomUUID());
}

function dateStrFor(dayIndex) {
  // Fortløbende kalenderdatoer — ægte "kun halen ændrer sig"-mønster.
  const d = new Date(Date.UTC(2026, 0, 1));
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d.toISOString().slice(0, 10);
}

function statusFor(noise) {
  return noise > 1.05 ? "over" : noise < 0.95 ? "under" : "normal";
}

function runMeasurement(hashFn, label, riderIds) {
  const dateStrs = Array.from({ length: DAY_COUNT }, (_, d) => dateStrFor(d));

  let zeroOverRiders = 0;
  const counts = { over: 0, normal: 0, under: 0 };
  const perRiderOverCounts = [];

  for (const riderId of riderIds) {
    let overDays = 0;
    for (const dateStr of dateStrs) {
      const unit = hashFn(`dtick:${riderId}:${dateStr}`);
      const noise = 1 - NOISE_SPAN + 2 * NOISE_SPAN * unit;
      const status = statusFor(noise);
      counts[status]++;
      if (status === "over") overDays++;
    }
    perRiderOverCounts.push(overDays);
    if (overDays === 0) zeroOverRiders++;
  }

  const total = RIDER_COUNT * DAY_COUNT;
  const zeroOverPct = (100 * zeroOverRiders) / RIDER_COUNT;
  const expectedZeroOverPct = 100 * Math.pow(2 / 3, DAY_COUNT);

  console.log(`\n=== ${label} ===`);
  console.log(`Ryttere med 0 "over"-dage ud af ${DAY_COUNT}: ${zeroOverRiders}/${RIDER_COUNT} (${zeroOverPct.toFixed(2)} %)`);
  console.log(`Forventet ved uafhængig 1/3-sandsynlighed: ~${expectedZeroOverPct.toFixed(4)} %`);
  console.log(`Samlet fordeling: over=${(100 * counts.over / total).toFixed(1)} % normal=${(100 * counts.normal / total).toFixed(1)} % under=${(100 * counts.under / total).toFixed(1)} %`);
  const maxOverDays = Math.max(...perRiderOverCounts);
  const minOverDays = Math.min(...perRiderOverCounts);
  console.log(`Spænd pr. rytter: min=${minOverDays} over-dage, max=${maxOverDays} over-dage (uafhængigt: forventet ~${(DAY_COUNT / 3).toFixed(1)} ± lille varians)`);

  return { zeroOverPct, counts };
}

console.log(`Repro #4987 — ${RIDER_COUNT} syntetiske ryttere (uuid) × ${DAY_COUNT} dage, dtick-nøgle`);
const riderIds = makeRiderIds(RIDER_COUNT);
const before = runMeasurement(seededUnit, "FØR (rå FNV-1a, seededUnit)", riderIds);
const after = runMeasurement(seededUnitMixed, "EFTER (avalanche-mixet, seededUnitMixed)", riderIds);

console.log("\n=== Konklusion ===");
console.log(`FØR:  ${before.zeroOverPct.toFixed(2)} % ryttere med 0 over-dage`);
console.log(`EFTER: ${after.zeroOverPct.toFixed(2)} % ryttere med 0 over-dage (mål: < 1 %)`);

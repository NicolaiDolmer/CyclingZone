// Sim-scorecard for ungdoms-modellen (#akademi-rework). Ingen DB. Kalibrerings-loop:
// kør → læs scorecard → justér YOUTH_GEN_CONFIG/YOUTH_PROGRESSION_CONFIG → gentag.
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { generateYouthStats } from "../lib/academyGenerator.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { buildYouthCaps, developRiderSeason } from "../lib/riderProgression.js";

const PHYS = ["climbing","time_trial","flat","tempo","sprint","acceleration","punch","endurance","recovery","durability"];
const archetypes = ["climber","sprinter","tt","gc","puncheur","brostensrytter","rouleur","baroudeur"];

function topOf(ab) { return Math.max(...PHYS.map((k) => ab[k] ?? 0)); }

function simulateOne({ rng, potentiale, archetypeType, startAge, seasons }) {
  const { stats } = generateYouthStats({ rng, age: startAge, potentiale, archetypeType });
  const rider = { id: `sim-${potentiale}-${archetypeType}`, birthdate: `${2026 - startAge}-06-15`, potentiale, height: 178, weight: 66, ...stats };
  let ab = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
  const { primary, secondary } = computeRiderTypes(ab);
  const caps = buildYouthCaps(potentiale, primary.key, secondary.key);
  const startTop = topOf(ab);
  const journey = [{ age: startAge, top: startTop }];
  for (let s = 1; s <= seasons; s++) {
    const age = startAge + s;
    const dev = developRiderSeason({ id: rider.id, primary_type: primary.key, potentiale, age }, ab, caps, s);
    ab = dev.next;
    journey.push({ age, top: topOf(ab) });
  }
  return { potentiale, archetypeType, primaryType: primary.key, startTop, endTop: topOf(ab), journey };
}

function main() {
  const seasons = 14;
  console.log("=== Ungdoms-model scorecard ===");
  console.log("Start-evne ved 16 (top-evne) pr. potentiale:");
  for (const p of [2, 4, 6]) {
    const tops = archetypes.map((a) => simulateOne({ rng: makeRng(100 + p), potentiale: p, archetypeType: a, startAge: 16, seasons }).startTop);
    console.log(`  pot ${p}: top ved 16 = min ${Math.min(...tops)} · max ${Math.max(...tops)}`);
  }
  console.log("\nRejse (top-evne over alder) for en climber:");
  for (const p of [2, 4, 6]) {
    const r = simulateOne({ rng: makeRng(7), potentiale: p, archetypeType: "climber", startAge: 16, seasons });
    console.log(`  pot ${p}: ${r.journey.map((j) => `${j.age}:${j.top}`).join("  ")}  → loft-nået ${r.endTop}`);
  }
  // KARIKATUR-CHECK: ægte "huller" = evner i absolut bund (≤3). En flad, lav profil
  // med bund ~7 er BY DESIGN (ikke et hul) — derfor måler vi ≤3, ikke ≤8.
  console.log("\nKARIKATUR-CHECK (16-årige): huller (afledt evne ≤3) skal være ~0; bund er flad-lav by design:");
  let holeCount = 0, bottomSum = 0, n = 0;
  for (const a of archetypes) for (const p of [2, 4, 6]) {
    const { stats } = generateYouthStats({ rng: makeRng(n + 1), age: 16, potentiale: p, archetypeType: a });
    const rider = { id: `c${n}`, birthdate: "2010-06-15", potentiale: p, height: 175, weight: 62, ...stats };
    const ab = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
    holeCount += PHYS.filter((k) => (ab[k] ?? 0) <= 3).length;
    bottomSum += Math.min(...PHYS.map((k) => ab[k] ?? 0));
    n++;
  }
  console.log(`  snit huller (≤3) pr. ung: ${(holeCount / n).toFixed(2)} (mål: ~0)  ·  snit bund-evne: ${(bottomSum / n).toFixed(1)} (forventet ~7)`);
}

main();

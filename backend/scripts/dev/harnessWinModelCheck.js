#!/usr/bin/env node
// #1267 · Realisme-tjek af boardSatisfactionHarness'ets sejrs-model.
// =============================================================================
// Owner-besluttet verifikations-skridt (14/6): board-satisfaction-harnesset
// fordeler etapesejre via et per-HOLD lotteri vægtet med team-strength² (én
// skalar pr. hold). Spørgsmålet: over-koncentrerer den sejre vs. den ÆGTE
// light-race-motor (#1102), som afgør hver etape på den bedste RYTTERs
// terrain-score mod etapens profil + støj — dvs. sejre spredes pr. specialisering
// (klatrer vinder bjerg, sprinter vinder fladt) over et varieret terræn.
//
// Metode: form 22 hold med PRÆCIS samme svag/middel/stærk-fordeling (25/50/25)
// som harnesset bruger, men byg holdene af ÆGTE fiktive ryttere (samme værdikæde
// som prod) og kør en hel sæson (30 etaper, varieret terræn) gennem simulateStage.
// Tæl etapesejre pr. hold. Eneste forskel mod harnesset = sejrs-modellen.
//
// Nøgletal: andel hold der vinder 0 etaper (driver bag board-konsekvens-raten).
//   node scripts/dev/harnessWinModelCheck.js [--seed=1187]
// Ren in-memory, rører intet i prod/DB.

import { generateFictionalRiders, makeRng } from "../../lib/fictionalRiderGenerator.js";
import { deriveAbilities } from "../../lib/abilityDerivation.js";
import { riderOverall } from "../../lib/riderValuation.js";
import { DEMAND_VECTORS } from "../../lib/raceStageProfileGenerator.js";
import { simulateStage, stableSeed } from "../../lib/raceSimulator.js";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
}
const SEED = parseInt(arg("seed", "1187"), 10);
// Hold-dannelse: "banded" = elite-ryttere stables på de stærke hold (svag/middel/
// stærk-arketyper som harnesset); "snake" = serpentine-draft = balancerede hold
// (talent spredt jævnt — som hvis alle managers drafter lige godt). Virkeligheden
// (auktioner + varierende budget/skill) ligger imellem.
const DRAFT = arg("draft", "banded");
// At stille ALLE ryttere op i hver etape er det mest koncentrerende ekstrem (samme
// elite-specialist vinder hver etape af sin type). I virkeligheden varierer felterne
// pr. løb. --participation=p lader hver rytter deltage med sandsynlighed p pr. etape
// (forskellige felter → flere forskellige vindere), så vi kan afgrænse opadtil.
const PARTICIPATION = parseFloat(arg("participation", "1"));

// Harnessets population: 22 human-hold, arketyper svag 25 % / middel 50 % / stærk 25 %.
const TEAMS = 22;
const RIDERS_PER_TEAM = 13;          // median trup-størrelse i fixturet
const TIERS = [
  { key: "stærk", count: 6 },        // ~25 %
  { key: "middel", count: 11 },      // ~50 %
  { key: "svag", count: 5 },         // ~25 %
];

// En realistisk Grand-Tour-lignende sæson: 30 etaper, varieret terræn, så sejre
// kan fordeles pr. specialisering (det harnesset IKKE kan modellere).
const SEASON = [
  ...Array(10).fill("flat"),
  ...Array(2).fill("rolling"),
  ...Array(4).fill("hilly"),
  ...Array(6).fill("mountain"),
  ...Array(3).fill("high_mountain"),
  ...Array(3).fill("itt"),
  ...Array(2).fill("cobbles"),
]; // = 30

// ── 1. Generér rytter-pool via den ægte værdikæde ────────────────────────────
const { riders: raw } = generateFictionalRiders({ count: 600, seed: SEED, referenceYear: 2026 });
const pool = raw.map((r, i) => {
  const id = `r${i}`;
  const abilities = deriveAbilities({}, { ...r, id }, { asOfYear: 2026 });
  return { id, abilities, overall: riderOverall(abilities) };
}).sort((a, b) => b.overall - a.overall);

// ── 2. Båndinddel poolen og byg hold pr. tier ────────────────────────────────
// Stærke hold trækkes fra toppen, middel fra midten, svage fra bunden — så
// hold-styrke-fordelingen spejler harnessets arketyper. Inden for hvert bånd
// fordeles ryttere round-robin, så hold i samme tier er omtrent lige stærke.
const needed = TEAMS * RIDERS_PER_TEAM; // 286
const usable = pool.slice(0, needed); // sorteret overall desc
const teams = [];

if (DRAFT === "snake") {
  // Serpentine draft → balancerede hold (hvert hold får ~lige andel af eliten).
  const buckets = Array.from({ length: TEAMS }, () => []);
  usable.forEach((rider, i) => {
    const round = Math.floor(i / TEAMS);
    const pos = i % TEAMS;
    const teamIdx = round % 2 === 0 ? pos : TEAMS - 1 - pos;
    buckets[teamIdx].push(rider);
  });
  buckets.forEach((riders, i) => teams.push({
    id: `snake-${i}`, tier: "balanced", riders,
    avgOverall: Math.round(riders.reduce((s, r) => s + r.overall, 0) / riders.length),
    stageWins: 0,
  }));
} else {
  // Banded → svag/middel/stærk-arketyper (spejler harnessets fordeling).
  let cursor = 0;
  for (const tier of TIERS) {
    const size = tier.count * RIDERS_PER_TEAM;
    const bandRiders = usable.slice(cursor, cursor + size);
    cursor += size;
    const teamBuckets = Array.from({ length: tier.count }, () => []);
    bandRiders.forEach((rider, idx) => teamBuckets[idx % tier.count].push(rider));
    teamBuckets.forEach((riders, i) => teams.push({
      id: `${tier.key}-${i}`, tier: tier.key, riders,
      avgOverall: Math.round(riders.reduce((s, r) => s + r.overall, 0) / riders.length),
      stageWins: 0,
    }));
  }
}

const teamByRider = new Map();
for (const team of teams) for (const r of team.riders) teamByRider.set(r.id, team);
const allEntrants = teams.flatMap((t) => t.riders.map((r) => ({ rider_id: r.id, team_id: t.id, abilities: r.abilities })));

// ── 3. Kør sæsonen gennem den ægte motor ─────────────────────────────────────
const partRng = makeRng((stableSeed(`participation:${SEED}`) ^ 0x9e3779b9) >>> 0);
for (let i = 0; i < SEASON.length; i++) {
  const terrain = SEASON[i];
  const demand = DEMAND_VECTORS[terrain];
  const entrants = PARTICIPATION >= 1
    ? allEntrants
    : allEntrants.filter(() => partRng() < PARTICIPATION);
  if (entrants.length < 4) continue;
  const { ranked } = simulateStage({
    entrants,
    stageProfile: { profile_type: terrain, demand_vector: demand },
    seed: stableSeed(`winmodel:${SEED}:${terrain}:${i}`),
  });
  teamByRider.get(ranked[0].rider_id).stageWins += 1;
}

// ── 4. Rapport ───────────────────────────────────────────────────────────────
const zeroWin = teams.filter((t) => t.stageWins === 0);
const byTier = {};
for (const t of teams) {
  byTier[t.tier] = byTier[t.tier] || { n: 0, zero: 0, wins: 0 };
  byTier[t.tier].n += 1;
  byTier[t.tier].wins += t.stageWins;
  if (t.stageWins === 0) byTier[t.tier].zero += 1;
}

console.log(`\n#1267 · ÆGTE RACE-MOTOR — sejrs-fordeling over en sæson (seed ${SEED}, draft=${DRAFT})`);
console.log(`Population: ${TEAMS} hold × ${RIDERS_PER_TEAM} ryttere · ${SEASON.length} etaper · terræn: ${[...new Set(SEASON)].join("/")}`);
console.log(`Pool overall: max ${pool[0].overall} · median ${pool[Math.floor(pool.length / 2)].overall} · min(usable) ${usable[usable.length - 1].overall}\n`);
console.log(`Hold der vinder 0 etaper: ${zeroWin.length}/${TEAMS} (${Math.round(zeroWin.length / TEAMS * 100)} %)`);
console.log(`(Harnessets squared-lotteri: ~50 % af holdene vinder 0 → driver bag 45-50 % konsekvens-rate)\n`);
console.log("Pr. tier:");
for (const [tier, s] of Object.entries(byTier)) {
  console.log(`  ${tier.padEnd(7)} n=${s.n} · 0-sejrs-hold ${s.zero}/${s.n} · sejre i alt ${s.wins}`);
}
console.log("\nPr. hold (sorteret efter sejre):");
for (const t of [...teams].sort((a, b) => b.stageWins - a.stageWins)) {
  console.log(`  ${t.id.padEnd(10)} tier=${t.tier.padEnd(7)} avgOvr=${t.avgOverall} → ${t.stageWins} etapesejre`);
}

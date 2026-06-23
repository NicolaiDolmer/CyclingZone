// Promotion/relegation balance-simulering for CZ-pyramiden (#1152).
//
// Formål: empirisk dry-run FØR ship (jf. simulér-før-ship-reglen) af per-pulje
// op/nedrykning i fan-out-pyramiden (1/2/4/8 puljer), mod den FAKTISKE prod-
// population pr. 2026-06-23. Tester flere count-skemaer og rapporterer:
//   - ægte-hold-fordeling pr. division over sæsoner
//   - overflow (en pulje får >24 ægte hold → AI kan ikke trimmes nok)
//   - pulje-størrelses-stabilitet
//
// Kør: node scripts/dev/sim-promotion-relegation.mjs
//
// Modellen er bevidst simpel og deterministisk (seeded PRNG): hvert hold har en
// fast "skill"; sæson-placering = skill + støj; top promoveres, bund relegeres;
// AI-fyld bringer hver pulje tilbage til 24 (tier 1+2 altid; tier 3+4 kun puljer
// med >=1 ægte hold). Den tester SYSTEM-stabilitet, ikke konkrete hold.

const POOL_TARGET = 24;
const POOLS_PER_TIER = { 1: 1, 2: 2, 3: 4, 4: 8 };
const TIERS = [1, 2, 3, 4];

// Seeded PRNG (mulberry32) — reproducerbar.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

let TEAM_SEQ = 1;
function makeTeam(real, rng) {
  return { id: TEAM_SEQ++, real, skill: gauss(rng) };
}

// Faktisk prod-population 2026-06-23: ægte managere pr. pulje.
const PROD_REAL = {
  1: [0],
  2: [0, 0],
  3: [7, 7, 6, 6],
  4: [0, 0, 0, 0, 0, 0, 0, 0],
};

function makeInitialState(rng) {
  // state[tier] = array of pools; pool = array of teams
  const state = {};
  for (const tier of TIERS) {
    state[tier] = [];
    const realCounts = PROD_REAL[tier];
    for (let p = 0; p < POOLS_PER_TIER[tier]; p++) {
      const pool = [];
      const reals = realCounts[p] || 0;
      for (let i = 0; i < reals; i++) pool.push(makeTeam(true, rng));
      state[tier].push(pool);
    }
  }
  return state;
}

// AI-fyld: tier 1+2 altid op til 24; tier 3+4 kun puljer med >=1 ægte hold.
// Returnerer antal overflow-hændelser (pulje med >24 ægte hold).
function aiFill(state, rng) {
  let overflow = 0;
  for (const tier of TIERS) {
    for (const pool of state[tier]) {
      const reals = pool.filter((t) => t.real).length;
      const alwaysFill = tier === 1 || tier === 2;
      const shouldFill = alwaysFill || reals >= 1;
      // Fjern alle nuværende AI, genskab korrekt antal.
      const realsArr = pool.filter((t) => t.real);
      pool.length = 0;
      for (const t of realsArr) pool.push(t);
      if (reals > POOL_TARGET) { overflow++; continue; } // kan ikke trimme nok
      if (shouldFill) {
        const need = POOL_TARGET - reals;
        for (let i = 0; i < need; i++) pool.push(makeTeam(false, rng));
      }
    }
  }
  return overflow;
}

// Én sæson: placér hver pulje (skill+støj), promovér top / relegér bund.
function runSeason(state, scheme, rng) {
  const moves = []; // {team, fromTier, dir:+1 up / -1 down}
  for (const tier of TIERS) {
    const promoteN = tier === 1 ? 0 : (scheme.promote[tier] || 0);
    const relegateN = tier === 4 ? 0 : (scheme.relegate[tier] || 0);
    for (const pool of state[tier]) {
      if (pool.length === 0) continue;
      const ranked = [...pool].sort((a, b) => (b.skill + gauss(rng) * scheme.noise) - (a.skill + gauss(rng) * scheme.noise));
      const up = ranked.slice(0, promoteN);
      const down = ranked.slice(Math.max(promoteN, ranked.length - relegateN));
      for (const t of up) moves.push({ team: t, fromTier: tier, dir: +1 });
      for (const t of down) moves.push({ team: t, fromTier: tier, dir: -1 });
    }
  }
  // Fjern flyttede hold fra deres pulje.
  const moveSet = new Set(moves.map((m) => m.team.id));
  for (const tier of TIERS) for (const pool of state[tier]) {
    for (let i = pool.length - 1; i >= 0; i--) if (moveSet.has(pool[i].id)) pool.splice(i, 1);
  }
  // Indsæt i destination (round-robin over destinations-tierens puljer).
  for (const m of moves) {
    const destTier = Math.min(4, Math.max(1, m.fromTier - m.dir)); // up = lavere tier-nr
    const pools = state[destTier];
    // Vælg pulje med færrest ægte hold (spred ægte hold).
    let best = 0, bestReal = Infinity;
    for (let i = 0; i < pools.length; i++) {
      const r = pools[i].filter((t) => t.real).length;
      if (r < bestReal) { bestReal = r; best = i; }
    }
    pools[best].push(m.team);
  }
  return moves.length;
}

function addArrivals(state, entryTier, n, rng) {
  const pools = state[entryTier];
  for (let i = 0; i < n; i++) {
    let best = 0, bestReal = Infinity;
    for (let j = 0; j < pools.length; j++) {
      const r = pools[j].filter((t) => t.real).length;
      if (r < bestReal) { bestReal = r; best = j; }
    }
    pools[best].push(makeTeam(true, rng));
  }
}

function realPerTier(state) {
  const out = {};
  for (const tier of TIERS) out[tier] = state[tier].reduce((s, pool) => s + pool.filter((t) => t.real).length, 0);
  return out;
}
function maxRealInAnyPool(state) {
  let m = 0;
  for (const tier of TIERS) for (const pool of state[tier]) m = Math.max(m, pool.filter((t) => t.real).length);
  return m;
}

function simulate({ scheme, seasons, arrivalsPerSeason, entryTier, seed }) {
  const rng = makeRng(seed);
  TEAM_SEQ = 1;
  const state = makeInitialState(rng);
  aiFill(state, rng);
  let totalOverflow = 0;
  const log = [];
  for (let s = 1; s <= seasons; s++) {
    addArrivals(state, entryTier, arrivalsPerSeason, rng);
    runSeason(state, scheme, rng);
    totalOverflow += aiFill(state, rng);
    const rpt = realPerTier(state);
    log.push({ season: s, ...rpt, maxPool: maxRealInAnyPool(state), totalReal: rpt[1] + rpt[2] + rpt[3] + rpt[4] });
  }
  return { log, totalOverflow };
}

const SCHEMES = {
  "A: 2 op / 2 ned (fast, symmetrisk)": { promote: { 2: 2, 3: 2, 4: 2 }, relegate: { 1: 2, 2: 2, 3: 2 }, noise: 0.6 },
  "B: balanceret (op 1 / ned 2 i lavere div)": { promote: { 2: 1, 3: 1, 4: 1 }, relegate: { 1: 2, 2: 2, 3: 2 }, noise: 0.6 },
};

const SCENARIOS = [
  { name: "Ingen nye (kun de 26 nuvaerende)", arrivalsPerSeason: 0, entryTier: 4 },
  { name: "Vaekst: +8 nye/saeson via Div4", arrivalsPerSeason: 8, entryTier: 4 },
  { name: "Hoej vaekst: +20 nye/saeson via Div4", arrivalsPerSeason: 20, entryTier: 4 },
];

const SEASONS = 10;
console.log(`\n=== Promotion/relegation-simulering (start = prod 2026-06-23: 26 aegte i Div3, Div4 tom) ===`);
console.log(`Pyramide: Div1=1 pulje, Div2=2, Div3=4, Div4=8 puljer; POOL_TARGET=${POOL_TARGET}; ${SEASONS} saesoner; seed-snit af 5 koersler.\n`);

for (const [schemeName, scheme] of Object.entries(SCHEMES)) {
  console.log(`\n################ SKEMA ${schemeName} ################`);
  for (const scn of SCENARIOS) {
    // Gennemsnit over 5 seeds for robusthed.
    let agg = null, overflowSum = 0;
    const runs = 5;
    for (let k = 0; k < runs; k++) {
      const { log, totalOverflow } = simulate({ scheme, seasons: SEASONS, arrivalsPerSeason: scn.arrivalsPerSeason, entryTier: scn.entryTier, seed: 1000 + k });
      overflowSum += totalOverflow;
      if (!agg) agg = log.map((r) => ({ ...r }));
      else log.forEach((r, i) => { agg[i][1] += r[1]; agg[i][2] += r[2]; agg[i][3] += r[3]; agg[i][4] += r[4]; agg[i].maxPool = Math.max(agg[i].maxPool, r.maxPool); agg[i].totalReal += r.totalReal; });
    }
    console.log(`\n--- Scenarie: ${scn.name} (entry=Div${scn.entryTier}) ---`);
    console.log(`saeson | Div1 Div2 Div3 Div4 | maxAegtePulje | totalAegte`);
    for (const r of agg) {
      const d1 = (r[1] / runs).toFixed(1), d2 = (r[2] / runs).toFixed(1), d3 = (r[3] / runs).toFixed(1), d4 = (r[4] / runs).toFixed(1);
      console.log(`  ${String(r.season).padStart(2)}   | ${d1.padStart(4)} ${d2.padStart(4)} ${d3.padStart(4)} ${d4.padStart(4)} | ${String(r.maxPool).padStart(2)} (cap 24)     | ${(r.totalReal / runs).toFixed(0)}`);
    }
    console.log(`  Overflow-haendelser (pulje >24 aegte) over ${runs} koersler: ${overflowSum}`);
  }
}
console.log("\n=== slut ===\n");

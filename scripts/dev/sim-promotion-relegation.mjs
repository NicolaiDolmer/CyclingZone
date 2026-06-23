// Promotion/relegation balance-simulering for CZ-pyramiden (#1152).
//
// Modellen er EJER-BESLUTTET 23/6 (binaer-trae-pyramide):
//   - Hver pulje har 1 foraelder (tier over) + 2 boern (tier under): 1/2/4/8 puljer.
//     foraelder(T,i) = (T-1, floor(i/2)); boern(T,i) = (T+1, 2i) + (T+1, 2i+1).
//   - OP:  hver pulje rykker TOP 2 op til sin foraelder (2 puljer x 2 = 4 op samlet).
//   - NED: hver pulje relegerer 4, DELT 2+2 ud i sine to boerne-puljer.
//   - Entry: nye managere -> Div3, erstatter et AI-hold (maks 24/pulje).
//   - Div4 dormant indtil Div3 KUN er aegte managere; relegering til Div4 udskydes til da.
//
// Formaal: empirisk dry-run FOER ship (simuler-foer-ship). Verificerer at modellen
// balancerer (ingen overflow), og viser rampen mod Div4-aktivering.
// Koer: node scripts/dev/sim-promotion-relegation.mjs

const POOL_TARGET = 24;
const POOLS_PER_TIER = { 1: 1, 2: 2, 3: 4, 4: 8 };
const TIERS = [1, 2, 3, 4];
const PROMOTE_N = 2;   // top 2 op til foraelder
const RELEGATE_N = 4;  // bund 4 ned, delt 2+2 til boern

function makeRng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

let SEQ = 1;
function team(real, rng) { return { id: SEQ++, real, skill: gauss(rng) }; }
const key = (t, i) => `${t}-${i}`;
const parent = (t, i) => (t > 1 ? [t - 1, Math.floor(i / 2)] : null);
const children = (t, i) => (t < 4 ? [[t + 1, 2 * i], [t + 1, 2 * i + 1]] : []);

// Faktisk prod-population 2026-06-23.
const PROD_REAL = { 1: [0], 2: [0, 0], 3: [7, 7, 6, 6], 4: [0, 0, 0, 0, 0, 0, 0, 0] };

function makeState(rng) {
  const pools = new Map();
  for (const t of TIERS) for (let i = 0; i < POOLS_PER_TIER[t]; i++) {
    const arr = [];
    for (let r = 0; r < (PROD_REAL[t][i] || 0); r++) arr.push(team(true, rng));
    pools.set(key(t, i), { tier: t, idx: i, teams: arr, active: t <= 3 }); // Div4 dormant
  }
  return pools;
}

function poolFullReal(p) { return p.teams.length >= POOL_TARGET && p.teams.every((t) => t.real); }
// Per-pulje Div4-aktivering: en Div3-puljes Div4-boern aabnes naar DEN pulje er all-real.
function activateDiv4Children(pools, s, state) {
  for (let i = 0; i < 4; i++) {
    if (!poolFullReal(pools.get(key(3, i)))) continue;
    for (const [ct, ci] of children(3, i)) { const c = pools.get(key(ct, ci)); if (!c.active) { c.active = true; if (state.div4Season === null) state.div4Season = s; } }
  }
}

function aiFill(pools, rng) {
  let overflow = 0;
  for (const p of pools.values()) {
    if (!p.active) { p.teams = p.teams.filter((t) => t.real); continue; } // dormant: kun evt. aegte
    const reals = p.teams.filter((t) => t.real);
    if (reals.length > POOL_TARGET) { overflow++; p.teams = reals; continue; }
    p.teams = reals;
    while (p.teams.length < POOL_TARGET) p.teams.push(team(false, rng));
  }
  return overflow;
}

function poolWithMostAi(pools, tier) {
  let best = null, bestAi = -1;
  for (let i = 0; i < POOLS_PER_TIER[tier]; i++) {
    const p = pools.get(key(tier, i)); const ai = p.teams.filter((t) => !t.real).length;
    if (ai > bestAi) { bestAi = ai; best = p; }
  }
  return best;
}

function addArrivals(pools, n, rng) {
  for (let k = 0; k < n; k++) {
    // Foretraek Div3-pulje med AI (erstat AI). Hvis alle Div3 fyldt -> aktiv Div4-pulje med faerrest aegte.
    let target = null, bestAi = 0;
    for (let i = 0; i < 4; i++) { const p = pools.get(key(3, i)); const ai = p.teams.filter((t) => !t.real).length; if (ai > bestAi) { bestAi = ai; target = p; } }
    if (!target) { let bestReal = Infinity; for (let i = 0; i < 8; i++) { const p = pools.get(key(4, i)); if (!p.active) continue; const r = p.teams.filter((t) => t.real).length; if (r < bestReal) { bestReal = r; target = p; } } }
    if (target) target.teams.push(team(true, rng));
  }
}

function runSeason(pools, noise, rng) {
  const moves = [];
  for (const p of pools.values()) {
    if (!p.active || p.teams.length === 0) continue;
    const ranked = [...p.teams].sort((a, b) => (b.skill + gauss(rng) * noise) - (a.skill + gauss(rng) * noise));
    // OP: top 2 til foraelder
    if (p.tier > 1) for (const t of ranked.slice(0, PROMOTE_N)) moves.push({ team: t, to: parent(p.tier, p.idx) });
    // NED: bund 4 delt 2+2 til boern — kun hvis boern er aktive (Div3->Div4 udskudt til Div4 aktiv)
    const kids = children(p.tier, p.idx);
    const kidsActive = kids.length > 0 && pools.get(key(kids[0][0], kids[0][1])).active;
    if (kidsActive) {
      const bottom = ranked.slice(Math.max(PROMOTE_N, ranked.length - RELEGATE_N));
      bottom.forEach((t, j) => moves.push({ team: t, to: kids[j % 2] }));
    }
  }
  const moveIds = new Set(moves.map((m) => m.team.id));
  for (const p of pools.values()) p.teams = p.teams.filter((t) => !moveIds.has(t.id));
  for (const m of moves) pools.get(key(m.to[0], m.to[1])).teams.push(m.team);
  return moves.length;
}

function realPerTier(pools) {
  const o = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const p of pools.values()) o[p.tier] += p.teams.filter((t) => t.real).length;
  return o;
}
function maxRealPool(pools) { let m = 0; for (const p of pools.values()) m = Math.max(m, p.teams.filter((t) => t.real).length); return m; }

function simulate({ seasons, arrivals, noise, seed }) {
  const rng = makeRng(seed); SEQ = 1;
  const pools = makeState(rng); aiFill(pools, rng);
  const state = { div4Season: null }; let overflow = 0; const log = [];
  for (let s = 1; s <= seasons; s++) {
    addArrivals(pools, arrivals, rng);
    runSeason(pools, noise, rng);
    overflow += aiFill(pools, rng);
    activateDiv4Children(pools, s, state);
    const rpt = realPerTier(pools);
    log.push({ s, ...rpt, max: maxRealPool(pools), total: rpt[1] + rpt[2] + rpt[3] + rpt[4] });
  }
  return { log, overflow, div4Season: state.div4Season };
}

const SCENARIOS = [
  { name: "Ingen nye (kun 26 nuvaerende)", arrivals: 0 },
  { name: "Vaekst +8/saeson", arrivals: 8 },
  { name: "Hoej vaekst +20/saeson", arrivals: 20 },
];
const SEASONS = 12, RUNS = 5, NOISE = 0.6;

console.log(`\n=== Ejer-model (binaer-trae): op 2 -> foraelder, ned 4 delt 2+2 -> boern ===`);
console.log(`Start = prod 23/6 (26 aegte i Div3, Div4 tom). ${SEASONS} saesoner, snit af ${RUNS} seeds. Entry=Div3 (erstat AI) til Div3 all-real -> Div4.\n`);
for (const scn of SCENARIOS) {
  let agg = null, ovf = 0; const d4 = [];
  for (let k = 0; k < RUNS; k++) {
    const { log, overflow, div4Season } = simulate({ seasons: SEASONS, arrivals: scn.arrivals, noise: NOISE, seed: 1000 + k });
    ovf += overflow; d4.push(div4Season);
    if (!agg) agg = log.map((r) => ({ ...r })); else log.forEach((r, i) => { agg[i][1] += r[1]; agg[i][2] += r[2]; agg[i][3] += r[3]; agg[i][4] += r[4]; agg[i].max = Math.max(agg[i].max, r.max); agg[i].total += r.total; });
  }
  console.log(`\n--- ${scn.name} ---`);
  console.log(`saeson | Div1 Div2 Div3 Div4 | maxAegte/pulje | totalAegte`);
  for (const r of agg) console.log(`  ${String(r.s).padStart(2)}   | ${(r[1]/RUNS).toFixed(1).padStart(4)} ${(r[2]/RUNS).toFixed(1).padStart(4)} ${(r[3]/RUNS).toFixed(1).padStart(4)} ${(r[4]/RUNS).toFixed(1).padStart(4)} | ${String(r.max).padStart(2)} (cap 24)       | ${(r.total/RUNS).toFixed(0)}`);
  const d4s = d4.filter((x) => x !== null);
  console.log(`  Overflow: ${ovf} | Div4 aktiveret (saeson): ${d4s.length ? (d4s.reduce((a,b)=>a+b,0)/d4s.length).toFixed(1) : "ikke i " + SEASONS + " saesoner"}`);
}
console.log("\n=== slut ===\n");

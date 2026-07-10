// Anti-inversions-harness (#1543/#1162) — GATE for rest-bånd + loft-bånd.
//
// Simulerer en angriber der KENDER alle formler og ser ALT hvad serveren
// udleverer for en rytter på tværs af scout-levels (stjerne-bånd level 1..3).
// Angriberen forsøger at rekonstruere den sande potentiale via least-squares
// over de kendte lineære relationer (center_L = truth + bias·(1-level/max),
// rest-center = truth + rest-bias) — men kender IKKE de seedede bias-værdier.
//
// GATE: median |fejl| skal være ≥ 0.25 stjerner. Ellers er båndene reelt
// inverterbare og designet skal justeres (residualBiasFactor op / seeds afkobles).
//
// Kørsel: node scripts/scoutingInversionHarness.js   (ren simulering, ingen DB)
// Konfiguration valideret 2026-07-07: residualHalfWidth 0.5 + PERSISTENT
// anchorBias 0.6 ("scout-anchor:"-seed, konstant på tværs af levels — det er
// konstansen der gør at averaging/least-squares ikke kan fjerne den).
// Scorecard ved validering: median 0.2641, p10 0.0522, fracBelow025 0.48.
//
// #2244 (Fase 3, Task A3): spejder-rating driver nu et gulv på rest-båndets
// halvbredde (scoutEngine.scoutHalfWidth). GATEN gentages for hver rating i
// {40,60,80,99} (default-spejder, to mellemtrin, topspejder) — et bedre
// rest-bånd-gulv må ikke gøre inversionen lettere ved nogen rating.
import { estimatePotentialRange, SCOUTING_CONFIG, seededUnit } from "../lib/scouting.js";

const SCOUT_RATINGS_TO_GATE = [40, 60, 80, 99];

const N = 2000;
const maxLevel = SCOUTING_CONFIG.maxLevel;

// Deterministisk pseudo-population (ingen Math.random — reproducérbart scorecard).
const riders = Array.from({ length: N }, (_, i) => ({
  id: `sim-r${i}`,
  truth: 1 + seededUnit(`truth:${i}`) * 5,          // uniform 1–6
  age: 17 + Math.floor(seededUnit(`age:${i}`) * 19), // 17–35
}));

// Angriber-strategier (kender formlerne, IKKE seeds). Angriberen vælger ÉN
// strategi globalt — ikke det bedste gæt pr. rytter (han kender ikke sandheden
// og kan derfor ikke cherry-picke). Gaten er den BEDSTE strategis median-fejl.
const STRATEGIES = {
  restMid: (mids) => mids[mids.length - 1],
  avgAll: (mids) => mids.reduce((a, b) => a + b, 0) / mids.length,
  // Least-squares på den kendte relation mid_L ≈ truth + B·(1-L/max) med rest
  // som ekstra observation (B_res ukendt, forventning 0 → behandles som støj):
  wls: (mids) => {
    // Vægte ∝ 1/varians af bias-leddet pr. level (bredere bias = lavere vægt).
    const ws = mids.map((_, i) => 1 / (1 + (1 - (i + 1) / maxLevel)));
    const wsum = ws.reduce((a, b) => a + b, 0);
    return mids.reduce((a, m, i) => a + m * ws[i], 0) / wsum;
  },
};

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(0.5 * (s.length - 1))];
};

function runForScout(scout) {
  const errsByStrategy = Object.fromEntries(Object.keys(STRATEGIES).map((k) => [k, []]));
  for (const r of riders) {
    const mids = [];
    for (let level = 1; level <= maxLevel; level++) {
      const e = estimatePotentialRange(r.truth, level, r.age, r.id, "attacker-team", maxLevel, scout);
      mids.push((e.lo + e.hi) / 2);
    }
    for (const [name, fn] of Object.entries(STRATEGIES)) {
      errsByStrategy[name].push(Math.abs(fn(mids) - r.truth));
    }
  }
  const perStrategy = Object.fromEntries(
    Object.entries(errsByStrategy).map(([k, errs]) => [k, +median(errs).toFixed(4)])
  );
  const bestStrategy = Object.entries(perStrategy).sort((a, b) => a[1] - b[1])[0];
  const medianError = bestStrategy[1];
  const bestErrs = errsByStrategy[bestStrategy[0]].slice().sort((a, b) => a - b);
  const p10Error = bestErrs[Math.floor(0.1 * (bestErrs.length - 1))];
  const fracBelow025 = bestErrs.filter((e) => e < 0.25).length / bestErrs.length;
  return {
    n: N,
    bestStrategy: bestStrategy[0],
    perStrategy,
    medianError,
    p10Error: +p10Error.toFixed(4),
    fracBelow025: +fracBelow025.toFixed(3),
  };
}

const scorecardsByRating = {};
let anyFail = false;
for (const overall of SCOUT_RATINGS_TO_GATE) {
  const scorecard = runForScout({ overall });
  scorecardsByRating[overall] = scorecard;
  if (scorecard.medianError < 0.25) {
    console.error(`FAIL (scout overall=${overall}): rest-båndet er reelt inverterbart`, scorecard);
    anyFail = true;
  } else {
    console.log(`PASS (scout overall=${overall})`, scorecard);
  }
}

if (anyFail) process.exit(1);
console.log("PASS — alle spejder-ratings", scorecardsByRating);

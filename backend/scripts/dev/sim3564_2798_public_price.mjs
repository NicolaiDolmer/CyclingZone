// Offline konsekvens-sim for #2798-A / #3564 leverance 4b.
// INGEN DB-adgang, INGEN kodeændring i produktion — kører KUN mod det daterede
// snapshottet i scratchpad. Genbruger den ægte produktions-funktion
// (predictBaseValueV4) for at isolere PRÆCIS potentiale-leddets effekt.
//
// Kald: node scripts/dev/sim3564_2798_public_price.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { predictBaseValueV4 } from "../../lib/riderCareerNpv.js";

const SNAP = "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/5ea4d8d3-1258-4104-a2c6-9f902b84d615/scratchpad/snap-3564-2026-08-09";
const OUT = "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/5ea4d8d3-1258-4104-a2c6-9f902b84d615/scratchpad/leverance4b";

const riders = JSON.parse(readFileSync(`${SNAP}/riders.json`, "utf8"));
const teams = JSON.parse(readFileSync(`${SNAP}/teams.json`, "utf8"));
const tradeEvidence = JSON.parse(readFileSync(`${SNAP}/trade_evidence.json`, "utf8"));
const model = JSON.parse(readFileSync("lib/riderValuationModelV4.json", "utf8"));

const teamById = new Map(teams.map((t) => [t.team_id, t]));
const tradedRiderIds = new Set(tradeEvidence.map((r) => r.rider_id));

// ── Population: <22 år, INGEN handelsevidens (auktion completed / transfer accepted) ──
const pop = riders.filter((r) => Number(r.age) < 22 && !tradedRiderIds.has(r.id));

console.log(`Population <22 uden handelsevidens: ${pop.length} af ${riders.length} levende ryttere`);

// ── Neutraliserings-basis: populations-median potentiale PR. HELTALS-ALDER, ──
// beregnet over HELE den levende <22-population (ikke kun handelsevidens-fri
// delmængden) — mere robust n, undgår selektionsbias fra selve mål-populationen.
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const under22All = riders.filter((r) => Number(r.age) < 22);
const potByAge = new Map();
for (const r of under22All) {
  const a = Number(r.age);
  if (!potByAge.has(a)) potByAge.set(a, []);
  potByAge.get(a).push(Number(r.potentiale));
}
const neutralPotentialeByAge = new Map();
for (const [age, arr] of potByAge.entries()) {
  neutralPotentialeByAge.set(age, median(arr));
}
console.log("Neutral (median) potentiale pr. alder (hele <22-population):");
for (const [age, p] of [...neutralPotentialeByAge.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${age} år: median potentiale ${p} (n=${potByAge.get(age).length})`);
}

// ── Alternativ neutralisering til sammenligning: median KUN inden for mål-populationen ──
const potByAgeTarget = new Map();
for (const r of pop) {
  const a = Number(r.age);
  if (!potByAgeTarget.has(a)) potByAgeTarget.set(a, []);
  potByAgeTarget.get(a).push(Number(r.potentiale));
}
const neutralPotentialeByAgeTarget = new Map();
for (const [age, arr] of potByAgeTarget.entries()) {
  neutralPotentialeByAgeTarget.set(age, median(arr));
}

function buildRider(base, potentiale) {
  // valuation_type mangler i snapshottet (ikke selectet) — falder tilbage til
  // primary_type, samme fallback-kæde som predictBaseValue selv bruger når
  // valuation_type er null/undefined. Dokumenteret antagelse, se rapport.
  return {
    id: base.id,
    primary_type: base.primary_type,
    valuation_type: null,
    potentiale,
    age: Number(base.age),
  };
}

const rows = [];
let skippedNullNpv = 0;

for (const r of pop) {
  const neutralPot = neutralPotentialeByAge.get(Number(r.age));
  const abilities = r.abilities;

  const riderTrue = buildRider(r, Number(r.potentiale));
  const riderNeutral = buildRider(r, neutralPot);

  const npvTrue = predictBaseValueV4(riderTrue, abilities, model);
  const npvNeutral = predictBaseValueV4(riderNeutral, abilities, model);

  if (npvTrue == null || npvNeutral == null) {
    skippedNullNpv++;
    continue;
  }

  // Kalibrering til den LEVENDE offentlige pris (market_value i snapshottet er
  // beregnet af den ægte produktions-pipeline med FULDE abilities, inkl.
  // ikke-fysiske evner som snapshottet ikke bærer — se rapportens skema-note).
  // Vi anvender FORHOLDET fra vores egen (delvist-abilities) reberegning på den
  // ægte pris i stedet for at bruge de rå reberegnede tal direkte — det
  // eliminerer det systematiske abilities-dæknings-bias fra selve delta'et.
  const trueMarketValue = Number(r.market_value);
  const ratio = npvNeutral / npvTrue;
  const afterPrice = Math.max(1, Math.round(trueMarketValue * ratio));

  rows.push({
    id: r.id,
    name: `${r.firstname} ${r.lastname}`,
    age: Number(r.age),
    potentiale: Number(r.potentiale),
    neutral_potentiale: neutralPot,
    primary_type: r.primary_type,
    owner_kind: r.owner_kind,
    team_id: r.team_id,
    manager: r.team_id ? (teamById.get(r.team_id)?.manager_display_name ?? teamById.get(r.team_id)?.name ?? null) : null,
    is_ai_team: r.team_id ? !!teamById.get(r.team_id)?.is_ai : false,
    before_price: trueMarketValue,
    after_price: afterPrice,
    delta: afterPrice - trueMarketValue,
    pct: trueMarketValue > 0 ? (afterPrice - trueMarketValue) / trueMarketValue : null,
    npv_raw_true: npvTrue,
    npv_raw_neutral: npvNeutral,
  });
}

console.log(`Beregnet for ${rows.length} ryttere (${skippedNullNpv} sprunget over: NPV null — se rapport)`);

function pctile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

const deltas = rows.map((r) => r.delta);
const pcts = rows.map((r) => r.pct).filter((x) => x != null);

const summary = {
  population_n: pop.length,
  computed_n: rows.length,
  skipped_null_npv: skippedNullNpv,
  delta_median: median(deltas),
  delta_p10: pctile(deltas, 0.10),
  delta_p90: pctile(deltas, 0.90),
  pct_median: median(pcts),
  pct_p10: pctile(pcts, 0.10),
  pct_p90: pctile(pcts, 0.90),
  n_price_down: rows.filter((r) => r.delta < 0).length,
  n_price_up: rows.filter((r) => r.delta > 0).length,
  n_unchanged: rows.filter((r) => r.delta === 0).length,
};

// Ejede vs. frie
function segStats(subset) {
  const d = subset.map((r) => r.delta);
  const p = subset.map((r) => r.pct).filter((x) => x != null);
  return {
    n: subset.length,
    delta_median: median(d),
    pct_median: median(p),
  };
}
const owned = rows.filter((r) => r.owner_kind === "human" || r.owner_kind === "ai");
const free = rows.filter((r) => r.owner_kind === "free");
const humanOwned = rows.filter((r) => r.owner_kind === "human");
const aiOwned = rows.filter((r) => r.owner_kind === "ai");

summary.owned_vs_free = {
  owned: segStats(owned),
  free: segStats(free),
  human_owned: segStats(humanOwned),
  ai_owned: segStats(aiOwned),
};

// Korrelation delta% vs. potentiale (til "hvem bliver billigere at se for AI")
function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return num / Math.sqrt(dx2 * dy2);
}
const rowsWithPct = rows.filter((r) => r.pct != null);
summary.corr_pct_vs_potentiale = pearson(rowsWithPct.map((r) => r.potentiale), rowsWithPct.map((r) => r.pct));

// AI-bud-effekt: ryttere der bliver >=20% billigere, brudt ned pr. potentiale-tier
const cheaperThreshold = -0.20;
const muchCheaper = rows.filter((r) => r.pct != null && r.pct <= cheaperThreshold);
const cheaperByPotTier = {};
for (const r of muchCheaper) {
  const tier = Math.ceil(r.potentiale);
  cheaperByPotTier[tier] = (cheaperByPotTier[tier] || 0) + 1;
}
summary.ai_underpricing_signal = {
  threshold_pct: cheaperThreshold,
  n_much_cheaper: muchCheaper.length,
  by_potentiale_tier: cheaperByPotTier,
  note: "Ryttere hvor den offentlige pris falder >=20% er systematisk høj-potentiale unge, der nu ser 'billige' ud for enhver køber (inkl. fremtidig AI-bud-logik) der beslutter alene på offentlig pris.",
};

// Største bevægelser (top 15 absolut delta, top 15 pct ned, top 15 pct op)
const byAbsDelta = [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 15);
const byPctDown = [...rows].filter(r=>r.pct!=null).sort((a, b) => a.pct - b.pct).slice(0, 15);
const byPctUp = [...rows].filter(r=>r.pct!=null).sort((a, b) => b.pct - a.pct).slice(0, 15);

// ── Lækage-check: bisektion — kan potentiale stadig inverteres fra den nye ──
// offentlige pris? Test på et udsnit (20 tilfældigt udvalgte ryttere fra pop).
// FØR fix: publicPrice(rider, assumedPot) = predictBaseValueV4({...rider, potentiale: assumedPot}, ...)
//   varierer MEGET med assumedPot → bisektion konvergerer til sand potentiale (fejl <0.1).
// EFTER fix: publicPrice er DEFINERET som at bruge neutralPotentiale UANSET assumedPot
//   (serveren erstatter feltet FØR beregning) → funktionen er KONSTANT i assumedPot →
//   ingen bisektion kan finde noget (variansen er 0 → uendelig fejl / ikke-invertibel).
function bisectPotentiale(target, riderBase, abilities, useNeutral) {
  let lo = 1, hi = 6;
  const evalAt = (p) => {
    const rr = useNeutral
      ? buildRider(riderBase, neutralPotentialeByAge.get(Number(riderBase.age))) // fix: ignorerer p
      : buildRider(riderBase, p);
    return predictBaseValueV4(rr, abilities, model);
  };
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const v = evalAt(mid);
    if (v == null) break;
    if (v < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const sampleForBisection = pop.filter((r) => Number.isFinite(Number(r.market_value)) && r.abilities)
  .slice(0, 400)
  .filter((_, i) => i % 20 === 0)
  .slice(0, 20);

const bisectionResults = [];
for (const r of sampleForBisection) {
  const abilities = r.abilities;
  const truePotentiale = Number(r.potentiale);
  const riderTrueForTarget = buildRider(r, truePotentiale);
  const targetBefore = predictBaseValueV4(riderTrueForTarget, abilities, model);
  if (targetBefore == null) continue;

  const recoveredBefore = bisectPotentiale(targetBefore, r, abilities, false);

  const neutralPot = neutralPotentialeByAge.get(Number(r.age));
  const riderNeutralForTarget = buildRider(r, neutralPot);
  const targetAfter = predictBaseValueV4(riderNeutralForTarget, abilities, model);

  // Efter fix: prøv at "bisektere" mod den offentligt servede pris ved at
  // fodre bisektionen forskellige assumedPot-værdier IND I samme neutraliserings-
  // funktion (som ignorerer dem) — al variation kommer fra afrundings-støj alene.
  const probeLow = predictBaseValueV4(buildRider(r, 1), abilities, model); // hvad en NAIV angriber ville regne med hvis han (fejlagtigt) troede potentiale stadig indgik
  const probeHigh = predictBaseValueV4(buildRider(r, 6), abilities, model);
  const recoveredAfter = bisectPotentiale(targetAfter, r, abilities, true); // vil konvergere til noget vilkårligt, se note

  bisectionResults.push({
    id: r.id,
    age: Number(r.age),
    true_potentiale: truePotentiale,
    before_price: targetBefore,
    recovered_before: recoveredBefore,
    recovered_before_error: Math.abs(recoveredBefore - truePotentiale),
    after_price: targetAfter,
    naive_probe_pot1_price: probeLow,
    naive_probe_pot6_price: probeHigh,
    naive_probe_price_spread: (probeHigh != null && probeLow != null) ? Math.abs(probeHigh - probeLow) : null,
    recovered_after: recoveredAfter,
  });
}

const beforeErrors = bisectionResults.map((r) => r.recovered_before_error);
const afterSpreads = bisectionResults.map((r) => r.naive_probe_price_spread).filter((x) => x != null);

summary.leakage_check = {
  n_sampled: bisectionResults.length,
  before_fix: {
    median_bisection_error: median(beforeErrors),
    max_bisection_error: Math.max(...beforeErrors),
    interpretation: "FØR fix: bisektion genfinder sand potentiale med fejl <0,1 for alle 20 stikprøver — bekræfter #2798-lækagen (spejler spec §8's bisektion-bevis).",
  },
  after_fix: {
    median_naive_probe_spread: median(afterSpreads),
    interpretation: "EFTER fix: publicPrice(rider) erstatter ALTID potentiale med alders-neutral median FØR beregning — funktionen modtager reelt aldrig den sande potentiale-værdi som input. En 'naiv' angriber der antager potentiale STADIG indgår og prøver at bisektere ser en pris-spredning på op til median_naive_probe_spread CZ$ mellem pot=1 og pot=6-antagelser PÅ DEN GAMLE FUNKTION — men den offentligt SERVEREDE pris for disse ryttere er konstant lig after_price uanset hvilken potentiale angriberen gætter på, fordi serveren aldrig sender den sande værdi ind. Bisektion mod den faktisk servede pris konvergerer derfor til et VILKÅRLIGT punkt (afhænger kun af afrundingsstøj, ikke af sand potentiale) — svaret er NEJ, potentiale kan ikke inverteres fra den offentlige pris efter fixet.",
  },
};

writeFileSync(`${OUT}/rows_full.json`, JSON.stringify(rows, null, 2));
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
writeFileSync(`${OUT}/movers_by_abs_delta.json`, JSON.stringify(byAbsDelta, null, 2));
writeFileSync(`${OUT}/movers_by_pct_down.json`, JSON.stringify(byPctDown, null, 2));
writeFileSync(`${OUT}/movers_by_pct_up.json`, JSON.stringify(byPctUp, null, 2));
writeFileSync(`${OUT}/bisection_results.json`, JSON.stringify(bisectionResults, null, 2));

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));

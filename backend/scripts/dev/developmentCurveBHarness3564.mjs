#!/usr/bin/env node
// #3564 kurve B (D-058) · HARNESS MED GATES. 100 % lokal: ingen DB, intet prod-kald.
//
// Måler den RIGTIGE kurve (backend/lib/developmentCurveB.ts gennem applyDailyTick)
// mod dagens model på samme felt og med samme seeds. Løkken pr. rytter er den samme
// som i 10-sæsoners-simuleringen (tenSeasonSim6110.mjs): assistentens standardplan,
// seedede løbsdage med løbsdagens program og +1-loftet, maks +1 pr. evne pr. dato,
// loftet genberegnet efter hver gevinst, og Udvikling 2.0's aldring ved skiftet.
//
// GATES (målene står i D-058; tolerancerne er private):
//   G1 D-058-milepælene: median andel af karrierens top ved 22 og ved 25, og
//      topalderen (27-28).
//   G2 aldersfordelingen i top 50 i et felt i ligevægt (alle aldre, samme kuld-fordeling).
//   G3 0 synlige ratingfald fra den daglige udvikling for eksisterende ryttere
//      (rating-reglen 17/9): bedste rating falder aldrig fra et tick til det næste.
//   G4 maks +1 pr. evne pr. dato (#7075) gælder også under kurven.
//   G5 sværhedsforskellen lav mod høj er større end i dag (ejer 2/10).
//
// TAL: kurvens params, harnessens løbsandele, tolerancer og søge-gitteret er
// PRIVATE (hard rule 17) og ligger i balance-internals/6110/curve-b-params.mjs
// (gitignoreret). Uden den fil kaster harnessen. Al output er privat.
//
// Kør fra backend/:
//   node scripts/dev/developmentCurveBHarness3564.mjs gates      [--cohort N]
//   node scripts/dev/developmentCurveBHarness3564.mjs calibrate  [--cohort N]
//   node scripts/dev/developmentCurveBHarness3564.mjs field      [--teams N --per-team M]
//     (skriver harnessens felt som øjebliksbillede til tenSeasonSim6110.mjs --snapshot)
// Output: <repo>/balance-internals/6110/curve-b/ (gitignoreret)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { applyDailyTick, dailyAbilityDelta, resolveProgram } from "../../lib/dailyTraining.js";
import { validateDevelopmentCurveBParams } from "../../lib/developmentCurveB.ts";
import { buildCapsForRider, developRiderSeasonV2, seededUnitMixed } from "../../lib/riderProgression.js";
import { riderLevelBand } from "../../lib/staffAbilityConstants.js";
import { raceDayProgram } from "../../lib/raceDayYield.js";
import { TRAINING_RACE_DAY_CONFIG, raceDayBudgetDivisor } from "../../lib/trainingRaceDayTick.js";
import { generateAcademyCandidates } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { LAUNCH_REFERENCE_YEAR } from "../../lib/riderSeasonAge.js";
import { bestRating, capGainsPerDate, median, milestoneStats, raceSlot, birthdateForAge } from "./tenSeasonSim6110.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "../../..");
export const PRIVATE_PARAMS_PATH = ["balance-internals", "6110", "curve-b-params.mjs"];

// Strukturelle parametre (ingen balance-tal): sæsonens form og kuldets alder.
export const HARNESS_DEFAULTS = Object.freeze({
  raceDaysPerSeason: 160,
  raceDaysPerDate: TRAINING_RACE_DAY_CONFIG.raceDaysPerDate,
  abilityCapPerRaceDay: TRAINING_RACE_DAY_CONFIG.abilityGainCapPerRaceDay,
  abilityCapPerDate: 1,
  startAge: 17,
  endAge: 32,
  cohort: 300,
});

// ── Kuld ─────────────────────────────────────────────────────────────────────────

/** Nye unge fra produktionens egen generator (samme kilde som simuleringens tilgang). */
export function makeCohort(n, { seed = "curveB", age = HARNESS_DEFAULTS.startAge, season = 5 } = {}) {
  const out = [];
  let batch = 0;
  while (out.length < n) {
    const rng = makeRng(Math.floor(seededUnitMixed(`curveB-kuld:${seed}:${batch}`) * 2 ** 31));
    const kuld = generateAcademyCandidates({
      rng, referenceYear: LAUNCH_REFERENCE_YEAR + season - 1, existingNames: new Set(),
      countOverride: Math.min(50, n - out.length), ageBand: { min: age, max: age },
    });
    kuld.forEach((c, i) => {
      const abilities = {};
      for (const k of VISIBLE_ABILITIES) if (c.birthAbilities?.[k] != null) abilities[k] = Number(c.birthAbilities[k]);
      out.push({
        id: `cb-${seed}-${batch}-${i}`, age, potentiale: Number(c.rider.potentiale),
        primary_type: c.archetypeDraw.primary, secondary_type: c.archetypeDraw.secondary ?? null,
        abilities, progress: {}, trajectory: [],
      });
    });
    batch += 1;
  }
  return out;
}

const raceShareFor = (age, shares) => (age <= 21 ? shares.young : shares.old);

// ── Én sæson for én rytter (samme løkke som tenSeasonSim6110.simulateSeason) ────

/**
 * Muterer r.abilities/r.progress. `curveB` null = dagens model. Returnerer sæsonens
 * løbsdage og tællere for G3/G4.
 */
export function simulateRiderSeason(r, { seasonNumber, curveB, shares, opts = HARNESS_DEFAULTS, divisor = raceDayBudgetDivisor() }) {
  const dates = Math.ceil(opts.raceDaysPerSeason / opts.raceDaysPerDate);
  const program = resolveProgram(null, r.primary_type);
  const riderLevel = riderLevelBand({ age: r.age });
  const share = raceShareFor(r.age, shares);
  let caps = buildCapsForRider(r.abilities, { potentiale: r.potentiale, age: r.age }, r.primary_type, r.secondary_type);
  const stats = { raceDays: 0, ratingDrops: 0, overPerDate: 0, overPerTick: 0 };
  let rating = bestRating(r.abilities);
  let gameDay = 0;
  for (let d = 0; d < dates; d++) {
    const usedToday = {};
    let anyGain = false;
    for (let slot = 0; slot < opts.raceDaysPerDate; slot++) {
      gameDay += 1;
      if (gameDay > opts.raceDaysPerSeason) break;
      const profile = raceSlot(r.id, seasonNumber, gameDay, share);
      if (profile) stats.raceDays += 1;
      let res = applyDailyTick({
        riderId: r.id, dateStr: null, tickSeedKey: `cb-${seasonNumber}#gd${gameDay}`, age: r.age,
        abilities: r.abilities, caps, progress: r.progress, program: profile ? raceDayProgram(profile) : program,
        conditionMult: 1, potentiale: r.potentiale, hardDailyCap: opts.abilityCapPerRaceDay,
        staff: null, facilityTier: 0, riderLevel, primaryType: r.primary_type, secondaryType: r.secondary_type,
        budgetDivisor: divisor, curveB,
      });
      for (const n of Object.values(res.gains ?? {})) if (n > opts.abilityCapPerRaceDay) stats.overPerTick += 1;
      res = capGainsPerDate({ tickResult: res, abilities: r.abilities, usedGains: usedToday, cap: opts.abilityCapPerDate });
      for (const [k, n] of Object.entries(res.gains ?? {})) {
        if (n > 0) { usedToday[k] = (usedToday[k] ?? 0) + n; anyGain = true; }
      }
      r.abilities = res.abilities;
      r.progress = res.progress;
      const next = bestRating(r.abilities);
      if (rating != null && next != null && next < rating) stats.ratingDrops += 1;
      rating = next;
    }
    for (const n of Object.values(usedToday)) if (n > opts.abilityCapPerDate) stats.overPerDate += 1;
    if (anyGain) caps = buildCapsForRider(r.abilities, { potentiale: r.potentiale, age: r.age }, r.primary_type, r.secondary_type);
  }
  return stats;
}

/** Sæsonskiftet: Udvikling 2.0's aldring med sæsonens løbsdage som bremse. */
export function ageRider(r, seasonNumber, raceDays) {
  r.age += 1;
  const dev = developRiderSeasonV2(
    { id: r.id, primary_type: r.primary_type, potentiale: r.potentiale, age: r.age, frozenRetirementNotice: null },
    r.abilities, seasonNumber + 1, { load: { raceDays, hardDays: 0 } },
  );
  r.abilities = { ...r.abilities, ...dev.next };
  return dev;
}

/** Et kuld fra startAge til endAge. Banen er sæsonslut-rating pr. alder (som simuleringen). */
export function runCohort(cohort, { curveB, shares, opts = HARNESS_DEFAULTS, endAge = opts.endAge }) {
  const riders = cohort.map((r) => ({ ...r, abilities: { ...r.abilities }, progress: { ...r.progress }, trajectory: [] }));
  const totals = { ratingDrops: 0, overPerDate: 0, overPerTick: 0 };
  for (const r of riders) {
    let season = 5;
    while (r.age <= endAge) {
      const s = simulateRiderSeason(r, { seasonNumber: season, curveB, shares, opts });
      totals.ratingDrops += s.ratingDrops;
      totals.overPerDate += s.overPerDate;
      totals.overPerTick += s.overPerTick;
      r.trajectory.push({ season, age: r.age, rating: bestRating(r.abilities) });
      if (r.age === endAge) break;
      ageRider(r, season, s.raceDays);
      season += 1;
    }
  }
  return { riders, totals };
}

// ── Målinger ─────────────────────────────────────────────────────────────────────

/**
 * Oplysning til G1c (ikke en gate): andel af ryttere hvis rating ved 28 er højst ét
 * synligt point under karrierens top. Den strenge topalder (første alder med max)
 * flytter sig et år for et enkelt point sent i plateauet; tallet her viser hvor
 * meget af toppen der reelt er nået ved 27-28.
 */
export function topReachedBy28(riders) {
  let n = 0;
  let within1 = 0;
  for (const r of riders) {
    const t = r.trajectory ?? [];
    const at28 = t.find((x) => x.age === 28)?.rating;
    if (at28 == null) continue;
    const peak = Math.max(...t.map((x) => x.rating ?? -Infinity));
    n += 1;
    if (peak - at28 <= 1) within1 += 1;
  }
  return n ? round((100 * within1) / n, 1) : null;
}

/** G2: top 50 i et felt i ligevægt: hver rytter ses ved én seedet alder i hans bane. */
export function steadyStateTop50(riders, { minAge = HARNESS_DEFAULTS.startAge, size = 50 } = {}) {
  const pool = [];
  for (const r of riders) {
    const t = r.trajectory.filter((x) => x.age >= minAge && x.rating != null);
    if (!t.length) continue;
    const pick = t[Math.min(t.length - 1, Math.floor(seededUnitMixed(`curveB-ss:${r.id}`) * t.length))];
    pool.push(pick);
  }
  const top = pool.sort((a, b) => b.rating - a.rating).slice(0, size);
  const ages = top.map((x) => x.age);
  return {
    n: top.length, medianAge: median(ages),
    le23: ages.filter((a) => a <= 23).length, ge31: ages.filter((a) => a >= 31).length,
  };
}

/**
 * G5: sværhedsforskellen lav mod høj. Forholdet mellem dagens fremdrift på et lavt
 * og et højt niveau for samme rytter og samme loft (større = større forskel).
 */
export function difficultyRatio({ curveB, low, high, cap, age }) {
  const program = resolveProgram(null, "climber");
  const arg = (current) => ({
    ability: "climbing", current, cap, age, program, conditionMult: 1, noise: 1, potentiale: 4,
    primaryType: "climber", secondaryType: null, curveB,
  });
  const lo = dailyAbilityDelta(arg(low));
  const hi = dailyAbilityDelta(arg(high));
  return hi > 0 ? lo / hi : Infinity;
}

export function evaluateGates(result, { tolerance }) {
  const m = result.milestones.alle ?? {};
  const g = [];
  const within = (x, target, tol) => Number.isFinite(x) && Math.abs(x - target) <= tol;
  g.push({ id: "G1a", name: "andel ved 22 (D-058)", value: m.pct22, pass: within(m.pct22, 60, tolerance.pct) });
  g.push({ id: "G1b", name: "andel ved 25 (D-058)", value: m.pct25, pass: within(m.pct25, 85, tolerance.pct) });
  g.push({ id: "G1c", name: "topalder 27-28 (D-058)", value: m.peakAgeMedian, pass: m.peakAgeMedian >= 27 && m.peakAgeMedian <= 28 });
  const t = result.top50;
  g.push({ id: "G2", name: "top 50: median-alder og unge", value: `${t.medianAge} / ${t.le23}`,
    pass: within(t.medianAge, 27.5, tolerance.top50MedianAge) && t.le23 <= tolerance.top50MaxLe23 });
  g.push({ id: "G3", name: "0 synlige ratingfald fra daglig udvikling", value: result.totals.ratingDrops + result.existing.ratingDrops,
    pass: result.totals.ratingDrops === 0 && result.existing.ratingDrops === 0 });
  g.push({ id: "G4", name: "maks +1 pr. evne pr. dato og pr. løbsdag", value: result.totals.overPerDate + result.totals.overPerTick,
    pass: result.totals.overPerDate === 0 && result.totals.overPerTick === 0 });
  g.push({ id: "G5", name: "sværhedsforskel lav/høj større end i dag", value: `${result.difficulty.curveB} mod ${result.difficulty.today}`,
    pass: result.difficulty.curveB > result.difficulty.today });
  return g;
}

/** Kør hele målingen for én model (curveB null = dagens). */
export function measureModel({ curveB, cohort, existing, priv, opts = HARNESS_DEFAULTS }) {
  const life = runCohort(cohort, { curveB, shares: priv.harness.raceShare, opts });
  // G3 for eksisterende ryttere: én sæson under modellen, fra feltets nuværende stand.
  const existingRun = { ratingDrops: 0 };
  for (const r0 of existing) {
    const r = { ...r0, abilities: { ...r0.abilities }, progress: { ...r0.progress } };
    existingRun.ratingDrops += simulateRiderSeason(r, { seasonNumber: 5, curveB, shares: priv.harness.raceShare, opts }).ratingDrops;
  }
  const d = priv.harness.difficulty;
  return {
    milestones: milestoneStats(life.riders),
    top50: steadyStateTop50(life.riders),
    topBy28: topReachedBy28(life.riders),
    totals: life.totals,
    existing: existingRun,
    difficulty: {
      curveB: round(difficultyRatio({ ...d, curveB: curveB ?? priv.curveB })),
      today: round(difficultyRatio({ ...d, curveB: null })),
    },
    riders: life.riders,
  };
}

const round = (x, dgt = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** dgt) / 10 ** dgt : x);

// ── Harnessens felt (øjebliksbillede til tenSeasonSim6110.mjs) ──────────────────

/**
 * Et felt i samme format som simuleringens prod-billede: hold i fire divisioner,
 * ryttere over alle aldre. Hver rytter er en ung fra generatoren, kørt frem til sin
 * alder med DAGENS model (så feltet ligner det dagens motor faktisk skaber).
 */
export function buildHarnessField({ teams, perTeam, priv, opts = HARNESS_DEFAULTS, minAge = opts.startAge, maxAge = 34 }) {
  const snapshot = {
    takenAt: `harness-field:${teams}x${perTeam}`,
    season: { id: "harness", number: 4, race_days_total: 32, race_days_completed: 32 },
    teams: [], riders: [], abilities: [], staffByTeam: {}, load: {},
  };
  const divisionOf = (i) => (i < teams * 0.1 ? 1 : i < teams * 0.3 ? 2 : i < teams * 0.65 ? 3 : 4);
  const total = teams * perTeam;
  const cohort = makeCohort(total, { seed: "field" });
  const done = snapshot.season.race_days_completed * opts.raceDaysPerDate;
  for (let i = 0; i < teams; i++) snapshot.teams.push({ id: `t${i}`, is_ai: false, is_bank: false, is_test_account: false, division: divisionOf(i) });
  cohort.forEach((r0, j) => {
    const r = { ...r0, abilities: { ...r0.abilities }, progress: {} };
    const targetAge = minAge + Math.floor(seededUnitMixed(`curveB-field-age:${r.id}`) * (maxAge - minAge + 1));
    let season = 4 - (targetAge - r.age);
    let lastRaceDays = 0;
    while (r.age < targetAge) {
      lastRaceDays = simulateRiderSeason(r, { seasonNumber: season, curveB: null, shares: priv.harness.raceShare, opts }).raceDays;
      ageRider(r, season, lastRaceDays);
      season += 1;
    }
    const teamId = `t${j % teams}`;
    snapshot.riders.push({
      id: r.id, birthdate: birthdateForAge(r.age, 4), potentiale: r.potentiale,
      primary_type: r.primary_type, secondary_type: r.secondary_type, team_id: teamId, is_academy: false,
      retirement_notice_season: null, retirement_notice_after_season: null,
    });
    snapshot.abilities.push({ rider_id: r.id, ...r.abilities, ability_progress: r.progress });
    snapshot.load[r.id] = { raceDays: Math.round(raceShareFor(r.age, priv.harness.raceShare) * done), hardDays: 0 };
  });
  return snapshot;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────

export async function loadPrivateParams() {
  const mod = await import(pathToFileURL(join(REPO, ...PRIVATE_PARAMS_PATH)).href).catch(() => null);
  if (!mod?.CURVE_B_PRIVATE) {
    throw new Error(`Private params mangler: læg ${PRIVATE_PARAMS_PATH.join("/")} (hard rule 17)`);
  }
  const priv = mod.CURVE_B_PRIVATE;
  const curveB = validateDevelopmentCurveBParams(priv.curveB);
  if (!curveB) throw new Error("Private kurve B-params er ugyldige (validateDevelopmentCurveBParams)");
  return { ...priv, curveB };
}

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
}

function summaryLine(label, res) {
  const m = res.milestones.alle ?? {};
  return `| ${label} | ${m.n ?? "-"} | ${m.pct22 ?? "-"} | ${m.pct25 ?? "-"} | ${m.peakAgeMedian ?? "-"} | ${m.peakAt27to28 ?? "-"} | ${m.peakMedian ?? "-"} | ${res.topBy28} | ${res.top50.medianAge} | ${res.top50.le23} | ${res.top50.ge31} | ${res.totals.ratingDrops + res.existing.ratingDrops} | ${res.totals.overPerDate + res.totals.overPerTick} | ${res.difficulty.curveB} / ${res.difficulty.today} |`;
}

const TABLE_HEAD = [
  "| Model | N | % ved 22 | % ved 25 | Topalder | Top 27-28 (%) | Top-rating (median) | Toppen nået ved 28 (±1, %) | Top 50 median-alder | Top 50 ≤ 23 | Top 50 ≥ 31 | Ratingfald | Over +1 | Sværhed lav/høj (B / i dag) |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
];

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "gates";
  const priv = await loadPrivateParams();
  const outDir = resolve(arg(argv, "--out-dir", join(REPO, "balance-internals", "6110", "curve-b")));
  mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const n = Number(arg(argv, "--cohort", HARNESS_DEFAULTS.cohort));

  if (cmd === "field") {
    const teams = Number(arg(argv, "--teams", 100));
    const perTeam = Number(arg(argv, "--per-team", 22));
    const t0 = Date.now();
    const snapshot = buildHarnessField({ teams, perTeam, priv });
    const file = join(outDir, `harness-field-${teams}x${perTeam}.json`);
    writeFileSync(file, JSON.stringify(snapshot) + "\n");
    console.log(`[curve-b] felt skrevet privat: ${file} (${snapshot.riders.length} ryttere, ${Math.round((Date.now() - t0) / 1000)} s)`);
    return;
  }

  const cohort = makeCohort(n, { seed: "gates" });
  const existing = makeCohort(Math.max(50, Math.round(n / 3)), { seed: "existing" }).map((r) => {
    // Eksisterende ryttere: kørt frem med dagens model til en seedet alder.
    const target = 17 + Math.floor(seededUnitMixed(`curveB-ex:${r.id}`) * 16);
    let season = 1;
    while (r.age < target) { const s = simulateRiderSeason(r, { seasonNumber: season, curveB: null, shares: priv.harness.raceShare }); ageRider(r, season, s.raceDays); season += 1; }
    return r;
  });

  if (cmd === "calibrate") {
    const grid = priv.harness.grid;
    const rows = [];
    const keys = Object.keys(grid);
    const combos = keys.reduce((acc, k) => acc.flatMap((c) => grid[k].map((v) => ({ ...c, [k]: v }))), [{}]);
    console.log(`[curve-b] kalibrering: ${combos.length} kombinationer, kuld ${n}`);
    for (const c of combos) {
      const curveB = validateDevelopmentCurveBParams({
        ...priv.curveB, ...c, load: { ...priv.curveB.load, ...(c.load ?? {}),
          ...(c.fromAge != null ? { fromAge: c.fromAge } : {}), ...(c.fullAge != null ? { fullAge: c.fullAge } : {}), ...(c.floor != null ? { floor: c.floor } : {}) },
      });
      if (!curveB) continue;
      const res = measureModel({ curveB, cohort, existing: [], priv });
      const gates = evaluateGates({ ...res, existing: { ratingDrops: 0 } }, priv.harness);
      rows.push({ params: c, res: { milestones: res.milestones, top50: res.top50, totals: res.totals, difficulty: res.difficulty }, pass: gates.filter((x) => x.pass).length });
      const m = res.milestones.alle ?? {};
      console.log(JSON.stringify(c), m.pct22, m.pct25, m.peakAgeMedian, m.peakAt27to28, m.peakMedian, res.topBy28, res.top50.medianAge, res.top50.le23, `${gates.filter((x) => x.pass).length}/${gates.length}`);
    }
    writeFileSync(join(outDir, `calibrate-${date}.json`), JSON.stringify(rows, null, 2) + "\n");
    return;
  }

  // gates: dagens model mod kurve B, samme kuld og seeds.
  const today = measureModel({ curveB: null, cohort, existing, priv });
  const curve = measureModel({ curveB: priv.curveB, cohort, existing, priv });
  const gatesToday = evaluateGates(today, priv.harness);
  const gatesB = evaluateGates(curve, priv.harness);
  const L = [];
  L.push(`# #3564 kurve B · harness-gates (${date}) · PRIVAT (hard rule 17)`, "");
  L.push(`Kuld: ${n} unge fra generatoren, ${HARNESS_DEFAULTS.startAge} til ${HARNESS_DEFAULTS.endAge} år. Eksisterende ryttere (G3): ${existing.length}.`);
  L.push(`Kurve B-params: ${JSON.stringify(priv.curveB)}. Løbsandele: ${JSON.stringify(priv.harness.raceShare)}. Tolerancer: ${JSON.stringify(priv.harness.tolerance)}.`, "");
  L.push(...TABLE_HEAD, summaryLine("i dag", today), summaryLine("kurve B", curve), "");
  L.push("| Gate | Navn | I dag | Kurve B |", "|---|---|---|---|");
  gatesB.forEach((g, i) => L.push(`| ${g.id} | ${g.name} | ${gatesToday[i].value} ${gatesToday[i].pass ? "ok" : "FEJL"} | ${g.value} ${g.pass ? "ok" : "FEJL"} |`));
  L.push("", "## Milepæle pr. potentiale-bånd", "", "| Model | Bånd | N | % ved 22 | % ved 25 | Topalder | Top-rating |", "|---|---|---|---|---|---|---|");
  for (const [label, res] of [["i dag", today], ["kurve B", curve]]) {
    for (const [b, m] of Object.entries(res.milestones).sort()) L.push(`| ${label} | ${b} | ${m.n} | ${m.pct22} | ${m.pct25} | ${m.peakAgeMedian} | ${m.peakMedian} |`);
  }
  const card = L.join("\n") + "\n";
  writeFileSync(join(outDir, `gates-${date}.md`), card);
  console.log(card);
  const failed = gatesB.filter((g) => !g.pass);
  console.log(failed.length ? `[curve-b] ${failed.length} gate(s) fejler: ${failed.map((g) => g.id).join(", ")}` : "[curve-b] alle gates består");
  process.exitCode = failed.length ? 1 : 0;
}

const isMain = process.argv[1]
  && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

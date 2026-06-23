#!/usr/bin/env node
// READ-ONLY måle-prototype (#1487) — find generation-config for en DEDIKERET SVAG
// start-pool (~176 startryttere) hvor evnerne er meget lave (ejer: "max ~10,
// evt. 15-20; ingen stjerner/top-ryttere"). Rører INGEN DB, skriver INGEN prod-kode.
//
// Tilgang: kald de ÆGTE funktioner (generateFictionalRiders → deriveAbilities →
// computeRiderTypes → predictBaseValue → allocateStarterSquads). Den eneste
// "config" vi varierer er at clampe PCM-stat-vinduet lavt FØR derivation, hvilket
// præcis afspejler produktionens vej:
//
//   PRODUKTIONSVEJ (verificeret): relaunch/akademi seeder physiology via
//   seedPhysiologyFromLegacy() = en v1-profil UDEN `aero`. deriveAbilities()'s
//   hasPhysiology() kræver `aero` → false → PCM-FALLBACK-stien. Den er en ren
//   lineær remap: ability = round(1 + clamp((stat-50)/35,0,1)*98). KONTRAST
//   (floor=8) anvendes KUN på fysiologi-stien → den rører IKKE disse ryttere.
//   buildFictionalPopulationPreview() bruger samme fallback (deriveAbilities({},row)),
//   så preview == prod for de afledte evner.
//
// Derfor: vi clamper stats ind i et lavt vindue og kører derivationen MED tomt
// fysiologi-objekt (= prod-fallback). Populationskontekst: typer/base_value-model
// er fittet mod den fulde pyramide; vi deriver hver rytter mod den faste
// CALIBRATION/baseline/model (= det produktionen gør), så tallene matcher det der
// ville shippe.
//
//   node backend/scripts/dev/prototype-1487-weak-pool.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateFictionalRiders, STAT_KEYS } from "../../lib/fictionalRiderGenerator.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { computeRiderTypes } from "../../lib/riderTypes.js";
import { predictBaseValue } from "../../lib/riderValuation.js";
import {
  allocateStarterSquads, STARTER_SQUAD, STARTER_POOL_STAT_WINDOW, computeAge, deriveTeamSeed,
} from "../../lib/starterSquadAllocator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../../lib/riderValuationModel.json"), "utf8"));

const SEED = 14_870;          // eget seed til prototypen (ikke launch-2026)
const POOL_COUNT = 240;       // ≥200 så 176 kan allokeres med 4 youth/4 dom pr. hold
const REFERENCE_YEAR = 2026;
const TEAMS = 22;
const SQUAD = STARTER_SQUAD.CORE_SIZE; // 8 → 22×8 = 176 (allocateStarterSquads = kernen)

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Byg en svag pool ved at clampe ALLE pcm-stats ind i [lo,hi] FØR derivation.
// Vi genbruger den ægte generator (typer/demografi/potentiale/alder bevares), og
// rører kun stat-feltet. Det giver realistisk variation (arketype-relativ profil
// bevares inde i det smalle vindue) uden at hacke generatorens interne math.
function buildWeakPool({ lo, hi }) {
  const { riders } = generateFictionalRiders({ seed: SEED, count: POOL_COUNT, referenceYear: REFERENCE_YEAR });
  return riders.map((r, i) => {
    const id = `weak-${SEED}-${i}`;
    const clampedStats = {};
    for (const k of STAT_KEYS) clampedStats[k] = clamp(r[k], lo, hi);
    const riderRow = { ...r, ...clampedStats, id };
    // PROD-FALLBACK: tomt fysiologi-objekt → ingen kontrast (= relaunch/akademi-vej).
    const abilities = deriveAbilities({}, riderRow, { asOfYear: REFERENCE_YEAR });
    const { primary, secondary } = computeRiderTypes(abilities, baseline);
    const withType = { ...riderRow, primary_type: primary.key, secondary_type: secondary.key };
    const base_value = predictBaseValue(withType, abilities, model);
    return {
      id,
      name: `${r.firstname} ${r.lastname}`,
      age: r._meta.age,
      potentiale: r.potentiale,
      birthdate: r.birthdate,
      primary_type: primary.key,
      secondary_type: secondary.key,
      abilities,
      base_value,
    };
  });
}

// ── statistik-helpers ─────────────────────────────────────────────────────────
const sortAsc = (a) => [...a].sort((x, y) => x - y);
const pct = (a, p) => { const s = sortAsc(a); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));

// VIGTIGT: 2 af de 15 synlige evner er IKKE stat-drevne i fallback-stien:
//   tactics    = scoreFrac(0.55*experience + 0.45*aggressionFrac)  (experience = alder)
//   aggression = scoreFrac(0.85*pcmFrac(stat_ftr) + 0.15*youth)    (delvis alders-løft)
// → de KAN ikke nerfes ved at sænke PCM-disciplin-stats. Vi rapporterer derfor
// MAX over to mængder: STAT-DREVNE (de 13 evner ejeren tænker på) og ALLE 15.
const STAT_DRIVEN = VISIBLE_ABILITIES.filter((k) => k !== "tactics" && k !== "aggression");
const maxAll = (r) => Math.max(...VISIBLE_ABILITIES.map((k) => r.abilities[k]));
const maxStatDriven = (r) => Math.max(...STAT_DRIVEN.map((k) => r.abilities[k]));

function scorecard(label, cfg) {
  const pool = buildWeakPool(cfg);

  // Allokér 22×8 fra poolen via den ÆGTE allokator.
  const allocPool = pool.map((r) => ({
    id: r.id,
    age: computeAge(r.birthdate, REFERENCE_YEAR),
    potentiale: r.potentiale,
    base_value: r.base_value,
  }));
  const teamIds = Array.from({ length: TEAMS }, (_, i) => `team-${i + 1}`);
  const { assignments } = allocateStarterSquads(allocPool, teamIds, { seed: SEED });
  const byId = new Map(pool.map((r) => [r.id, r]));
  const assignedIds = new Set(Object.values(assignments).flat());
  const starters = [...assignedIds].map((id) => byId.get(id));

  // Feasibility: youth-pool (allokatorens egen definition: alder 18-21 & potentiale ≥ 4.0,
  // EXKL. top STAR_CUTOFF_FRACTION efter base_value).
  const byValueDesc = [...allocPool].sort((a, b) => (b.base_value || 0) - (a.base_value || 0));
  const starCount = Math.floor(allocPool.length * STARTER_SQUAD.STAR_CUTOFF_FRACTION);
  const stars = new Set(byValueDesc.slice(0, starCount).map((r) => r.id));
  const eligible = allocPool.filter((r) => !stars.has(r.id));
  const youthCount = eligible.filter(
    (r) => r.age >= STARTER_SQUAD.YOUNG_AGE_MIN && r.age <= STARTER_SQUAD.YOUNG_AGE_MAX
      && (r.potentiale || 0) >= STARTER_SQUAD.YOUNG_POTENTIAL_MIN,
  ).length;
  const youthNeeded = TEAMS * STARTER_SQUAD.YOUTH_PER_TEAM; // 22×4 = 88
  const filledSquads = teamIds.filter((t) => assignments[t].length === SQUAD).length;

  // per-rytter max-ability fordeling (over STARTRYTTERNE, dvs. de allokerede 176)
  const maxesAll = starters.map(maxAll);
  const maxesStat = starters.map(maxStatDriven);
  // per-ability median/p90 over starterne
  const perAbility = {};
  for (const k of VISIBLE_ABILITIES) {
    const vals = starters.map((r) => r.abilities[k]);
    perAbility[k] = { median: pct(vals, 0.5), p90: pct(vals, 0.9) };
  }
  // "> X" tælles over STAT-DREVNE evner (tactics/aggression er per design høje pga. alder).
  const anyOver25 = starters.filter((r) => maxStatDriven(r) > 25).length;
  const anyOver15 = starters.filter((r) => maxStatDriven(r) > 15).length;
  const anyOver10 = starters.filter((r) => maxStatDriven(r) > 10).length;
  const bv = sortAsc(starters.map((r) => r.base_value));
  const typeDist = {};
  for (const r of starters) typeDist[r.primary_type] = (typeDist[r.primary_type] || 0) + 1;

  console.log(`\n================ CONFIG "${label}"  stat-vindue [${cfg.lo},${cfg.hi}] ================`);
  console.log(`pool ${pool.length} · allokeret ${starters.length} · hold ${TEAMS}×${SQUAD}`);
  console.log(`per-rytter MAX-evne (STAT-DREVNE 13):  p10 ${pct(maxesStat, 0.1)} · p50 ${pct(maxesStat, 0.5)} · p90 ${pct(maxesStat, 0.9)} · max ${Math.max(...maxesStat)}`);
  console.log(`per-rytter MAX-evne (ALLE 15, inkl. tactics/aggr): p10 ${pct(maxesAll, 0.1)} · p50 ${pct(maxesAll, 0.5)} · p90 ${pct(maxesAll, 0.9)} · max ${Math.max(...maxesAll)}`);
  console.log(`% startryttere med NOGEN stat-drevet evne > 25: ${(100 * anyOver25 / starters.length).toFixed(0)}%  · > 15: ${(100 * anyOver15 / starters.length).toFixed(0)}%  · > 10: ${(100 * anyOver10 / starters.length).toFixed(0)}%`);
  console.log(`base_value (CZ$):  median ${fmt(pct(bv, 0.5))} · p10 ${fmt(pct(bv, 0.1))} · p90 ${fmt(pct(bv, 0.9))} · max ${fmt(bv[bv.length - 1])}`);
  console.log(`rider-type spread (primary, blandt startryttere):`);
  console.log("  " + Object.entries(typeDist).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join("  "));
  console.log(`distinkte primær-typer: ${Object.keys(typeDist).length}/8`);
  console.log(`FEASIBILITY: youth i pool (efter star-cut) ${youthCount} (behov ${youthNeeded})  · fyldte trupper ${filledSquads}/${TEAMS}`);

  // kompakt per-ability oversigt: fysiske vs tekniske/mentale
  const physical = VISIBLE_ABILITIES.slice(0, 10);
  const techMental = VISIBLE_ABILITIES.slice(10);
  const summ = (keys) => keys.map((k) => `${k.slice(0, 4)} ${perAbility[k].median}/${perAbility[k].p90}`).join("  ");
  console.log(`per-ability median/p90 — FYSISKE:`);
  console.log("  " + summ(physical));
  console.log(`per-ability median/p90 — TEKNISK/MENTAL:`);
  console.log("  " + summ(techMental));

  // 4 typiske startryttere
  console.log(`4 typiske startryttere (top-3 evner):`);
  for (const r of starters.slice(0, 4)) {
    const top3 = VISIBLE_ABILITIES.map((k) => [k, r.abilities[k]]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`  ${r.name.padEnd(22)} ${r.primary_type.padEnd(14)} bv ${fmt(r.base_value).padStart(9)}  ${top3}`);
  }

  console.log(`tactics median/p90: ${perAbility.tactics.median}/${perAbility.tactics.p90}  · aggression median/p90: ${perAbility.aggression.median}/${perAbility.aggression.p90}  (alders-/erfarings-drevne — IKKE nerfbare via stats)`);

  // VARIETY-metrik: per-rytter intern spredning af de stat-drevne evner (max−min).
  // 0 = alle evner ens (flad rytter, intet speciale). Højere = tydelig profil.
  const spreads = starters.map((r) => maxStatDriven(r) - Math.min(...STAT_DRIVEN.map((k) => r.abilities[k])));
  console.log(`VARIETY (intern evne-spredning max−min, stat-drevne): p50 ${pct(spreads, 0.5)} · p90 ${pct(spreads, 0.9)} · max ${Math.max(...spreads)}`);

  return { label, cfg, maxesStat, maxesAll, anyOver25, anyOver10, youthCount, youthNeeded, filledSquads, typeDist, bv };
}

// ── Kontrast-gulv-eksperiment: hvad er det LAVESTE max-evne man kan opnå? ──────
// Fallback-stien har INGEN floor → en rytter med ALLE stats = 50 får alle evner = 1.
// Vi viser hvad et 1-bredt og et meget smalt vindue giver (mod et hypotetisk
// scenarie hvor floor=8 alligevel ramte, hvis ejeren senere flytter disse ryttere
// til fysiologi-stien).
function contrastFloorProbe() {
  console.log(`\n================ KONTRAST-GULV PROBE ================`);
  // Vis ren matematik: ability = round(1 + clamp((stat-50)/35,0,1)*98).
  const ab = (stat) => Math.round(1 + clamp((stat - 50) / 35, 0, 1) * 98);
  console.log("PCM-fallback (= prod-vej for disse ryttere): stat→ability");
  for (const stat of [50, 51, 52, 53, 54, 55, 56, 57, 58, 60]) {
    console.log(`  stat ${stat} → ability ${ab(stat)}`);
  }
  console.log("→ FALLBACK har ingen floor: stat=50 giver ability=1. 'max 10' kræver derfor IKKE uniformitet på prod-vejen.");
  console.log("→ Hvis ejeren i stedet sætter disse ryttere på FYSIOLOGI-stien (kontrast floor=8): da clampes hver fysisk evne ≥ 8,");
  console.log("  så den LAVESTE opnåelige per-rytter max ville være ≈ floor (≈8) og rytterne ville være næsten uniforme. Variation");
  console.log("  vender først tilbage når vinduet er bredt nok til at spændet (k·(raw−median)) løfter signatur-evnen mærkbart over 8.");
}

// ── #1560: SINGLE-TEAM SIGNUP-SIMULERING (nye hold efter relaunch) ─────────────
// Hvert NYT hold får 8 ryttere fra SAMME svage pulje, men med et per-hold seed
// (deriveTeamSeed) → varierede, reproducerbare trupper. Vi simulerer N signups og
// måler scorecardet på tværs (forward-guard ≤25, trup-styrke [50,57], 0 stjerner,
// type-spredning). Spejler produktionens allocateStarterSquadForTeam-vej.
const SINGLE_TEAM_WINDOW = STARTER_POOL_STAT_WINDOW; // [50,57] (ejer-valgt)
const BASE_SEED = 2026;                              // launch-seed (som prod-default)

// Byg én 8-rytter-trup for et givet teamId via den ÆGTE prod-vej (clamp →
// fallback-derivation → type → base_value). Returnerer pr.-rytter-detaljer.
function buildSingleTeamSquad(teamId) {
  const teamSeed = deriveTeamSeed((BASE_SEED + 1487) >>> 0, teamId);
  const { riders } = generateFictionalRiders({
    seed: teamSeed, count: STARTER_SQUAD.CORE_SIZE, referenceYear: REFERENCE_YEAR,
  });
  return riders.map((r, i) => {
    const clampedStats = {};
    for (const k of STAT_KEYS) clampedStats[k] = clamp(r[k], SINGLE_TEAM_WINDOW.lo, SINGLE_TEAM_WINDOW.hi);
    const row = { ...r, ...clampedStats, id: `${teamId}-${i}` };
    const abilities = deriveAbilities({}, row, { asOfYear: REFERENCE_YEAR }); // prod-fallback
    const { primary, secondary } = computeRiderTypes(abilities, baseline);
    const withType = { ...row, primary_type: primary.key, secondary_type: secondary.key };
    return {
      teamId,
      primary_type: primary.key,
      abilities,
      base_value: predictBaseValue(withType, abilities, model),
    };
  });
}

function singleTeamSignupSim(nSignups = 50) {
  console.log(`\n================ #1560 SINGLE-TEAM SIGNUP-SIM (${nSignups} nye hold) ================`);
  console.log(`per-hold seed = deriveTeamSeed(${(BASE_SEED + 1487) >>> 0}, teamId) · vindue [${SINGLE_TEAM_WINDOW.lo},${SINGLE_TEAM_WINDOW.hi}]`);
  const STAT_DRIVEN = VISIBLE_ABILITIES.filter((k) => k !== "tactics" && k !== "aggression");
  const STAR_BV = 8_000_000; // STAR_RIDER_MARKET_VALUE-niveau (superstjerne-tærskel)

  const squadStrengths = [];        // pr.-hold gennemsnitlig top-evne (= "hold-styrke"-proxy)
  let globalMaxAbility = 0;
  let starCount = 0;
  const typeSet = new Set();
  const distinctTypesPerSquad = [];
  const allSquadAvgStat = [];       // pr.-hold gns. clampet stat (skal ligge i [50,57])

  for (let s = 0; s < nSignups; s++) {
    const teamId = `sim-team-${s}-${(Math.random() * 1e9) | 0}`; // unik UUID-agtig id pr. signup
    const squad = buildSingleTeamSquad(teamId);

    const squadDistinct = new Set(squad.map((r) => r.primary_type));
    distinctTypesPerSquad.push(squadDistinct.size);
    for (const t of squadDistinct) typeSet.add(t);

    let squadTopSum = 0;
    for (const r of squad) {
      const topAbility = Math.max(...STAT_DRIVEN.map((k) => r.abilities[k]));
      globalMaxAbility = Math.max(globalMaxAbility, topAbility);
      squadTopSum += topAbility;
      if ((r.base_value || 0) >= STAR_BV) starCount++;
    }
    squadStrengths.push(squadTopSum / squad.length);
  }

  // "Hold-styrke i [50,57]": ejer-vinduet er på STAT-skalaen (de clampede pcm-stats),
  // ikke evne-skalaen. Vi måler derfor den gns. clampede stat pr. hold mod [50,57],
  // OG rapporterer evne-forward-guarden (≤25) separat.
  for (let s = 0; s < nSignups; s++) {
    const teamId = `strcheck-${s}`;
    const { riders } = generateFictionalRiders({
      seed: deriveTeamSeed((BASE_SEED + 1487) >>> 0, teamId), count: STARTER_SQUAD.CORE_SIZE, referenceYear: REFERENCE_YEAR,
    });
    let sum = 0; let n = 0;
    for (const r of riders) for (const k of STAT_KEYS) { sum += clamp(r[k], SINGLE_TEAM_WINDOW.lo, SINGLE_TEAM_WINDOW.hi); n++; }
    allSquadAvgStat.push(sum / n);
  }

  const minStat = Math.min(...allSquadAvgStat);
  const maxStat = Math.max(...allSquadAvgStat);
  const distinctAcross = typeSet.size;
  const avgDistinctPerSquad = distinctTypesPerSquad.reduce((a, b) => a + b, 0) / distinctTypesPerSquad.length;

  console.log(`forward-guard: stærkeste STAT-DREVNE evne over ALLE ${nSignups} trupper: ${globalMaxAbility}  (krav ≤25)`);
  console.log(`hold-stat-vindue: pr.-hold gns. clampet stat ∈ [${minStat.toFixed(2)}, ${maxStat.toFixed(2)}]  (krav ⊆ [${SINGLE_TEAM_WINDOW.lo},${SINGLE_TEAM_WINDOW.hi}])`);
  console.log(`stjerne-ryttere (base_value ≥ ${STAR_BV.toLocaleString("en-US")}): ${starCount}  (krav 0)`);
  console.log(`distinkte rytter-typer på tværs af alle trupper: ${distinctAcross}/8  (krav ≥4)`);
  console.log(`gns. distinkte typer pr. 8-rytter-trup: ${avgDistinctPerSquad.toFixed(1)}`);

  const checks = [
    ["top-evne ≤25", globalMaxAbility <= 25],
    [`hold-stat ⊆ [${SINGLE_TEAM_WINDOW.lo},${SINGLE_TEAM_WINDOW.hi}]`, minStat >= SINGLE_TEAM_WINDOW.lo && maxStat <= SINGLE_TEAM_WINDOW.hi],
    ["0 stjerner", starCount === 0],
    ["≥4 distinkte typer på tværs", distinctAcross >= 4],
  ];
  let allPass = true;
  for (const [label, ok] of checks) { console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}`); if (!ok) allPass = false; }
  console.log(allPass ? "→ #1560 SINGLE-TEAM SIM: ALLE ASSERTIONS PASS" : "→ #1560 SINGLE-TEAM SIM: MINDST ÉN FEJLEDE");
  if (!allPass) process.exitCode = 1;
}

console.log("=== #1487 SVAG START-POOL — måle-prototype (READ-ONLY) ===");
console.log(`seed ${SEED} · pool ${POOL_COUNT} · ${TEAMS}×${SQUAD}=${TEAMS * SQUAD} startryttere`);
console.log(`Derivations-vej: PCM-FALLBACK (= relaunch/akademi-prod-vej; ingen kontrast). Skala 1..99.`);

scorecard("ultra-weak", { lo: 50, hi: 52 });
scorecard("weak", { lo: 50, hi: 54 });
scorecard("weak-with-variety", { lo: 50, hi: 57 });
// Ekstra vinduer: hvor vender variety/typer tilbage, og hvad koster det i max-evne?
scorecard("floor-probe [50,51]", { lo: 50, hi: 51 });
scorecard("variety-A [50,60]", { lo: 50, hi: 60 });
scorecard("variety-B [50,63]", { lo: 50, hi: 63 });
scorecard("variety-C [50,66]", { lo: 50, hi: 66 });
contrastFloorProbe();
singleTeamSignupSim(50);

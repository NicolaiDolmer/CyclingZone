#!/usr/bin/env node
// Race-engine dry-run / kalibrerings-cockpit (#1102).
//
// Kører HELE den kalibrerede launch-population gennem den ægte light-motor over en
// hel sæson — 100% in-memory, rører INTET i prod/DB/flag. Formålet er at kalibrere
// motoren mod ejer-definerede mål-vinderrater og at gøre det SYNLIGT: ud over
// console-rapporten skrives en selvstændig HTML-cockpit (--html) med hele Grand
// Tour'en etape-for-etape (startliste + resultater) + en målscorecard.
//
// Kæden (præcis som prod-backfillsne + previewFictionalPopulation.js):
//   generateFictionalRiders → deriveAbilities → computeRiderTypes/predictBaseValue
//     → simulateStage / buildRaceResults (UÆNDREDE rene funktioner)
//
//   node scripts/simulateSeasonDryRun.js [--seed=2026] [--count=800] \
//        [--races=300] [--field=140] [--gtField=176] [--html=<sti>] [--no-html] \
//        [--condition=random] [--roles] [--enforce-targets]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateFictionalRiders, makeRng } from "../lib/fictionalRiderGenerator.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { predictBaseValue, riderOverall, riderSpecialty } from "../lib/riderValuation.js";
import { DEMAND_VECTORS } from "../lib/raceStageProfileGenerator.js";
import { simulateStage, stableSeed, NOISE_SD_SCALE, aggressionScore, BREAKAWAY_PROFILES } from "../lib/raceSimulator.js";
import { buildRaceResults } from "../lib/raceRunner.js";
import { evaluateRaceStructuralOracles, evaluateAbilityLivenessOracle } from "../lib/raceDryRunOracles.js";
import { abilityRankSensitivity, SENSITIVITY_DELTA } from "../lib/raceSensitivity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const SEED = parseInt(arg("seed", "2026"), 10);
const COUNT = parseInt(arg("count", "800"), 10);
const RACES = parseInt(arg("races", "300"), 10);
const FIELD = parseInt(arg("field", "140"), 10);
const GT_FIELD = parseInt(arg("gtField", "176"), 10);
const REFERENCE_YEAR = 2026;
const WRITE_HTML = !arg("no-html", false);
const HTML_PATH = arg("html", join(__dirname, "out", "race-dry-run.html"));
// #1198/#1144: strukturelle motor-oracles (sektion D) håndhæves ALTID (exit 1 ved
// brud). Kalibrerings-bånd (sektion B-scorecardet) håndhæves kun med dette flag,
// da baseline-targets afventer ejer-beslutning (se kalibrerings-loggen nedenfor).
const ENFORCE_TARGETS = !!arg("enforce-targets", false);
// B4 (#1306): --condition=random tilsætter seeded form/træthed per rytter.
// Neutral-mode (fraværende flag) er UÆNDRET — ingen ekstra rng-kald i den sti.
const CONDITION_MODE = arg("condition", null) === "random";
// #1307: --roles snake-drafter hvert felt i hold af 8 og tildeler race_role
// (captain/hunter/helper) → måler hold- og udbruds-mekanikken mod populationen.
// Prøve-trækningen (sampleField) er UÆNDRET — roller udledes deterministisk af
// prøven og konsumerer ingen rng, så felterne er identiske med neutral-mode.
const ROLES_MODE = !!arg("roles", false);
// Plan 1 (#1122): --enforce-liveness gør evne-liveness-scorecardet (sektion E) til
// en hard gate (exit 1). Default off, så Phase A's race:gate forbliver grøn mens
// instrumentet bygges; tilføjes race:gate-scriptet i Phase C når motoren er grøn.
const ENFORCE_LIVENESS = !!arg("enforce-liveness", false);

const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModel.json"), "utf8"));

// ── Ejer-besluttede gate-bånd (2026-06-11, jf. genre-benchmark-research) ──────
// Interim-bånd nåelige med motor-tuning alene. FULDE mål (7/6) bevaret nedenfor;
// hæves via population-berigelse (cobbles/hilly) + evne-system v2 #1122 (itt).
//   Fulde mål: flat 90 · itt tt 85 · cobbles 90 (interim-bånd 80, jf. research) · hilly 50 · mountain 85.
const TARGETS = {
  flat:          { label: "sprinter ≥90%", types: ["sprinter"], pct: 0.90 },
  itt:           { label: "tt ≥60% (interim)", types: ["tt"], pct: 0.60 },
  itt_tempo:     { label: "tt+gc ≥95%", terrain: "itt", types: ["tt", "gc"], pct: 0.95 },
  cobbles:       { label: "brostensrytter ≥80%", types: ["brostensrytter"], pct: 0.80 },
  hilly:         { label: "puncheur ≥35% (interim)", types: ["puncheur"], pct: 0.35 },
  mountain:      { label: "gc+climber+baroudeur ≥85%", types: ["gc", "climber", "baroudeur"], pct: 0.85 },
  high_mountain: { label: "gc+climber+baroudeur ≥85%", types: ["gc", "climber", "baroudeur"], pct: 0.85 },
};

// ── KALIBRERINGS-LOG (2026-06-11) — tuning COMMITTET, gate grøn på 3 seeds ────
// NOISE_SD_SCALE 0.20→0.16 (raceSimulator.js). Strategi (genre-research): skærp
// nøgle-evne-vægte + sænk støj — mål blev IKKE sænket. Endelige vægte: se
// DEMAND_VECTORS i raceStageProfileGenerator.js (ÉT sted at tune).
// Født-som pr. seed 2026/7/42 (bånd i parentes), alle ✓:
//   flat 93/97/93 (≥90) · itt tt 66/65/62 (≥60) · itt tt+gc 100/100/100 (≥95)
//   cobbles 98/100/100 (≥80) · hilly 82/82/47 (≥35) · mountain 93/93/99 (≥85)
//   high_mountain 91/91/99 (≥85) · udbruds-andel 0% (rapport-only, uændret).
// FUND: itt er population-bundet — tt-born overgår gc-born ALENE på time_trial
//   (+1,5 PCM snit) og positioning (fl-boost); alle neutrale dimensioner favoriserer
//   gc (+1,5 base-adjust). Deraf pos-tung itt-vektor; plateau ~62% på seed 42
//   (binding seed, gc-tunge tt-ruller). Fuldt mål (tt 85%) kræver evne-system v2 #1122.
// FUND: udbrud (baroudeur) på bjerg kan IKKE købes med vægte — tactics/positioning-
//   skift gav 0 baroudeur-sejre men +12% puncheur (gruppen faldt 93→87%). Kræver
//   ægte udbruds-mekanik i den fulde motor (#1021).
//
// ── KALIBRERINGS-LOG (2026-06-12, #1307 Task 9) — udbrud + roller, 3 seeds grønne ──
// Endelige konstanter (raceSimulator.js): BREAKAWAY_PROFILES flat 0.30 / rolling
//   0.17 / mountain 0.33 · BREAKAWAY_TOP_EXCLUDED 0.05 · HUNTER_WEIGHT_MULTIPLIER 2
//   · TEAM_RACE_WEIGHT 0.024. BREAKAWAY_TARGETS-båndene blev IKKE justeret.
// FUND: design-værdierne (0.10/0.12/0.16, cut 0.4) gav 0,0 % escapee-sejre overalt —
//   pyramide-populationens terrain-gab ved cut'et (0.33-0.55) overstiger enhver
//   "lille" bonus. Cut 0.05 + spread-skala bonusser løste det; på flat eskaperer
//   sub-top-SPRINTERE (p5-p10), så sprinter ≥90 %-målet og udbruds-båndet er
//   forenelige. Hunter-vægt ×3→×2 + TEAM 0.010→0.024 gjorde kaptajn-deltaet
//   positivt (ved ×3 stjal hunters netto sejre fra kaptajnerne på alle seeds).
// Udbruds-bånd (escapee-vinder-andel) pr. seed — neutral/condition/roles, alle ✓:
//   seed 2026: flat 2.3/2.0/4.0 (bånd 1-10) · rolling 9.0/8.7/6.7 (2-12) · mountain 10.0/10.0/10.3 (5-25)
//   seed 7  (roles): flat 6.0 · rolling 8.7 · mountain 10.3
//   seed 42 (roles): flat 5.7 · rolling 6.3 · mountain 10.0
// Roles-metrikker (roles vs neutral-tvilling, 8×300 løb): kaptajn-delta
//   2026 +20 (2063/2043) · 7 +9 (2077/2068) · 42 +15 (2117/2102); hunter/helper-
//   escapee-ratio 3.4 / 2.8 / 3.0 (krav >1.5).
// Scorecard (født-som) holdt på alle 7 mål i alle 5 gate-kørsler; binding margin:
//   flat sprinter 90 % (seed 42 roles + 2026 roles) — flat-bonus >0.30 vælter den.
const TERRAINS = ["flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "cobbles", "classic"];

// ── Udbruds-gate-bånd (#1307, 2026-06-12) — escapee-VINDER-andel pr. terræn ───
// Andel af sejre vundet af en rytter med aktiv udbruds-bonus
// (components.breakaway > 0) — uafhængigt af født-som-type, modsat born-as-
// linsen i "udbruds-andel"-rapporten nedenfor. Måles i ALLE modes; håndhæves
// med --enforce-targets. Bånd til ejer-review i PR'en (irl-pejling: udbrud
// holder sjældent hjem på flade sprinter-etaper, oftere i mellembjerg/bjerg).
//
// NB: high_mountain og øvrige profiler har BEVIDST intet bånd — spec 8.3 giver
// kun udbruds-bonus på flad/rolling/medium-bjerg (BREAKAWAY_PROFILES), så
// escapee-share dér er per konstruktion 0. Tilføj IKKE et high_mountain-bånd —
// det ville fejle på 0% og stride mod design-kontrakten.
const BREAKAWAY_TARGETS = {
  flat:     { min: 0.01, max: 0.10 },
  rolling:  { min: 0.02, max: 0.12 },
  mountain: { min: 0.05, max: 0.25 },
};

// ── Hjælpere ──────────────────────────────────────────────────────────────────
const padE = (s, n) => String(s).padEnd(n);
const padS = (s, n) => String(s).padStart(n);
const pct1 = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const pctS = (a, b) => `${pct1(a, b)}%`;
const money = (n) => (n == null ? "—" : `${(Math.round(n / 1000) / 1000).toFixed(2).replace(/\.?0+$/, "")}M`);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];
}
function sampleField(rng, pool, n) {
  const idx = pool.map((_, i) => i);
  const take = Math.min(n, idx.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, take).map((i) => pool[i]);
}
const top3 = (hist, total) => Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 3)
  .map(([t, n]) => `${t} ${pctS(n, total)}`).join(", ");
function keyAbilityOf(demand) {
  return Object.entries(demand).filter(([k]) => k !== "randomness").sort((a, b) => b[1] - a[1])[0][0];
}

// #1307 --roles: snake-draft prøven ind i hold af 8 efter overall (spejler GT'ens
// snake-logik nedenfor), og tildel roller:
//   captain = bedste overall pr. hold
//   hunter  = på hvert ANDET hold (teamIdx % 2 === 0): højeste aggressionScore
//             blandt ikke-kaptajner (stabil rider_id-tiebreak)
//   helper  = alle øvrige
// Deterministisk: ingen rng — udledes alene af prøven.
const ROLES_TEAM_SIZE = 8;

/**
 * Fælles rolle-tildeler brugt af BÅDE terrain-sampleren (assignRoles) og
 * GT-blokken — ét sted at vedligeholde logikken.
 *
 * @param {Map<*, Member[]>}  teamsMap   - Map(teamKey → members[])
 * @param {(m: Member) => number}  getOverall  - henter overall fra et member
 * @param {(m: Member) => string}  getId       - henter den stabile id (tiebreak)
 * @param {(teamKey: *) => number} getTeamIdx  - konverterer teamKey til numerisk indeks
 * @param {(m: Member) => object}  getAbilities - henter abilities-objektet
 * @returns {Map<string, "captain"|"hunter"|"helper">}  roleById (keyed på getId(m))
 */
function assignRolesToTeams(teamsMap, { getOverall, getId, getTeamIdx, getAbilities }) {
  const roleById = new Map();
  for (const [teamKey, members] of teamsMap) {
    // captain = højeste overall (stabil id-tiebreak: lavere streng vinder)
    let captain = members[0];
    for (const m of members) {
      const mOvr = getOverall(m), cOvr = getOverall(captain);
      if (mOvr > cOvr || (mOvr === cOvr && String(getId(m)) < String(getId(captain)))) {
        captain = m;
      }
    }
    roleById.set(getId(captain), "captain");
    // hunter = kun på hvert andet hold (teamIdx % 2 === 0)
    if (getTeamIdx(teamKey) % 2 === 0) {
      let hunter = null;
      let hunterScore = -Infinity;
      for (const m of members) {
        if (getId(m) === getId(captain)) continue;
        const score = aggressionScore(getAbilities(m));
        if (score > hunterScore ||
            (score === hunterScore && hunter && String(getId(m)) < String(getId(hunter)))) {
          hunter = m;
          hunterScore = score;
        }
      }
      if (hunter) roleById.set(getId(hunter), "hunter");
    }
    // helper = alle øvrige
    for (const m of members) {
      if (!roleById.has(getId(m))) roleById.set(getId(m), "helper");
    }
  }
  return roleById;
}

function assignRoles(sample) {
  const byOverall = [...sample].sort((a, b) =>
    b.overall - a.overall || String(a.id).localeCompare(String(b.id))
  );
  const nTeams = Math.ceil(byOverall.length / ROLES_TEAM_SIZE);
  const teamById = new Map();
  const membersByTeam = new Map();
  for (let i = 0; i < byOverall.length; i++) {
    const round = Math.floor(i / nTeams);
    const pos = i % nTeams;
    const teamIdx = round % 2 === 0 ? pos : nTeams - 1 - pos;
    teamById.set(byOverall[i].id, teamIdx);
    if (!membersByTeam.has(teamIdx)) membersByTeam.set(teamIdx, []);
    membersByTeam.get(teamIdx).push(byOverall[i]);
  }
  const roleById = assignRolesToTeams(membersByTeam, {
    getOverall:   (r) => r.overall,
    getId:        (r) => r.id,
    getTeamIdx:   (teamIdx) => teamIdx,
    getAbilities: (r) => r.abilities,
  });
  return { roleById, teamById };
}

// ── 1. Generér + berig felt (hele værdi-kæden, in-memory) ────────────────────
console.log(`\n🚴  RACE-ENGINE DRY-RUN — seed=${SEED} count=${COUNT} noise=${NOISE_SD_SCALE}${CONDITION_MODE ? " condition=random" : ""}${ROLES_MODE ? " roles" : ""} (in-memory, rører ikke prod)\n`);

const { riders: raw } = generateFictionalRiders({ count: COUNT, seed: SEED, referenceYear: REFERENCE_YEAR });

const field = raw.map((r, i) => {
  const id = `r${i}`;
  const abilities = deriveAbilities({}, { ...r, id }, { asOfYear: REFERENCE_YEAR });
  const derived = computeRiderTypes(abilities, baseline).primary?.key ?? "?";
  return {
    id, team_id: null,
    name: `${r.firstname} ${r.lastname}`,
    nat: r.nationality_code,
    bornAs: r._meta?.archetype ?? "?",
    derived,
    specialty: riderSpecialty(abilities),
    overall: riderOverall(abilities),
    baseValue: predictBaseValue({ primary_type: derived }, abilities, model),
    is_u25: !!r.is_u25,
    abilities,
  };
});
const byId = new Map(field.map((r) => [r.id, r]));

// B4: condition-mode — tildel seeded form/træthed per rytter.
// Bruger en DEDIKERET RNG afledt af et XOR-scrambled seed, så den aldrig
// konsumeres i neutral-mode og aldrig forskydes andre træk.
if (CONDITION_MODE) {
  const condRng = makeRng((stableSeed(`condition:${SEED}`) ^ 0xC04D1710) >>> 0);
  for (const r of field) {
    const u1 = condRng();
    const u2 = condRng();
    r.form    = Math.round(30 + u1 * 60); // [30, 90]
    r.fatigue = Math.round(u2 * 70);      // [0, 70]
  }
}

const fieldMedianAbility = (key) => {
  const s = field.map((r) => r.abilities[key]).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ── A. Felt-resumé ────────────────────────────────────────────────────────────
const typeCount = {};
for (const r of field) typeCount[r.derived] = (typeCount[r.derived] || 0) + 1;
const ovSorted = field.map((r) => r.overall).sort((a, b) => a - b);
const bvSorted = field.map((r) => r.baseValue).filter((v) => v != null).sort((a, b) => a - b);
const fieldSummary = {
  n: field.length,
  ov: { p10: percentile(ovSorted, 0.10), median: percentile(ovSorted, 0.50), p90: percentile(ovSorted, 0.90), max: ovSorted[ovSorted.length - 1] },
  bv: { median: percentile(bvSorted, 0.50), p90: percentile(bvSorted, 0.90), max: bvSorted[bvSorted.length - 1] },
  types: Object.entries(typeCount).sort((a, b) => b[1] - a[1]),
};

console.log("─".repeat(80));
console.log("A. FELT-RESUMÉ\n");
console.log(`  Ryttere: ${fieldSummary.n}   ·   Overall: p10 ${fieldSummary.ov.p10} · median ${fieldSummary.ov.median} · p90 ${fieldSummary.ov.p90} · max ${fieldSummary.ov.max}`);
console.log(`  base_value: median ${money(fieldSummary.bv.median)} · p90 ${money(fieldSummary.bv.p90)} · max ${money(fieldSummary.bv.max)}`);
console.log(`  Afledt type-mix: ${fieldSummary.types.map(([t, n]) => `${t} ${pctS(n, field.length)}`).join(" · ")}`);

// ── B. Terræn-fordeling + indsamling til scorecard/HTML ──────────────────────
const terrainResults = [];
for (const terrain of TERRAINS) {
  const demand = DEMAND_VECTORS[terrain];
  const keyAb = keyAbilityOf(demand);
  const rng = makeRng(stableSeed(`dryrun:${SEED}:${terrain}`));
  const bornHist = {}, derivedHist = {};
  const winners = new Set();
  let strongestWon = 0, overallRankSum = 0, winnerKeySum = 0;
  // #1307: udbruds-vinder-tæller (ALLE modes) + roles-mode-metrikker.
  let breakawayWinCount = 0;
  let captainWinsRoles = 0, captainWinsNeutral = 0;
  let hunterEscapes = 0, helperEscapes = 0, hunterExposures = 0, helperExposures = 0;

  for (let i = 0; i < RACES; i++) {
    const sample = sampleField(rng, field, FIELD);
    const raceSeed = stableSeed(`${terrain}:${i}`);
    const roles = ROLES_MODE ? assignRoles(sample) : null;
    const entrants = sample.map((r) => ({
      rider_id: r.id,
      team_id: ROLES_MODE ? `t${roles.teamById.get(r.id)}` : r.id,
      abilities: r.abilities,
      ...(ROLES_MODE ? { race_role: roles.roleById.get(r.id) } : {}),
      ...(CONDITION_MODE && r.form    != null ? { form:    r.form }    : {}),
      ...(CONDITION_MODE && r.fatigue != null ? { fatigue: r.fatigue } : {}),
    }));
    const { ranked } = simulateStage({ entrants, stageProfile: { profile_type: terrain, demand_vector: demand }, seed: raceSeed });
    const w = byId.get(ranked[0].rider_id);
    bornHist[w.bornAs] = (bornHist[w.bornAs] || 0) + 1;
    derivedHist[w.derived] = (derivedHist[w.derived] || 0) + 1;
    winners.add(w.id);
    winnerKeySum += w.abilities[keyAb];
    const byOverall = [...sample].sort((a, b) => b.overall - a.overall);
    const rank = byOverall.findIndex((r) => r.id === w.id) + 1;
    overallRankSum += rank;
    if (rank === 1) strongestWon++;
    if ((ranked[0].components.breakaway || 0) > 0) breakawayWinCount++;

    if (ROLES_MODE) {
      if (roles.roleById.get(ranked[0].rider_id) === "captain") captainWinsRoles++;
      // Neutral tvilling: SAMME prøve + seed, men uden roller/hold (som neutral-
      // mode) → måler om rolle-mekanikken netto gavner kaptajnerne.
      const neutralEntrants = sample.map((r) => ({
        rider_id: r.id, team_id: r.id, abilities: r.abilities,
        ...(CONDITION_MODE && r.form    != null ? { form:    r.form }    : {}),
        ...(CONDITION_MODE && r.fatigue != null ? { fatigue: r.fatigue } : {}),
      }));
      const neutral = simulateStage({ entrants: neutralEntrants, stageProfile: { profile_type: terrain, demand_vector: demand }, seed: raceSeed });
      if (roles.roleById.get(neutral.ranked[0].rider_id) === "captain") captainWinsNeutral++;
      // Escapee-deltagelse pr. rolle (kun udbruds-egnede terræner producerer escapees).
      if (BREAKAWAY_PROFILES[terrain]) {
        for (const r of ranked) {
          const role = roles.roleById.get(r.rider_id);
          if (role === "hunter") {
            hunterExposures++;
            if (r.components.breakaway > 0) hunterEscapes++;
          } else if (role === "helper") {
            helperExposures++;
            if (r.components.breakaway > 0) helperEscapes++;
          }
        }
      }
    }
  }
  terrainResults.push({
    terrain, keyAb, races: RACES,
    winnerKeyAvg: Math.round(winnerKeySum / RACES), fieldMedianKey: fieldMedianAbility(keyAb),
    bornHist, derivedHist, distinct: winners.size,
    avgStrengthRank: overallRankSum / RACES, strongestWonPct: pct1(strongestWon, RACES),
    breakawayWinShare: breakawayWinCount / RACES,
    ...(ROLES_MODE ? { captainWinsRoles, captainWinsNeutral, hunterEscapes, helperEscapes, hunterExposures, helperExposures } : {}),
  });
}

// ── Scorecard vs ejer-mål (født-som = ægte type) ─────────────────────────────
// t.terrain overstyr: itt_tempo er et ekstra bånd på samme terræn som itt.
const scorecard = Object.entries(TARGETS).map(([key, t]) => {
  const terrain = t.terrain ?? key;
  const tr = terrainResults.find((x) => x.terrain === terrain);
  const bornHit = t.types.reduce((s, ty) => s + (tr.bornHist[ty] || 0), 0);
  const derivedHit = t.types.reduce((s, ty) => s + (tr.derivedHist[ty] || 0), 0);
  const bornPct = bornHit / tr.races, derivedPct = derivedHit / tr.races;
  return { terrain: key, label: t.label, targetPct: t.pct, bornPct, derivedPct, pass: bornPct >= t.pct };
});

console.log(`\n${"─".repeat(80)}`);
console.log("B. MÅL-SCORECARD (født-som = ægte rytter-type; afledt = spillets label)\n");
console.log(`   ${padE("terræn", 14)}${padE("mål", 26)}${padE("født-som", 11)}${padE("afledt", 10)}status`);
console.log(`   ${"-".repeat(74)}`);
for (const s of scorecard) {
  const delta = Math.round((s.bornPct - s.targetPct) * 100);
  console.log(`   ${padE(s.terrain, 14)}${padE(s.label, 26)}${padE(`${Math.round(s.bornPct * 100)}%`, 11)}${padE(`${Math.round(s.derivedPct * 100)}%`, 10)}${s.pass ? "✓" : `✗ (${delta >= 0 ? "+" : ""}${delta})`}`);
}
console.log(`\n   Motor belønner rigtig evne? (vinder ⌀nøgle-evne vs felt-median):`);
for (const tr of terrainResults) {
  console.log(`   ${padE(tr.terrain, 14)} ${padE(tr.keyAb, 12)} vinder ⌀${padS(tr.winnerKeyAvg, 2)} vs median ${padS(tr.fieldMedianKey, 2)}   ⌀rang ${tr.avgStrengthRank.toFixed(1)}   distinkt ${tr.distinct}/${tr.races}`);
}

// ── Udbruds-andel (rapport-only, ingen exit-kode) ────────────────────────────
// Baroudeur/fighter = udbrudstyperne; irl vinder de ~40%+ af bjerg-etaper.
// 0% er et rødt flag: motoren er for deterministisk (GC-ryttere dominerer blindt).
// NB: "fighter" er IKKE en nuværende generator-arketype (kun "baroudeur" findes i
// fictionalRiderGenerator.js) — termen beholdes defensivt fra ejerens 7/6-vokabular.
// NB (#1307): dette er en ANDEN linse end udbruds-båndene nedenfor — her måles
// hvor ofte en baroudeur-FØDT rytter vinder bjergsejre (type-linse); båndene
// måler escapee-baserede sejre (components.breakaway > 0) uanset type.
const mtTerrains = terrainResults.filter((x) => x.terrain === "mountain" || x.terrain === "high_mountain");
const breakawayWins = mtTerrains.reduce((s, tr) => s + (tr.bornHist["baroudeur"] || 0) + (tr.bornHist["fighter"] || 0), 0);
const mtTotalWins = mtTerrains.reduce((s, tr) => s + tr.races, 0);
const breakawayShare = pct1(breakawayWins, mtTotalWins);
console.log(`\n   udbruds-andel (baroudeur/fighter) af bjergsejre: ${breakawayShare}% (irl ~40%; 0% = rød flag, rapport-only)`);

// ── Udbruds-bånd (#1307) — escapee-vinder-andel vs BREAKAWAY_TARGETS ─────────
// Evalueres i ALLE modes; håndhæves (exit 1) kun med --enforce-targets.
const breakawayBandFailures = [];
console.log(`\n   UDBRUDS-BÅND (escapee-vinder-andel; håndhæves med --enforce-targets):`);
for (const [terrain, band] of Object.entries(BREAKAWAY_TARGETS)) {
  const tr = terrainResults.find((x) => x.terrain === terrain);
  const share = tr.breakawayWinShare;
  const ok = share >= band.min && share <= band.max;
  if (!ok) breakawayBandFailures.push(`udbrud:${terrain} ${(share * 100).toFixed(1)}% udenfor [${(band.min * 100).toFixed(1)}%, ${(band.max * 100).toFixed(1)}%]`);
  console.log(`   ${padE(terrain, 14)} ${padS((share * 100).toFixed(1), 5)}%   bånd [${padS((band.min * 100).toFixed(1), 4)}%, ${padS((band.max * 100).toFixed(1), 4)}%]   ${ok ? "✓" : "✗"}`);
}

// ── Roles-mode-metrikker (#1307) — kaptajn-delta + hunter-ratio ──────────────
// captainWinsRoles ≥ captainWinsNeutral: rolle-mekanikken (team-boost + udbrud)
// må ikke NETTO koste kaptajnerne sejre på tværs af terræner.
// hunterEscapeRate > 1.5 × helperEscapeRate: hunter-rollen skal mærkes (pr.
// rytter-løb, aggregeret over de tre udbruds-egnede terræner).
const rolesFailures = [];
if (ROLES_MODE) {
  const capRoles = terrainResults.reduce((s, tr) => s + (tr.captainWinsRoles || 0), 0);
  const capNeutral = terrainResults.reduce((s, tr) => s + (tr.captainWinsNeutral || 0), 0);
  const hunterEsc = terrainResults.reduce((s, tr) => s + (tr.hunterEscapes || 0), 0);
  const hunterN = terrainResults.reduce((s, tr) => s + (tr.hunterExposures || 0), 0);
  const helperEsc = terrainResults.reduce((s, tr) => s + (tr.helperEscapes || 0), 0);
  const helperN = terrainResults.reduce((s, tr) => s + (tr.helperExposures || 0), 0);
  const hunterRate = hunterN ? hunterEsc / hunterN : 0;
  const helperRate = helperN ? helperEsc / helperN : 0;
  const capOk = capRoles >= capNeutral;
  const huntOk = hunterRate > 1.5 * helperRate;
  if (!capOk) rolesFailures.push(`kaptajn-delta: roles ${capRoles} < neutral ${capNeutral} sejre`);
  if (!huntOk) rolesFailures.push(`hunter-ratio: ${(hunterRate * 100).toFixed(2)}% ≤ 1.5 × helper ${(helperRate * 100).toFixed(2)}%`);
  console.log(`\n   ROLES-METRIKKER (håndhæves med --enforce-targets):`);
  console.log(`   kaptajn-sejre  roles ${capRoles} vs neutral ${capNeutral} (over ${TERRAINS.length}×${RACES} løb)   ${capOk ? "✓" : "✗"}`);
  console.log(`   escapee-rate   hunter ${(hunterRate * 100).toFixed(2)}% (${hunterEsc}/${hunterN}) vs helper ${(helperRate * 100).toFixed(2)}% (${helperEsc}/${helperN}) · ratio ${helperRate ? (hunterRate / helperRate).toFixed(1) : "∞"} (kræver >1.5)   ${huntOk ? "✓" : "✗"}`);
}

// ── C. Grand Tour (fuld 21-etapers, til eyeball + HTML) ──────────────────────
const GT_TEMPLATE = [
  "flat", "flat", "hilly", "rolling", "itt",
  "flat", "hilly", "mountain", "high_mountain", "flat",
  "rolling", "mountain", "hilly", "flat", "itt",
  "mountain", "high_mountain", "mountain", "high_mountain", "hilly",
  "flat",
];
const gtStages = GT_TEMPLATE.map((profile_type, i) => ({ stage_number: i + 1, profile_type, demand_vector: DEMAND_VECTORS[profile_type] }));

const gtRng = makeRng(stableSeed(`dryrun:${SEED}:gt`));
const gtRiders = sampleField(gtRng, field, GT_FIELD).sort((a, b) => b.overall - a.overall);
const TEAM_SIZE = 8;
const nTeams = Math.ceil(gtRiders.length / TEAM_SIZE);
const gtEntrants = gtRiders.map((r, i) => {
  const round = Math.floor(i / nTeams), pos = i % nTeams;
  const teamIdx = round % 2 === 0 ? pos : nTeams - 1 - pos;
  return {
    rider_id: r.id, team_id: `t${teamIdx}`, rider_name: r.name, is_u25: r.is_u25, abilities: r.abilities,
    ...(CONDITION_MODE && r.form    != null ? { form:    r.form }    : {}),
    ...(CONDITION_MODE && r.fatigue != null ? { fatigue: r.fatigue } : {}),
  };
});

// #1307 --roles: tildel roller INDEN FOR de eksisterende GT-hold via den
// fælles assignRolesToTeams-helper (samme regler som terrain-sampleren).
if (ROLES_MODE) {
  const gtTeams = new Map();
  for (const e of gtEntrants) {
    if (!gtTeams.has(e.team_id)) gtTeams.set(e.team_id, []);
    gtTeams.get(e.team_id).push(e);
  }
  const gtRoleById = assignRolesToTeams(gtTeams, {
    getOverall:   (e) => byId.get(e.rider_id).overall,
    getId:        (e) => e.rider_id,
    getTeamIdx:   (teamId) => Number(teamId.slice(1)),
    getAbilities: (e) => e.abilities,
  });
  for (const e of gtEntrants) {
    e.race_role = gtRoleById.get(e.rider_id);
  }
}

const { resultRows } = buildRaceResults({
  race: { id: "gt-dry", race_type: "stage_race" },
  stages: gtStages, entrants: gtEntrants, pointsLookup: {},
});
const finalStage = GT_TEMPLATE.length;
const rowsOf = (type, stage) => resultRows.filter((x) => x.result_type === type && x.stage_number === stage).sort((a, b) => a.rank - b.rank);

// Per-etape struktur til HTML
const gtStageData = gtStages.map((s) => {
  const sn = s.stage_number;
  const top = rowsOf("stage", sn).slice(0, 10).map((row) => ({ rank: row.rank, rider: byId.get(row.rider_id), time: row.finish_time }));
  const leadFor = (type) => { const r = rowsOf(type, sn)[0]; return r ? byId.get(r.rider_id) : null; };
  return {
    stage_number: sn, profile_type: s.profile_type, keyAb: keyAbilityOf(s.demand_vector), top,
    leader: leadFor("leader"), points_day: leadFor("points_day"), mountain_day: leadFor("mountain_day"), young_day: leadFor("young_day"),
  };
});
const gtFinal = {
  gc: rowsOf("gc", finalStage).slice(0, 20).map((row) => ({ rank: row.rank, rider: byId.get(row.rider_id), time: row.finish_time })),
  points: rowsOf("points", finalStage).slice(0, 5).map((row) => ({ rank: row.rank, rider: byId.get(row.rider_id) })),
  mountain: rowsOf("mountain", finalStage).slice(0, 5).map((row) => ({ rank: row.rank, rider: byId.get(row.rider_id) })),
  young: rowsOf("young", finalStage).slice(0, 5).map((row) => ({ rank: row.rank, rider: byId.get(row.rider_id) })),
  team: resultRows.filter((x) => x.result_type === "team" && x.stage_number === finalStage).sort((a, b) => a.rank - b.rank).slice(0, 5),
};

const lbl = (r) => `${padE(r.name, 22)} ${padE(r.bornAs, 13)} →${padE(r.derived, 12)} ovr ${padS(r.overall, 2)}  ${money(r.baseValue)}`;
console.log(`\n${"─".repeat(80)}`);
console.log(`C. GRAND TOUR — 21 etaper, ${GT_FIELD}-rytters felt\n`);
console.log(`  🏆 GC top 10:`);
for (const g of gtFinal.gc.slice(0, 10)) console.log(`   ${padS(g.rank, 2)}. ${lbl(g.rider)}  ${g.time ?? ""}`);
console.log(`  👕 Grøn: ${gtFinal.points[0] ? gtFinal.points[0].rider.name + " (" + gtFinal.points[0].rider.bornAs + ")" : "—"} · Bjerg: ${gtFinal.mountain[0] ? gtFinal.mountain[0].rider.name + " (" + gtFinal.mountain[0].rider.bornAs + ")" : "—"} · Ungdom: ${gtFinal.young[0] ? gtFinal.young[0].rider.name : "—"}`);

// ── D. STRUKTURELLE MOTOR-ORACLES (#1198/#1144) — håndhævet, exit 1 ved brud ──
// GC-tid-invarianten genberegnes UAFHÆNGIGT af raceRunner: summen af etape-gab
// pr. rytter fra de rå 'stage'-rækker — GC-vinderen skal have feltets minimum.
const parseGap = (t) => {
  const m = /^\+(\d+):(\d{2})$/.exec(String(t || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const cumGapById = new Map();
for (const row of resultRows) {
  if (row.result_type !== "stage") continue;
  const s = parseGap(row.finish_time);
  if (s == null) continue;
  cumGapById.set(row.rider_id, (cumGapById.get(row.rider_id) || 0) + s);
}
const gcAllRows = rowsOf("gc", finalStage);
const gcOracle = gcAllRows.length
  ? {
      winnerCumSeconds: cumGapById.get(gcAllRows[0].rider_id) ?? NaN,
      minCumSeconds: Math.min(...gcAllRows.map((g) => cumGapById.get(g.rider_id) ?? NaN)),
    }
  : null;

// Værdi-sanity: top-decilen (overall) skal være mere værd end bund-decilen.
const medianOf = (arr) => {
  const s = arr.filter((v) => v != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const byOverallDesc = [...field].sort((a, b) => b.overall - a.overall);
const decileN = Math.max(1, Math.floor(field.length / 10));
const valueOracle = {
  topDecileMedian: medianOf(byOverallDesc.slice(0, decileN).map((r) => r.baseValue)),
  bottomDecileMedian: medianOf(byOverallDesc.slice(-decileN).map((r) => r.baseValue)),
};

const structuralFailures = evaluateRaceStructuralOracles({ terrainResults, gc: gcOracle, value: valueOracle });
const failedTargets = scorecard.filter((s) => !s.pass);

console.log(`\n${"─".repeat(80)}`);
console.log("D. STRUKTURELLE MOTOR-ORACLES (håndhævet — exit 1 ved brud)\n");
if (structuralFailures.length) {
  console.log("   ❌ ORACLE-BRUD:");
  for (const f of structuralFailures) console.log(`   - ${f}`);
  process.exitCode = 1;
} else {
  console.log("   ✓ nøgle-evne belønnes på alle terræner · ingen monopol-vindere · GC = laveste tid · værdi-pyramide ikke inverteret");
}
if (failedTargets.length) {
  if (ENFORCE_TARGETS) {
    console.log(`   ❌ ${failedTargets.length} kalibrerings-bånd under mål (--enforce-targets aktiv → exit 1): ${failedTargets.map((s) => s.terrain).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`   ⚠ ${failedTargets.length} kalibrerings-bånd under mål (rapport-only; håndhæv med --enforce-targets): ${failedTargets.map((s) => s.terrain).join(", ")}`);
  }
}
// #1307: udbruds-bånd + roles-metrikker — samme håndhævelses-kontrakt som scorecardet.
const breakawayGateFailures = [...breakawayBandFailures, ...rolesFailures];
if (breakawayGateFailures.length) {
  if (ENFORCE_TARGETS) {
    console.log(`   ❌ ${breakawayGateFailures.length} udbruds-/roles-bånd brudt (--enforce-targets aktiv → exit 1): ${breakawayGateFailures.join(" · ")}`);
    process.exitCode = 1;
  } else {
    console.log(`   ⚠ ${breakawayGateFailures.length} udbruds-/roles-bånd brudt (rapport-only; håndhæv med --enforce-targets): ${breakawayGateFailures.join(" · ")}`);
  }
}

// ── E. EVNE-LIVENESS (#1122) — rykker hver evne faktisk placeringen? ──────────
// Probe-matrix: (evne, terræn, mode). Terræn-kraft testes neutralt; seam/dynamik-
// evner i deres mode (aggression: udbruds-egnet terræn; durability: condition;
// descending: descent-finale). Gulvet er bevidst lavt (0.05 ⌀rank) — vi tester
// "påvirker den OVERHOVEDET", ikke kalibrerings-styrke (det er scorecardet i B).
// Rapport-only; håndhæves (exit 1) med --enforce-liveness (tilføjes race:gate i Phase C).
const LIVENESS_PROBES = [
  // Allerede-levende terræn-kraft (sanity — skal være grønne fra start):
  { ability: "sprint",      terrain: "flat",          mode: "neutral" },
  { ability: "climbing",    terrain: "mountain",      mode: "neutral" },
  { ability: "time_trial",  terrain: "itt",           mode: "neutral" },
  { ability: "cobblestone", terrain: "cobbles",       mode: "neutral" },
  { ability: "punch",       terrain: "hilly",         mode: "neutral" },
  { ability: "endurance",   terrain: "high_mountain", mode: "neutral" },
  // Plan 1-aktiverede (RØDE i Phase A, GRØNNE efter Phase B):
  { ability: "flat",        terrain: "rolling",       mode: "neutral" },
  { ability: "tempo",       terrain: "mountain",      mode: "neutral" },
  { ability: "aggression",  terrain: "flat",          mode: "breakaway" },
  { ability: "durability",  terrain: "high_mountain", mode: "condition" },
  { ability: "descending",  terrain: "mountain",      mode: "finale", finaleType: "descent" },
];
const LIVENESS_FLOOR = 0.05;

// Felt med condition til durability-proben (genbrug condition-felter hvis sat,
// ellers seeded form/fatigue lokalt så proben er reproducerbar uafhængigt af flag).
const livenessField = field.map((r) => {
  if (r.form != null || r.fatigue != null) return r;
  const lr = makeRng((stableSeed(`liveness:${SEED}:${r.id}`) ^ 0x5eed1135) >>> 0);
  return { ...r, form: Math.round(30 + lr() * 60), fatigue: Math.round(30 + lr() * 50) };
});

const livenessResults = LIVENESS_PROBES.map((p) => {
  const rankGain = abilityRankSensitivity({
    field: p.mode === "condition" ? livenessField : field,
    profileType: p.terrain,
    demandVector: DEMAND_VECTORS[p.terrain],
    ability: p.ability,
    finaleType: p.finaleType ?? null,
    withCondition: p.mode === "condition",
    samples: 150, fieldSize: 80, seed: SEED,
  });
  return { ...p, rankGain };
});

const livenessFailures = evaluateAbilityLivenessOracle(livenessResults, { floor: LIVENESS_FLOOR });

console.log(`\n${"─".repeat(80)}`);
console.log(`E. EVNE-LIVENESS (⌀rank-gevinst ved +${SENSITIVITY_DELTA} på probe-rytter; gulv ${LIVENESS_FLOOR})\n`);
for (const r of livenessResults) {
  const ok = r.rankGain >= LIVENESS_FLOOR;
  console.log(`   ${padE(r.ability, 13)} ${padE(r.terrain, 14)} ${padE(r.mode, 10)} ⌀rank ${padS(r.rankGain.toFixed(2), 6)}   ${ok ? "✓" : "✗ DØDVÆGT"}`);
}
if (livenessFailures.length) {
  if (ENFORCE_LIVENESS) {
    console.log(`   ❌ ${livenessFailures.length} evne(r) er dødvægt (--enforce-liveness aktiv → exit 1):`);
    for (const f of livenessFailures) console.log(`   - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`   ⚠ ${livenessFailures.length} evne(r) er dødvægt (rapport-only; håndhæv med --enforce-liveness): ${livenessResults.filter((r) => r.rankGain < LIVENESS_FLOOR).map((r) => r.ability).join(", ")}`);
  }
}

// ── B4: condition-mode sanity ─────────────────────────────────────────────────
if (CONDITION_MODE) {
  // Reelle vægte fra raceSimulator: FORM_RACE_WEIGHT=0.012, FATIGUE_RACE_WEIGHT=0.008.
  // formComponent  = ((form-50)/50)*0.012  → [30,90]-interval giver [-0.0048, +0.0096], swing 0.0144.
  // fatigueComponent = (fatigue/100)*0.008 → [0,70]-interval giver [0, +0.0056], swing 0.0056.
  // Kombineret max score-swing (condition-interval): 0.0144 + 0.0056 = 0.020.
  const forms    = field.map((r) => r.form    ?? 60);
  const fatigues = field.map((r) => r.fatigue ?? 0);
  const maxForm    = Math.max(...forms),    minForm    = Math.min(...forms);
  const maxFatigue = Math.max(...fatigues), minFatigue = Math.min(...fatigues);
  const meanForm    = Math.round(forms.reduce((s, v) => s + v, 0) / forms.length);
  const meanFatigue = Math.round(fatigues.reduce((s, v) => s + v, 0) / fatigues.length);
  console.log(`\n   condition-mode sanity (B4 — felt=${field.length} ryttere):`);
  console.log(`   form    range [${minForm}, ${maxForm}] ·  mean ${meanForm}  (tilsigtet [30, 90])`);
  console.log(`   fatigue range [${minFatigue}, ${maxFatigue}] · mean ${meanFatigue} (tilsigtet [0, 70])`);
  console.log(`   max score-swing (condition-interval): form 0.0144 + fatigue 0.0056 = 0.020`);
}

// ── HTML-cockpit ──────────────────────────────────────────────────────────────
if (WRITE_HTML) {
  const chip = (r) => r ? `<span class="chip ${r.bornAs}">${esc(r.bornAs)}</span>` : "—";
  const riderCell = (r) => r ? `<b>${esc(r.name)}</b> ${chip(r)} <span class="muted">→${esc(r.derived)} · ovr ${r.overall} · ${money(r.baseValue)}</span>` : "—";

  const scorecardRows = scorecard.map((s) => `
    <tr class="${s.pass ? "pass" : "fail"}">
      <td>${esc(s.terrain)}</td><td>${esc(s.label)}</td>
      <td class="num"><b>${Math.round(s.bornPct * 100)}%</b></td>
      <td class="num muted">${Math.round(s.derivedPct * 100)}%</td>
      <td class="num">${Math.round(s.targetPct * 100)}%</td>
      <td>${s.pass ? "✓ ramt" : `✗ ${Math.round((s.bornPct - s.targetPct) * 100)}`}</td>
    </tr>`).join("");

  const terrainRows = terrainResults.map((tr) => `
    <tr>
      <td>${esc(tr.terrain)}</td><td>${esc(tr.keyAb)}</td>
      <td class="num"><b>${tr.winnerKeyAvg}</b> <span class="muted">vs ${tr.fieldMedianKey}</span></td>
      <td>${esc(top3(tr.bornHist, tr.races))}</td>
      <td class="muted">${esc(top3(tr.derivedHist, tr.races))}</td>
      <td class="num">${tr.avgStrengthRank.toFixed(1)}</td>
      <td class="num">${tr.distinct}/${tr.races}</td>
    </tr>`).join("");

  const typeBar = fieldSummary.types.map(([t, n]) => `<span class="chip ${t}">${esc(t)} ${pctS(n, field.length)}</span>`).join(" ");

  const stageBlocks = gtStageData.map((st) => {
    const rows = st.top.map((x) => `<tr><td class="num">${x.rank}</td><td>${riderCell(x.rider)}</td><td class="num muted">${esc(x.time || "")}</td></tr>`).join("");
    const jerseys = [["GC", st.leader], ["Grøn", st.points_day], ["Bjerg", st.mountain_day], ["Ungdom", st.young_day]]
      .filter(([, r]) => r).map(([k, r]) => `${k}: <b>${esc(r.name)}</b> ${chip(r)}`).join(" · ");
    return `
    <details>
      <summary>Etape ${st.stage_number} — <span class="terrain ${st.profile_type}">${esc(st.profile_type)}</span> <span class="muted">(nøgle: ${esc(st.keyAb)})</span></summary>
      <div class="stage-body">
        <table class="results"><thead><tr><th>#</th><th>Rytter</th><th>Tid</th></tr></thead><tbody>${rows}</tbody></table>
        ${jerseys ? `<p class="jerseys">${jerseys}</p>` : ""}
      </div>
    </details>`;
  }).join("");

  const gcRows = gtFinal.gc.map((g) => `<tr><td class="num">${g.rank}</td><td>${riderCell(g.rider)}</td><td class="num muted">${esc(g.time || "")}</td></tr>`).join("");
  const finalJerseys = [["🟢 Point", gtFinal.points[0]?.rider], ["⛰️ Bjerg", gtFinal.mountain[0]?.rider], ["⚪ Ungdom", gtFinal.young[0]?.rider]]
    .map(([k, r]) => `<div class="jcard"><div class="jt">${k}</div>${r ? riderCell(r) : "—"}</div>`).join("");

  const startlist = gtRiders.map((r) => `<tr><td>${esc(r.name)}</td><td>${chip(r)}</td><td class="muted">→${esc(r.derived)}</td><td class="num">${r.overall}</td><td class="num">${esc(r.specialty)}</td><td class="num">${money(r.baseValue)}</td></tr>`).join("");

  // Hele populationen (godkendelses-view) — sorteret efter base_value, med de
  // vigtigste disciplin-evner så feltets indhold kan vurderes direkte.
  const roster = [...field].sort((a, b) => (b.baseValue || 0) - (a.baseValue || 0));
  const rosterRows = roster.map((r, i) => `<tr><td class="num">${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="muted">${esc(r.nat)}</td><td>${chip(r)}</td><td class="muted">→${esc(r.derived)}</td><td class="num">${r.overall}</td><td class="num">${money(r.baseValue)}</td><td class="num">${r.abilities.climbing}</td><td class="num">${r.abilities.sprint}</td><td class="num">${r.abilities.time_trial}</td><td class="num">${r.abilities.punch}</td><td class="num">${r.abilities.cobblestone}</td><td class="num">${r.abilities.endurance}</td></tr>`).join("");

  const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>Race-engine cockpit</title>
<style>
:root{--bg:#0f1419;--panel:#1a2129;--line:#2a333d;--txt:#e6edf3;--muted:#8b98a5;--accent:#5cc8ff;--pass:#1f7a3f;--fail:#7a2a2a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 system-ui,Segoe UI,sans-serif;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px;color:var(--accent);border-bottom:1px solid var(--line);padding-bottom:6px}
.sub{color:var(--muted);margin:0 0 8px}.wrap{max-width:1100px;margin:0 auto}
table{border-collapse:collapse;width:100%;background:var(--panel);border-radius:8px;overflow:hidden;margin:6px 0}
th,td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.muted{color:var(--muted)}
tr.pass td:last-child{color:#5fd38a;font-weight:700}tr.fail td:last-child{color:#ff8a8a;font-weight:700}
tr.pass{background:linear-gradient(90deg,rgba(31,122,63,.18),transparent)}tr.fail{background:linear-gradient(90deg,rgba(122,42,42,.18),transparent)}
details{background:var(--panel);border:1px solid var(--line);border-radius:8px;margin:6px 0}summary{cursor:pointer;padding:10px 14px;font-weight:600}
.stage-body{padding:0 14px 12px}.results th,.results td{padding:4px 8px}.jerseys{color:var(--muted);font-size:13px;margin:8px 2px 2px}
.terrain,.chip{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.chip{background:#2a333d;color:#cfd8e0}.terrain{background:#243b53;color:#9ecbff}
.chip.sprinter,.terrain.flat{background:#3a2a4d;color:#d6b3ff}.chip.climber,.chip.gc,.terrain.mountain,.terrain.high_mountain{background:#1f4030;color:#9ff0c0}
.chip.tt,.terrain.itt{background:#0e3a4d;color:#8fe3ff}.chip.brostensrytter,.terrain.cobbles{background:#4d3a1f;color:#f0d49f}
.chip.puncheur,.terrain.hilly{background:#4d2f1f;color:#ffc59f}.chip.baroudeur,.terrain.classic{background:#3a3a1f;color:#e8e89f}
.jcards{display:flex;gap:10px;flex-wrap:wrap}.jcard{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 12px;flex:1;min-width:220px}.jt{color:var(--muted);font-size:12px;margin-bottom:2px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:820px){.grid2{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>🚴 Race-engine kalibrerings-cockpit</h1>
<p class="sub">seed ${SEED} · ${COUNT} ryttere · noise ${NOISE_SD_SCALE} · ${RACES} løb/terræn · in-memory (rører ikke prod)</p>

<h2>Mål-scorecard <span class="muted" style="font-weight:400">— født-som = ægte rytter-type · afledt = spillets label</span></h2>
<table><thead><tr><th>Terræn</th><th>Mål</th><th class="num">Født-som</th><th class="num">Afledt</th><th class="num">Mål%</th><th>Status</th></tr></thead><tbody>${scorecardRows}</tbody></table>

<h2>Belønner motoren den rigtige evne?</h2>
<p class="sub">Vinder ⌀ i terrænets nøgle-evne vs. felt-median. ⌀rang = vinderens overall-placering i feltet (1 = stærkest).</p>
<table><thead><tr><th>Terræn</th><th>Nøgle-evne</th><th class="num">Vinder ⌀</th><th>Vinder født-som (top3)</th><th>Vinder afledt (top3)</th><th class="num">⌀rang</th><th class="num">Distinkte</th></tr></thead><tbody>${terrainRows}</tbody></table>

<h2>Feltet</h2>
<p class="sub">${fieldSummary.n} ryttere · overall median ${fieldSummary.ov.median} (p90 ${fieldSummary.ov.p90}, max ${fieldSummary.ov.max}) · base_value median ${money(fieldSummary.bv.median)} (max ${money(fieldSummary.bv.max)})</p>
<p>${typeBar}</p>

<h2>Grand Tour — 21 etaper, ${GT_FIELD}-rytters felt</h2>
<div class="grid2">
  <div>
    <h3 style="margin:4px 0">🏆 Slutstilling (GC)</h3>
    <table class="results"><thead><tr><th>#</th><th>Rytter</th><th>Tid</th></tr></thead><tbody>${gcRows}</tbody></table>
  </div>
  <div>
    <h3 style="margin:4px 0">👕 Trøjer</h3>
    <div class="jcards" style="flex-direction:column">${finalJerseys}</div>
  </div>
</div>
<h3 style="margin:18px 0 4px">Etaper</h3>
${stageBlocks}

<h2>Grand Tour-startliste (${GT_FIELD} ryttere, sorteret efter overall)</h2>
<table><thead><tr><th>Rytter</th><th>Født-som</th><th>Afledt</th><th class="num">Ovr</th><th class="num">Speciale</th><th class="num">Værdi</th></tr></thead><tbody>${startlist}</tbody></table>

<h2>Hele populationen — ${field.length} ryttere <span class="muted" style="font-weight:400">(godkendelses-view, sorteret efter værdi)</span></h2>
<p class="sub">Dette er feltet motoren testes mod. Vurdér: er pyramiden troværdig (få superstjerner, mange domestiques)? Har hver type rigtige tal i sin signatur-evne? Mangler der nogen?</p>
<div style="max-height:620px;overflow:auto;border:1px solid var(--line);border-radius:8px">
<table style="margin:0"><thead><tr><th class="num">#</th><th>Rytter</th><th>Nat</th><th>Født-som</th><th>Afledt</th><th class="num">Ovr</th><th class="num">Værdi</th><th class="num">Klatr</th><th class="num">Sprint</th><th class="num">TT</th><th class="num">Punch</th><th class="num">Brost</th><th class="num">Udh</th></tr></thead><tbody>${rosterRows}</tbody></table>
</div>
</div></body></html>`;

  mkdirSync(dirname(HTML_PATH), { recursive: true });
  writeFileSync(HTML_PATH, html, "utf8");
  console.log(`\n📄 HTML-cockpit: ${HTML_PATH}`);
  console.log(`   Åbn i browser (dobbeltklik, eller: start "" "${HTML_PATH}")`);
}

console.log(`\n${"─".repeat(80)}`);
console.log(`Færdig. Read-only — intet skrevet til prod/DB. Exit-kontrakt: ${process.exitCode === 1 ? "❌ exit 1 (oracle-/bånd-brud)" : "✅ exit 0"}.\n`);

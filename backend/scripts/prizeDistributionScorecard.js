#!/usr/bin/env node
// #1606 prize-distribution-scorecard — MÅLER hvad et hold FAKTISK tjener i præmie.
//
// FORMÅL (ejer-direktiv 2026-06-20): NIVEAUET af præmiepenge er aldrig målt empirisk.
// moneySupplyScorecard.js:54 modellerer præmie som et UKALIBRERET gæt (D1 160k/D2 70k/
// D3 25k pr. sæson, eksplicit mærket "IKKE målt"). De faktiske brutto-præmiepuljer er
// 10-100× større (et ProSeries-event ~4,75M, OtherWorldTourA ~10,6M CZ$), men kun
// rytterne på et manager-hold udbetales (payable vs earned, prizePayoutEngine.js).
// Dette script simulerer en HEL sæson SYNTETISK og rapporterer den FAKTISKE præmie
// pr. hold-percentil pr. division + net-balance + 5-sæsons trajektorie.
//
// 100 % SYNTETISK — ingen Supabase, ingen live-DB, ingen prod-impact. Ren in-memory
// kørsel af de UÆNDREDE rene motorfunktioner (samme kæde som simulateSeasonDryRun.js).
//
//   node scripts/prizeDistributionScorecard.js [--seed=2026] [--teams=22] [--markdown]
//
// ════════════════════════════════════════════════════════════════════════════════
// MODEL-ANTAGELSER (eksplicitte — ærlige om begrænsninger)
// ════════════════════════════════════════════════════════════════════════════════
//
// 1. POPULATION + ROSTERE. Markedet = den låste launch-population (generateLaunchPopulation:
//    800 ryttere, seed 2026, fuld værdi-pyramide). Et manager-hold modelleres som en
//    8-rytters trup (= STARTER_SQUAD.SQUAD_SIZE, MIN_RIDERS_FOR_RACE) draftet fra et
//    REALISTISK værdi-BÅND af pyramiden — IKKE et "scoop alle superstjerner"-felt (de 12
//    superstjerner ≥8M er force-sale-beskyttede og fås ikke billigt på markedet). Bånd pr.
//    styrke-lag (division), valgt så lønbyrden matcher økonomi-konstanternes kalibrering
//    (#1441: en frisk roster-lønbyrde ≈ 316k/hold, dvs. 8 × ~40k løn = base_value ~600k):
//      • D1 "stærkt kompetent" : roster fra solid-toppen (~600k-1,2M base_value/rytter)
//      • D2 "kompetent mid"     : roster fra solid-midten (~350k-700k)
//      • D3 "spirende"          : roster fra solid-bunden (~180k-400k)
//    Squads draftes NON-OVERLAPPENDE (hver rytter på max ét hold). Det modellerer et
//    MODENT felt hvor managere HAR bygget kompetente (men ikke superstjerne-tunge) hold
//    op via auktion/marked — den fordeling ejeren vil tune præmie imod.
//    (Sæson 1 har ingen op/nedrykning endnu; division ER her styrke-laget, og præmie-
//    niveauet skal forstås pr. styrke-lag.)
//
// 2. FELT-SAMMENSÆTNING PR. LØB. Hvert løb afvikles med HELE manager-feltet (alle hold,
//    hver autopicker sine 6-8 bedst-egnede ryttere — samme rolle-logik som raceRunner) +
//    et FIKTIVT AI-felt (holdsløse pyramide-ryttere fra alle bånd) der padder op til
//    feltstørrelsen (140 single / 150 stage, jf. simulateSeasonDryRun defaults). KUN
//    manager-rytternes præmie udbetales — AI-rytternes præmie er "earned, not payable"
//    (prizePayoutEngine.js free_ai-split). Roller (captain/hunter/helper) tildeles pr. hold
//    så team/breakaway-mekanikken er aktiv (faithful til prod).
//
// 3. PLACERING → POINT → PRÆMIE. Ingen genvej: hvert løb køres gennem den ÆGTE
//    buildRaceResults (raceRunner.js) over ægte stage-profiler (generateRaceStageProfiles),
//    der scorer rider_derived_abilities mod terræn-demand + støj/team/udbrud. Point mappes
//    fra (race_class, result_type, rank) via den ÆGTE UCI-kurve (uciRacePointDefaults.js);
//    prize = points × PRIZE_PER_POINT (1.500). Identisk regnemodel som prod-importen.
//
// 4. KALENDER. Sæson 1 EKSKLUDERER WorldTour-klasser (ejer-beslutning 2026-05-09), så
//    kun ProSeries/Class1/Class2 er i spil. Seed-katalogets ikke-WT-pool er reelt
//    UDELUKKENDE ProSeries (race_pool_seed.csv: 0 Class1/Class2). selectFirstSeasonRaces
//    vælger ~60 løbsdage (27 ProSeries-etapeløb + ~50 ProSeries-endagsløb tilgængelige).
//    Dette er den realistiske præmie-kilde for sæson 1.
//
// 5. NET-MODEL. Identisk med moneySupplyScorecard: net = sponsor − upkeep − løn + præmie.
//    sponsor/upkeep er division-skalerede konstanter; løn er den frosne lønbyrde af holdets
//    FAKTISKE roster (round(base_value × SALARY_RATE), computeFrozenSalary). 5-sæsons
//    trajektorie: balance starter på 800k (INITIAL_BALANCE) og += net/sæson (statisk —
//    samme roster/præmie hver sæson; konservativt, ingen vækst/inflation modelleret).
//
// ── VIGTIGSTE BEGRÆNSNINGER (en mere præcis måling ville kræve) ──────────────────
//   • Ét seed, ét felt. Faktisk præmie afhænger af hvilke ryttere HVER manager køber —
//     her band-draftet (rationel, jævn fordeling inden for båndet). Ægte managere er
//     ujævne → større spredning end målt. Kør flere --seed for et interval.
//   • ROSTER-BÅND er en MODEL-INPUT (det blødeste valg her). Præmien er meget følsom for
//     roster-styrke; vælg vi superstjerne-tunge rosters eksploderer både præmie OG
//     lønbyrde. Båndene er valgt så lønbyrden matcher økonomi-kalibreringen (~316k/hold),
//     hvilket er den tilstand konstanterne ER tunet mod — men et hold der HAR superstjerner
//     tjener (og betaler) langt mere.
//   • Autopick vælger 6-8 ryttere; en manager der taktisk targeter små løb kan tjene mere.
//   • Ingen WT-løb (sæson 1). Sæson 2+ med WT-klasser har 10-100× større puljer → præmie
//     eksploderer; DENNE måling er KONSERVATIV (kun ProSeries).
//   • Division = styrke-lag her (band-proxy), ikke den ægte op/nedryknings-historik.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateLaunchPopulation } from "../lib/fictionalLaunchPopulation.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import { predictBaseValue, riderOverall } from "../lib/riderValuation.js";
import { buildUciMenRacePointRows } from "../lib/uciRacePointDefaults.js";
import { buildRacePointsLookup } from "../lib/raceResultsEngine.js";
import { buildRaceResults } from "../lib/raceRunner.js";
import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";
import { selectFirstSeasonRaces } from "../lib/seasonRaceSelection.js";
import { parseRacePoolCsv } from "../lib/racePoolImport.js";
import { aggressionScore } from "../lib/raceSimulator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { computeFrozenSalary } from "../lib/contractSeed.js";
import {
  SPONSOR_INCOME_BY_DIVISION,
  UPKEEP_BY_DIVISION,
  INITIAL_BALANCE,
} from "../lib/economyConstants.js";
// NB: SALARY_RATE (0.067) bruges via computeFrozenSalary; PRIZE_PER_POINT (1.500)
// via buildRaceResults — derfor ikke importeret direkte her.

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_YEAR = 2026;

// ── args ────────────────────────────────────────────────────────────────────────
function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}
const SEED = parseInt(arg("seed", "2026"), 10);
const TEAM_COUNT = parseInt(arg("teams", "22"), 10);   // relaunch-rehearsal: 22 manager-hold (#1191)
const ROSTER_SIZE = parseInt(arg("roster", "8"), 10);  // STARTER_SQUAD.SQUAD_SIZE = MIN_RIDERS_FOR_RACE
const SINGLE_FIELD = parseInt(arg("singleField", "140"), 10);
const STAGE_FIELD = parseInt(arg("stageField", "150"), 10);
const AUTOPICK_MIN = 6, AUTOPICK_MAX = 8;
// Superstjerne-tærskel (STAR_RIDER_MARKET_VALUE): de ~95 ryttere ≥8M er force-sale-
// beskyttede og knappe på markedet → udelukkes fra draft (et hold ejer ikke realistisk
// flere superstjerner). Holder lønbyrden tættere på det realistiske + isolerer signalet.
const SUPERSTAR_CUTOFF = 8_000_000;

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((sortedAsc.length - 1) * p)));
  return sortedAsc[idx];
}
const median = (arr) => percentile([...arr].sort((a, b) => a - b), 0.5);

// ── 1. Byg markedet (launch-population → fuld værdi-kæde) ───────────────────────
function buildMarket() {
  const baseline = JSON.parse(readFileSync(path.join(SCRIPT_DIR, "../lib/riderTypesBaseline.json"), "utf8"));
  const model = JSON.parse(readFileSync(path.join(SCRIPT_DIR, "../lib/riderValuationModel.json"), "utf8"));
  const { riders } = generateLaunchPopulation();

  return riders.map((r, i) => {
    const id = `r${i}`;
    const abilities = deriveAbilities(r._meta?.physiology ?? {}, { ...r, id }, { asOfYear: REFERENCE_YEAR });
    const primary = computeRiderTypes(abilities, baseline).primary?.key ?? null;
    const base_value = Math.round(predictBaseValue({ primary_type: primary }, abilities, model) ?? 0);
    return {
      id,
      name: `${r.firstname} ${r.lastname}`,
      is_u25: !!r.is_u25,
      abilities,
      overall: riderOverall(abilities),
      base_value,
      primary,
    };
  });
}

// ── 2. STRATIFICERET draft: distinkte styrke-lag pr. division ───────────────────
// Divisioner ER styrke-lag (D1 stærkest). For at producere GENUINT distinkte tiers
// (ikke 3 identiske balancerede grupper) stratificeres draften: de stærkeste ikke-
// superstjerne-ryttere fordeles til D1's hold, de næste til D2's, de svageste til D3's.
// Inden for HVER division snake-draftes (sorteret desc) → internt balancerede, indbyrdes
// sammenlignelige hold (starterSquadAllocator-fairness). Det modellerer et felt hvor D1
// er de bedst-byggede hold, D3 de spirende — den reelle division-betydning.
// (Sæson 1 har ingen op/nedrykning endnu; division er her ren styrke-lag-proxy.)
const DIVISION_TEAM_SPLIT = [
  { d: 1, teams: Math.round(TEAM_COUNT / 3) },
  { d: 2, teams: Math.round(TEAM_COUNT / 3) },
  { d: 3, teams: TEAM_COUNT - 2 * Math.round(TEAM_COUNT / 3) },
];

function draftTeams(market, teamCount, rosterSize) {
  const pool = market
    .filter((r) => r.base_value < SUPERSTAR_CUTOFF)
    .sort((a, b) => b.base_value - a.base_value)
    .slice(0, teamCount * rosterSize);

  const teams = [];
  const usedIds = new Set();
  let teamCounter = 0;
  let poolIdx = 0;
  for (const { d, teams: nTeams } of DIVISION_TEAM_SPLIT) {
    const divTeams = Array.from({ length: nTeams }, () => ({ id: `t${teamCounter++}`, division: d, riders: [] }));
    // Tag de næste (nTeams × rosterSize) ryttere fra den sorterede pool → dette tiers ryttere.
    const tierRiders = pool.slice(poolIdx, poolIdx + nTeams * rosterSize);
    poolIdx += nTeams * rosterSize;
    let i = 0;
    for (let round = 0; round < rosterSize; round++) {
      const order = round % 2 === 0 ? divTeams : [...divTeams].reverse();
      for (const team of order) {
        if (i >= tierRiders.length) break;
        team.riders.push(tierRiders[i]);
        usedIds.add(tierRiders[i].id);
        i++;
      }
    }
    for (const t of divTeams) t.rosterValue = t.riders.reduce((s, r) => s + r.base_value, 0);
    teams.push(...divTeams);
  }
  const freeAgents = market.filter((r) => !usedIds.has(r.id)); // fiktivt AI-felt (holdsløse)
  return { teams, freeAgents };
}

// ── 4. Autopick: pr. hold udtag de bedst-egnede AUTOPICK_MAX ryttere + roller ────
// Egnethed = overall (terræn-agnostisk proxy; raceAutopick bruger suitabilityScore men
// over en hel sæson af blandede terræner er overall en god approks). Roller: bedste
// overall = captain, højeste aggression blandt resten = hunter, øvrige = helper.
function autopickTeam(team, size) {
  const picked = [...team.riders].sort((a, b) => b.overall - a.overall).slice(0, size);
  if (!picked.length) return [];
  let captain = picked[0];
  let hunter = null, hunterScore = -Infinity;
  for (const r of picked.slice(1)) {
    const s = aggressionScore(r.abilities);
    if (s > hunterScore) { hunter = r; hunterScore = s; }
  }
  return picked.map((r) => ({
    rider_id: r.id,
    team_id: team.id,
    rider_name: r.name,
    is_u25: r.is_u25,
    abilities: r.abilities,
    race_role: r.id === captain.id ? "captain" : (hunter && r.id === hunter.id ? "hunter" : "helper"),
  }));
}

// ── 5. Byg sæson-kalenderen (ProSeries-only, ~60 løbsdage) ──────────────────────
function buildCalendar() {
  const csv = readFileSync(path.join(SCRIPT_DIR, "../../scripts/race_pool_seed.csv"), "utf8");
  const { rows } = parseRacePoolCsv(csv);
  // Giv hver pool-række en stabil id (selectSeasonRaces shuffler på id).
  const pool = rows.map((r, i) => ({ ...r, id: `pool-${i}` }));
  const { selected, totalRaceDays } = selectFirstSeasonRaces(pool, { seed: SEED });
  return { selected, totalRaceDays };
}

// ── 6. Afvikl ét løb → præmie pr. manager-hold ──────────────────────────────────
function runRace(race, teams, freeAgents, racePointsByClass, rng) {
  // Stage-profiler (ægte generator). Deterministisk seed pr. løb.
  const stages = generateRaceStageProfiles(
    { id: race.id, race_type: race.race_type, stages: race.stages },
    { seed: (SEED ^ hashStr(race.id)) >>> 0 }
  );

  // Manager-entrants: hvert hold autopicker.
  const entrants = [];
  for (const team of teams) {
    const size = AUTOPICK_MIN + Math.floor(rng() * (AUTOPICK_MAX - AUTOPICK_MIN + 1));
    entrants.push(...autopickTeam(team, size));
  }

  // Fiktivt AI-felt: holdsløse pyramide-ryttere padder op til feltstørrelsen.
  const fieldTarget = race.race_type === "stage_race" ? STAGE_FIELD : SINGLE_FIELD;
  const aiNeeded = Math.max(0, fieldTarget - entrants.length);
  const aiPool = sampleN(freeAgents, aiNeeded, rng);
  for (const r of aiPool) {
    entrants.push({
      rider_id: `ai-${r.id}`, team_id: null, rider_name: r.name,
      is_u25: r.is_u25, abilities: r.abilities,
    });
  }

  const racePoints = racePointsByClass.get(race.race_class) || [];
  const pointsLookup = buildRacePointsLookup({ racePoints, raceType: race.race_type });
  const { resultRows } = buildRaceResults({
    race: { id: race.id, race_type: race.race_type },
    stages, entrants, pointsLookup,
  });

  // Aggregér præmie pr. hold (kun rækker MED team_id — payable, jf. prizePayoutEngine).
  const prizeByTeam = new Map();
  let earned = 0, payable = 0;
  for (const row of resultRows) {
    earned += row.prize_money;
    if (row.team_id) {
      payable += row.prize_money;
      prizeByTeam.set(row.team_id, (prizeByTeam.get(row.team_id) || 0) + row.prize_money);
    }
  }
  return { prizeByTeam, earned, payable };
}

function sampleN(arr, n, rng) {
  if (n >= arr.length) return [...arr];
  const idx = arr.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map((i) => arr[i]);
}
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ── 7. Kør hele sæsonen + rapportér ─────────────────────────────────────────────
function main() {
  console.log(`\n=== #1606 PRIZE-DISTRIBUTION-SCORECARD — syntetisk sæson (seed ${SEED}, ${TEAM_COUNT} hold) ===\n`);

  const market = buildMarket();
  const { teams, freeAgents } = draftTeams(market, TEAM_COUNT, ROSTER_SIZE);
  const { selected, totalRaceDays } = buildCalendar();

  // Ægte UCI-kurve pr. race_class.
  const allPoints = buildUciMenRacePointRows();
  const racePointsByClass = new Map();
  for (const row of allPoints) {
    if (!racePointsByClass.has(row.race_class)) racePointsByClass.set(row.race_class, []);
    racePointsByClass.get(row.race_class).push(row);
  }

  // Felt-resumé.
  const ovSorted = market.map((r) => r.overall).sort((a, b) => a - b);
  const bvSorted = market.map((r) => r.base_value).sort((a, b) => a - b);
  console.log("MARKED (launch-population):");
  console.log(`  ${market.length} ryttere · overall p10 ${percentile(ovSorted, 0.1)}/median ${percentile(ovSorted, 0.5)}/p90 ${percentile(ovSorted, 0.9)}`);
  console.log(`  base_value median ${fmt(percentile(bvSorted, 0.5))} · p90 ${fmt(percentile(bvSorted, 0.9))} · max ${fmt(bvSorted[bvSorted.length - 1])}`);
  console.log(`  Draftet: ${teams.length} hold × ${ROSTER_SIZE} ryttere (ikke-superstjerne <${fmt(SUPERSTAR_CUTOFF)}) · ${freeAgents.length} free agents (AI-felt)`);
  for (const d of [1, 2, 3]) {
    const dt = teams.filter((t) => t.division === d);
    if (!dt.length) continue;
    const wageBills = dt.map((t) => t.riders.reduce((s, r) => s + computeFrozenSalary({ base_value: r.base_value, prize_earnings_bonus: 0 }), 0));
    console.log(`    D${d}: ${dt.length} hold · median roster-værdi ${fmt(median(dt.map((t) => t.rosterValue)))} · median lønbyrde ${fmt(median(wageBills))}`);
  }
  console.log();

  // Kalender-resumé.
  const byClass = {};
  for (const r of selected) byClass[r.race_class] = (byClass[r.race_class] || 0) + 1;
  const singles = selected.filter((r) => r.race_type === "single").length;
  const stageRaces = selected.filter((r) => r.race_type === "stage_race").length;
  console.log(`KALENDER (sæson 1, WT ekskluderet): ${selected.length} løb · ${totalRaceDays} løbsdage`);
  console.log(`  ${stageRaces} etapeløb + ${singles} endagsløb · klasser: ${Object.entries(byClass).map(([k, v]) => `${k} ${v}`).join(", ")}\n`);

  // Afvikl alle løb, akkumulér præmie pr. hold.
  const seasonPrize = new Map(teams.map((t) => [t.id, 0]));
  let totalEarned = 0, totalPayable = 0;
  const rng = makeRng((SEED ^ 0x9e3779b9) >>> 0);
  for (const race of selected) {
    const { prizeByTeam, earned, payable } = runRace(race, teams, freeAgents, racePointsByClass, rng);
    totalEarned += earned; totalPayable += payable;
    for (const [teamId, prize] of prizeByTeam) seasonPrize.set(teamId, seasonPrize.get(teamId) + prize);
  }

  console.log("PRÆMIE-PULJE (hele sæsonen):");
  console.log(`  Optjent (earned, alle ryttere): ${fmt(totalEarned)} CZ$`);
  console.log(`  Udbetalbar (payable, kun manager-hold): ${fmt(totalPayable)} CZ$ (${Math.round(100 * totalPayable / totalEarned)}% af optjent)`);
  console.log(`  AI-andel (earned − payable): ${fmt(totalEarned - totalPayable)} CZ$\n`);

  // ── Per-division percentiler ──────────────────────────────────────────────────
  const GUESS = { 1: 160000, 2: 70000, 3: 25000 };
  const divNets = {};
  console.log("PER-DIVISION PRÆMIE + NET/SÆSON:");
  console.log("─".repeat(92));
  for (const d of [1, 2, 3]) {
    const divTeams = teams.filter((t) => t.division === d);
    if (!divTeams.length) { console.log(`  D${d}: ingen hold`); continue; }
    const prizes = divTeams.map((t) => seasonPrize.get(t.id)).sort((a, b) => a - b);
    const salaries = divTeams.map((t) =>
      t.riders.reduce((s, r) => s + computeFrozenSalary({ base_value: r.base_value, prize_earnings_bonus: 0 }), 0)
    );
    const medPrize = median(prizes);
    const medSalary = median(salaries);
    const sponsor = SPONSOR_INCOME_BY_DIVISION[d];
    const upkeep = UPKEEP_BY_DIVISION[d];

    // Net pr. hold (sponsor − upkeep − holdets egen løn + holdets egen præmie).
    const nets = divTeams.map((t) => {
      const salary = t.riders.reduce((s, r) => s + computeFrozenSalary({ base_value: r.base_value, prize_earnings_bonus: 0 }), 0);
      return sponsor - upkeep - salary + seasonPrize.get(t.id);
    }).sort((a, b) => a - b);
    divNets[d] = nets;

    const guess = GUESS[d];
    const factor = guess ? medPrize / guess : 0;
    const dir = medPrize >= guess ? "OVER" : "UNDER";

    console.log(`  D${d} (${divTeams.length} hold, roster-værdi median ${fmt(median(divTeams.map((t) => t.rosterValue)))}):`);
    console.log(`     PRÆMIE/sæson  p10 ${fmt(percentile(prizes, 0.1))} · p25 ${fmt(percentile(prizes, 0.25))} · median ${fmt(medPrize)} · p75 ${fmt(percentile(prizes, 0.75))} · p90 ${fmt(percentile(prizes, 0.9))}`);
    console.log(`     vs GÆT ${fmt(guess)}: median er ${dir} med faktor ${factor.toFixed(2)}× (median ÷ gæt)`);
    console.log(`     NET/sæson     p10 ${fmt(percentile(nets, 0.1))} · median ${fmt(median(nets))} · p90 ${fmt(percentile(nets, 0.9))}   [sponsor ${fmt(sponsor)} − upkeep ${fmt(upkeep)} − løn ${fmt(medSalary)} + præmie ${fmt(medPrize)}]`);
  }
  console.log("─".repeat(92));

  // ── 5-sæsons balance-trajektorie (statisk roster/præmie, balance += net/sæson) ──
  console.log("\n5-SÆSONS BALANCE-TRAJEKTORIE (start 800k, balance += median-net/sæson; konservativ, ingen vækst):");
  for (const d of [1, 2, 3]) {
    if (!divNets[d]) continue;
    const medNet = median(divNets[d]);
    const traj = [];
    let bal = INITIAL_BALANCE;
    for (let s = 1; s <= 5; s++) { traj.push(bal); if (s < 5) bal += medNet; }
    traj.push(bal);
    console.log(`  D${d} (median-net ${fmt(medNet)}/sæson): S1 ${fmt(traj[0])} → S2 ${fmt(traj[1])} → S3 ${fmt(traj[2])} → S4 ${fmt(traj[3])} → S5 ${fmt(traj[4])}`);
  }

  // ── Sammenfatning mod gættet ──────────────────────────────────────────────────
  console.log("\nSAMMENFATNING — målt median-præmie vs nuværende gæt (moneySupplyScorecard:54):");
  for (const d of [1, 2, 3]) {
    const divTeams = teams.filter((t) => t.division === d);
    if (!divTeams.length) continue;
    const medPrize = median(divTeams.map((t) => seasonPrize.get(t.id)));
    const guess = GUESS[d];
    const factor = medPrize / guess;
    console.log(`  D${d}: gæt ${fmt(guess)} → målt ${fmt(medPrize)}  (${factor >= 1 ? "OVER" : "UNDER"} ${factor.toFixed(2)}×)`);
  }
  console.log("\nNOTE: 100% syntetisk, intet rørt i prod. Ét seed/felt — kør flere --seed for et interval.");
  console.log("      Sæson 1 = ProSeries-only (WT ekskluderet); sæson 2+ med WT-puljer (10-100× større) → præmie eksploderer.\n");
}

main();

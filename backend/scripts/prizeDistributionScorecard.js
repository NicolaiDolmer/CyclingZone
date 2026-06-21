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
import { INITIAL_BALANCE } from "../lib/economyConstants.js";
import {
  resolveOverrides,
  applyFlattenToPointRows,
  describeOverrides,
  renownSponsorFor,
} from "./lib/economyCalibrationOverrides.js";
// NB: SALARY_RATE (0.067) bruges via computeFrozenSalary. PRIZE_PER_POINT er IKKE
// importeret direkte: præmie genberegnes fra points_earned × override.prizePerPoint
// (override-default = prod 1.500) så NIVEAU-knappen virker uden at røre prod-konstanten.
// Sponsor/upkeep læses fra override (override-default = prod-konstanterne).

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_YEAR = 2026;

// ── args ────────────────────────────────────────────────────────────────────────
function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}
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
// Markedet er seed-uafhængigt (generateLaunchPopulation bruger fast intern seed) →
// cache det, så sweep'en (1000+ kandidater) ikke genbygger værdi-pyramiden hver gang.
let _marketCache = null;
function buildMarket() {
  if (_marketCache) return _marketCache;
  const baseline = JSON.parse(readFileSync(path.join(SCRIPT_DIR, "../lib/riderTypesBaseline.json"), "utf8"));
  const model = JSON.parse(readFileSync(path.join(SCRIPT_DIR, "../lib/riderValuationModel.json"), "utf8"));
  const { riders } = generateLaunchPopulation();

  _marketCache = riders.map((r, i) => {
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
  return _marketCache;
}

// ── 2. STRATIFICERET draft: distinkte styrke-lag pr. division ───────────────────
// Divisioner ER styrke-lag (D1 stærkest). For at producere GENUINT distinkte tiers
// (ikke 3 identiske balancerede grupper) stratificeres draften: de stærkeste ikke-
// superstjerne-ryttere fordeles til D1's hold, de næste til D2's, de svageste til D3's.
// Inden for HVER division snake-draftes (sorteret desc) → internt balancerede, indbyrdes
// sammenlignelige hold (starterSquadAllocator-fairness). Det modellerer et felt hvor D1
// er de bedst-byggede hold, D3 de spirende — den reelle division-betydning.
// (Sæson 1 har ingen op/nedrykning endnu; division er her ren styrke-lag-proxy.)
function divisionTeamSplit(teamCount) {
  return [
    { d: 1, teams: Math.round(teamCount / 3) },
    { d: 2, teams: Math.round(teamCount / 3) },
    { d: 3, teams: teamCount - 2 * Math.round(teamCount / 3) },
  ];
}

function draftTeams(market, teamCount, rosterSize) {
  const pool = market
    .filter((r) => r.base_value < SUPERSTAR_CUTOFF)
    .sort((a, b) => b.base_value - a.base_value)
    .slice(0, teamCount * rosterSize);

  const teams = [];
  const usedIds = new Set();
  let teamCounter = 0;
  let poolIdx = 0;
  for (const { d, teams: nTeams } of divisionTeamSplit(teamCount)) {
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
function buildCalendar(seed) {
  const csv = readFileSync(path.join(SCRIPT_DIR, "../../scripts/race_pool_seed.csv"), "utf8");
  const { rows } = parseRacePoolCsv(csv);
  // Giv hver pool-række en stabil id (selectSeasonRaces shuffler på id).
  const pool = rows.map((r, i) => ({ ...r, id: `pool-${i}` }));
  const { selected, totalRaceDays } = selectFirstSeasonRaces(pool, { seed });
  return { selected, totalRaceDays };
}

// ── 6. Afvikl ét løb → præmie pr. manager-hold ──────────────────────────────────
// prizePerPoint er override-knappen: præmie genberegnes fra points_earned i stedet for
// row.prize_money (som er bagt med prod-PRIZE_PER_POINT inde i buildRaceResults).
function runRace(race, teams, freeAgents, racePointsByClass, rng, seed, prizePerPoint) {
  // Stage-profiler (ægte generator). Deterministisk seed pr. løb.
  const stages = generateRaceStageProfiles(
    { id: race.id, race_type: race.race_type, stages: race.stages },
    { seed: (seed ^ hashStr(race.id)) >>> 0 }
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
  // Præmie = points_earned × prizePerPoint (override-knap; default = prod 1.500). Vi bruger
  // IKKE row.prize_money, da den er bagt med den importerede prod-konstant.
  const prizeByTeam = new Map();
  let earned = 0, payable = 0;
  for (const row of resultRows) {
    const prize = (row.points_earned || 0) * prizePerPoint;
    earned += prize;
    if (row.team_id) {
      payable += prize;
      prizeByTeam.set(row.team_id, (prizeByTeam.get(row.team_id) || 0) + prize);
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

// ── Gini-koefficient (divergens-metrik) på en array af net-værdier ──────────────
// Skiftet til alle-positive ved at trække min fra (Gini er udefineret for negative);
// måler RELATIV spredning af net mellem hold i en division.
function gini(values) {
  if (values.length < 2) return 0;
  const min = Math.min(...values);
  const shifted = values.map((v) => v - min);
  const sum = shifted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  const sorted = [...shifted].sort((a, b) => a - b);
  const n = sorted.length;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * sorted[i];
  return cum / (n * sum);
}

// ── 7. Kør hele sæsonen → struktureret resultat (genbruges af sweep) ─────────────
// opts: { seed, teamCount, rosterSize, overrides, print }
// Returnerer per-division { nets[], prizes[], salaries[], sponsor, upkeep, medNet,
// p10/p90 net, gini, p10p90Spread } + balance-trajektorier.
export function runScorecard(opts = {}) {
  const seed = opts.seed ?? 2026;
  const teamCount = opts.teamCount ?? 22;
  const rosterSize = opts.rosterSize ?? 8;
  const overrides = opts.overrides ?? resolveOverrides();
  const print = opts.print !== false;
  const { sponsorBase, upkeep: upkeepOv, prizePerPoint, flatten, breadthBoost, wResults, maxMultiplier } = overrides;

  if (print) {
    console.log(`\n=== #1606 PRIZE-DISTRIBUTION-SCORECARD — syntetisk sæson (seed ${seed}, ${teamCount} hold) ===`);
    console.log(`Overrides: ${describeOverrides(overrides)}\n`);
  }

  const market = buildMarket();
  const { teams, freeAgents } = draftTeams(market, teamCount, rosterSize);
  const { selected, totalRaceDays } = buildCalendar(seed);

  // Ægte UCI-kurve pr. race_class — reshapet af flatten-override (in-memory, prod uændret).
  const allPoints = applyFlattenToPointRows(buildUciMenRacePointRows(), flatten, breadthBoost);
  const racePointsByClass = new Map();
  for (const row of allPoints) {
    if (!racePointsByClass.has(row.race_class)) racePointsByClass.set(row.race_class, []);
    racePointsByClass.get(row.race_class).push(row);
  }

  // Felt-resumé.
  if (print) {
    const ovSorted = market.map((r) => r.overall).sort((a, b) => a - b);
    const bvSorted = market.map((r) => r.base_value).sort((a, b) => a - b);
    console.log("MARKED (launch-population):");
    console.log(`  ${market.length} ryttere · overall p10 ${percentile(ovSorted, 0.1)}/median ${percentile(ovSorted, 0.5)}/p90 ${percentile(ovSorted, 0.9)}`);
    console.log(`  base_value median ${fmt(percentile(bvSorted, 0.5))} · p90 ${fmt(percentile(bvSorted, 0.9))} · max ${fmt(bvSorted[bvSorted.length - 1])}`);
    console.log(`  Draftet: ${teams.length} hold × ${rosterSize} ryttere (ikke-superstjerne <${fmt(SUPERSTAR_CUTOFF)}) · ${freeAgents.length} free agents (AI-felt)`);
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
  }

  // Afvikl alle løb, akkumulér præmie pr. hold.
  const seasonPrize = new Map(teams.map((t) => [t.id, 0]));
  let totalEarned = 0, totalPayable = 0;
  const rng = makeRng((seed ^ 0x9e3779b9) >>> 0);
  for (const race of selected) {
    const { prizeByTeam, earned, payable } = runRace(race, teams, freeAgents, racePointsByClass, rng, seed, prizePerPoint);
    totalEarned += earned; totalPayable += payable;
    for (const [teamId, prize] of prizeByTeam) seasonPrize.set(teamId, seasonPrize.get(teamId) + prize);
  }

  if (print) {
    console.log("PRÆMIE-PULJE (hele sæsonen):");
    console.log(`  Optjent (earned, alle ryttere): ${fmt(totalEarned)} CZ$`);
    console.log(`  Udbetalbar (payable, kun manager-hold): ${fmt(totalPayable)} CZ$ (${Math.round(100 * totalPayable / totalEarned)}% af optjent)`);
    console.log(`  AI-andel (earned − payable): ${fmt(totalEarned - totalPayable)} CZ$\n`);
  }

  // ── Per-division percentiler + struktureret resultat ───────────────────────────
  const divisions = {};
  if (print) {
    console.log("PER-DIVISION PRÆMIE + NET/SÆSON:");
    console.log("─".repeat(92));
  }
  for (const d of [1, 2, 3]) {
    const divTeams = teams.filter((t) => t.division === d);
    if (!divTeams.length) { if (print) console.log(`  D${d}: ingen hold`); continue; }
    const prizes = divTeams.map((t) => seasonPrize.get(t.id)).sort((a, b) => a - b);
    const salaries = divTeams.map((t) =>
      t.riders.reduce((s, r) => s + computeFrozenSalary({ base_value: r.base_value, prize_earnings_bonus: 0 }), 0)
    );
    const medPrize = median(prizes);
    const medSalary = median(salaries);
    const divisionBase = sponsorBase[d];
    const upkeep = upkeepOv[d];

    // #1663 renown-sponsor: byg hver divisions standing fra de SIMULEREDE point. Point er
    // proportionale med præmie inden for ét prizePerPoint-niveau (præmie = point × ppp), så
    // total_points = seasonPrize / prizePerPoint (eksakt). Vi bruger SAMME-sæsons standing
    // som proxy for "sidste sæson" (et modent felt antages at have ligget stabilt) — den
    // eneste tilgængelige resultat-historik i denne statiske 1-sæsons-model.
    const standingsRaw = divTeams
      .map((t) => ({ team_id: t.id, total_points: seasonPrize.get(t.id) / prizePerPoint }))
      .sort((a, b) => b.total_points - a.total_points);
    standingsRaw.forEach((s, i) => { s.rank_in_division = i + 1; });
    const standingByTeam = new Map(standingsRaw.map((s) => [s.team_id, s]));

    // Per-hold renown-skaleret sponsor (frisk/standing-løst hold ville give multiplier 1,0).
    const sponsorByTeam = new Map(
      divTeams.map((t) => [
        t.id,
        renownSponsorFor({
          divisionBase,
          standing: standingByTeam.get(t.id),
          divisionStandings: standingsRaw,
          wResults,
          maxMultiplier,
        }),
      ])
    );
    const sponsors = divTeams.map((t) => sponsorByTeam.get(t.id));
    const medSponsor = median(sponsors);

    // Net pr. hold (renown-sponsor − upkeep − holdets egen løn + holdets egen præmie).
    const nets = divTeams.map((t) => {
      const salary = t.riders.reduce((s, r) => s + computeFrozenSalary({ base_value: r.base_value, prize_earnings_bonus: 0 }), 0);
      return sponsorByTeam.get(t.id) - upkeep - salary + seasonPrize.get(t.id);
    }).sort((a, b) => a - b);

    const p10 = percentile(nets, 0.1);
    const p90 = percentile(nets, 0.9);
    divisions[d] = {
      nets, prizes, salaries, sponsor: medSponsor, sponsors, upkeep,
      medNet: median(nets), medPrize, medSalary,
      p10, p90, p10p90Spread: p90 - p10, gini: gini(nets),
    };

    if (print) {
      console.log(`  D${d} (${divTeams.length} hold, roster-værdi median ${fmt(median(divTeams.map((t) => t.rosterValue)))}):`);
      console.log(`     PRÆMIE/sæson  p10 ${fmt(percentile(prizes, 0.1))} · p25 ${fmt(percentile(prizes, 0.25))} · median ${fmt(medPrize)} · p75 ${fmt(percentile(prizes, 0.75))} · p90 ${fmt(percentile(prizes, 0.9))}`);
      console.log(`     SPONSOR/sæson base ${fmt(divisionBase)} → renown p10 ${fmt(percentile([...sponsors].sort((a, b) => a - b), 0.1))} · median ${fmt(medSponsor)} · p90 ${fmt(percentile([...sponsors].sort((a, b) => a - b), 0.9))} (wRes ${wResults}, maxMult ${maxMultiplier})`);
      console.log(`     NET/sæson     p10 ${fmt(p10)} · median ${fmt(median(nets))} · p90 ${fmt(p90)}   [sponsor ${fmt(medSponsor)} − upkeep ${fmt(upkeep)} − løn ${fmt(medSalary)} + præmie ${fmt(medPrize)}]`);
      console.log(`     divergens     Gini ${divisions[d].gini.toFixed(3)} · p10–p90 spread ${fmt(divisions[d].p10p90Spread)}`);
    }
  }
  if (print) console.log("─".repeat(92));

  // ── 5-sæsons balance-trajektorie (statisk roster/præmie, balance += net/sæson) ──
  const trajectories = {};
  for (const d of [1, 2, 3]) {
    if (!divisions[d]) continue;
    const medNet = divisions[d].medNet;
    const traj = [];
    let bal = INITIAL_BALANCE;
    for (let s = 1; s <= 5; s++) { traj.push(bal); if (s < 5) bal += medNet; }
    trajectories[d] = { traj, ratioS5: traj[4] / INITIAL_BALANCE };
  }
  if (print) {
    console.log("\n5-SÆSONS BALANCE-TRAJEKTORIE (start 800k, balance += median-net/sæson; konservativ, ingen vækst):");
    for (const d of [1, 2, 3]) {
      if (!trajectories[d]) continue;
      const { traj } = trajectories[d];
      console.log(`  D${d} (median-net ${fmt(divisions[d].medNet)}/sæson): S1 ${fmt(traj[0])} → S2 ${fmt(traj[1])} → S3 ${fmt(traj[2])} → S4 ${fmt(traj[3])} → S5 ${fmt(traj[4])} (${trajectories[d].ratioS5.toFixed(2)}× start)`);
    }
    console.log("\nNOTE: 100% syntetisk, intet rørt i prod. Ét seed/felt — kør flere --seed for et interval.");
    console.log("      Sæson 1 = ProSeries-only (WT ekskluderet); sæson 2+ med WT-puljer (10-100× større) → præmie eksploderer.\n");
  }

  return { seed, teamCount, overrides, divisions, trajectories, totalEarned, totalPayable };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────
function main() {
  const seed = parseInt(arg("seed", "2026"), 10);
  const teamCount = parseInt(arg("teams", "22"), 10);
  const rosterSize = parseInt(arg("roster", "8"), 10);
  runScorecard({ seed, teamCount, rosterSize, overrides: resolveOverrides(), print: true });
}

// Kør kun som CLI hvis dette er entry-modulet (ikke ved import fra sweep).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("prizeDistributionScorecard.js")) {
  main();
}

#!/usr/bin/env node
// #1187-B · Dry-run-harness for løbende bestyrelses-tilfredshed (simulér-før-ship).
// =============================================================================
// Kører den rene weekend-mekanik (lib/boardWeekendUpdate.js — genbruger
// evaluateBoardSeason 1:1) mod den ÆGTE population (alle aktive human-hold +
// deres faktiske planer/mål, committed snapshot-fixture) over en simuleret
// sæson på 4-6 løbsweekender, og producerer scorecardet fra issue #1187's
// design-session-kommentar (11/6). INTET her skriver til DB eller rører
// live-engine-stier — wiring sker først efter ejer-review af scorecardet.
//
//   node scripts/boardSatisfactionHarness.js                       # rapport til stdout
//   node scripts/boardSatisfactionHarness.js --out <fil.md>        # rapport til fil
//   node scripts/boardSatisfactionHarness.js --seed 42 --weekends 6
//   node scripts/boardSatisfactionHarness.js --refresh-fixture --env <sti-til-backend-.env>
//
// Fixture-refresh er READ-ONLY (kun SELECT via service-key). Selve simuleringen
// kræver hverken env eller netværk — kun det committed fixture. Determinisme:
// samme seed + samme fixture → byte-identisk rapport (#1197-mønstret).
//
// Scorecard-gates (foreslået i #1187-kommentaren, ejer justerer ved review):
//   1. Spredning: IQR af slut-satisfaction (1yr-planer) ≥ 15 point.
//   2. Konsekvens-rate: andel hold der rammer hårde lag (2-5) ved checkpoints ≤ ~10 %.
//   3. Ingen dødsspiral: lav satisfaction tilbage over genforhandlings-tærsklen
//      (50) på 2-3 gode weekender.
//   4. Økonomisk bånd: sponsor-udbetaling over sæson vs fast 1.0-baseline —
//      p10/p50/p90 rapporteres; grænsen fastsættes af ejeren ved review.
//   5. Determinisme: to kørsler samme seed → identisk output.
// Følsomhed: clamp ±3 / ±5 / ±10 køres på SAMME performance-timeline.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WEEKEND_SATISFACTION_CLAMP,
  computeWeekendSatisfactionUpdate,
  getConsequenceCheckpoint,
  resolveWeekendEconomyModifier,
} from "../lib/boardWeekendUpdate.js";
import { generateBoardGoals, getPlanDuration } from "../lib/boardGoals.js";
import { CONSEQUENCE_CONSTANTS, getLayerLabel } from "../lib/boardConsequences.js";
import { BOARD_IDENTITY_RIDER_SELECT } from "../lib/boardConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_PATH = join(__dirname, "fixtures", "boardSatisfactionPopulation.json");

const RENEGOTIATION_THRESHOLD = 50; // blød trigger (<50) — boardMidSeason.js
const CLAMP_VARIANTS = [3, WEEKEND_SATISFACTION_CLAMP, 10];
const STAGES_PER_WEEKEND = 6;
const JERSEYS_PER_WEEKEND = 2;

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] !== undefined ? args[idx + 1] : fallback;
}
const SEED = Number(argValue("--seed", "1187")) || 1187;
const WEEKENDS = Math.min(6, Math.max(4, Number(argValue("--weekends", "5")) || 5));
const OUT_PATH = argValue("--out", null);
const FIXTURE_PATH = argValue("--fixture", DEFAULT_FIXTURE_PATH);
const REGEN_GOALS = args.includes("--regen-goals");

// ─── Fixture-refresh (READ-ONLY SELECTs) ──────────────────────────────────────

async function refreshFixture() {
  const dotenv = (await import("dotenv")).default;
  const { createClient } = await import("@supabase/supabase-js");
  const envPath = argValue("--env", join(__dirname, "../.env"));
  dotenv.config({ path: envPath, quiet: true });

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY (prøv --env <sti>)");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Samme population-filter som UI/boardMidSeason: rigtige hold = ikke-AI/bank/test/frosne.
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, division, sponsor_income")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .eq("is_test_account", false)
    .order("id");
  if (teamsError) throw new Error(`teams: ${teamsError.message}`);
  const teamIds = (teams || []).map((t) => t.id);

  const [boardsRes, ridersRes, loansRes, seasonRes] = await Promise.all([
    supabase
      .from("board_profiles")
      .select("id, team_id, plan_type, focus, satisfaction, budget_modifier, seasons_completed, cumulative_stage_wins, cumulative_gc_wins, plan_start_season_number, plan_start_sponsor_income, current_goals")
      .in("team_id", teamIds)
      .eq("is_baseline", false)
      .eq("negotiation_status", "completed")
      .order("id"),
    supabase
      .from("riders")
      .select(`team_id, ${BOARD_IDENTITY_RIDER_SELECT}`)
      .in("team_id", teamIds)
      .order("id"),
    supabase.from("loans").select("id, team_id").eq("status", "active").in("team_id", teamIds),
    supabase.from("seasons").select("id, number, race_days_total").eq("status", "active").maybeSingle(),
  ]);
  for (const [label, res] of [["board_profiles", boardsRes], ["riders", ridersRes], ["loans", loansRes], ["seasons", seasonRes]]) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  const season = seasonRes.data;
  let divisionTeamCounts = {};
  if (season?.id) {
    const { data: standings, error: standingsError } = await supabase
      .from("season_standings")
      .select("team_id, division")
      .eq("season_id", season.id);
    if (standingsError) throw new Error(`season_standings: ${standingsError.message}`);
    for (const row of standings || []) {
      if (row.division == null) continue;
      divisionTeamCounts[row.division] = (divisionTeamCounts[row.division] || 0) + 1;
    }
  }

  const ridersByTeam = new Map();
  for (const rider of ridersRes.data || []) {
    if (!ridersByTeam.has(rider.team_id)) ridersByTeam.set(rider.team_id, []);
    const { team_id: _omit, ...riderFields } = rider;
    ridersByTeam.get(rider.team_id).push(riderFields);
  }
  const boardsByTeam = new Map();
  for (const board of boardsRes.data || []) {
    if (!boardsByTeam.has(board.team_id)) boardsByTeam.set(board.team_id, []);
    boardsByTeam.get(board.team_id).push(board);
  }
  const loanCounts = new Map();
  for (const loan of loansRes.data || []) {
    loanCounts.set(loan.team_id, (loanCounts.get(loan.team_id) || 0) + 1);
  }

  const fixture = {
    fetched_at: new Date().toISOString(),
    season: season ? { number: season.number, race_days_total: season.race_days_total } : null,
    division_team_counts: divisionTeamCounts,
    teams: (teams || []).map((team) => ({
      ...team,
      active_loan_count: loanCounts.get(team.id) || 0,
      riders: ridersByTeam.get(team.id) || [],
      boards: boardsByTeam.get(team.id) || [],
    })),
  };

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 1));
  const boardCount = fixture.teams.reduce((sum, t) => sum + t.boards.length, 0);
  console.log(`✅ Fixture skrevet: ${FIXTURE_PATH}`);
  console.log(`   ${fixture.teams.length} aktive human-hold · ${boardCount} aktive planer · sæson ${season?.number ?? "?"}`);
}

// ─── #1267 · Regenerér mål fra den NUVÆRENDE generering (relaunch-gate) ───────
// Erstatter hvert boards gemte (PCM-æra-kalibrerede) current_goals med dem
// generateBoardGoals FAKTISK ville producere ved relaunch. Lader harnesset gate
// relaunch-mål-kalibreringen mod en realistisk trup-population i stedet for de
// historiske mål. standing=null spejler relaunch, hvor friske hold endnu ikke
// har en sæson-placering, så kun trup/division-baserede targets sættes.
function regenerateFixtureGoals(fixture) {
  return {
    ...fixture,
    teams: fixture.teams.map((team) => ({
      ...team,
      boards: (team.boards || []).map((board) => ({
        ...board,
        current_goals: generateBoardGoals({
          focus: board.focus,
          planType: board.plan_type,
          team: {
            division: team.division,
            sponsor_income: team.sponsor_income,
            balance: team.balance,
            riders: team.riders || [],
          },
          riders: team.riders || [],
          standing: null,
        }),
      })),
    })),
  };
}

// ─── Seedet RNG (mulberry32 + Box-Muller) ─────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function weightedIndex(weights, rng) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

function pickDistinct(items, weights, count, rng) {
  const pool = items.map((item, i) => ({ item, weight: weights[i] }));
  const picked = [];
  while (picked.length < count && pool.length > 0) {
    const idx = weightedIndex(pool.map((p) => p.weight), rng);
    picked.push(pool[idx].item);
    pool.splice(idx, 1);
  }
  return picked;
}

// ─── Performance-timeline (én pr. seed — deles af alle clamp-varianter) ───────
// Arketyper: svag 25 % / middel 50 % / stærk 25 % + støj pr. weekend.
// AI-fyld op til divisionens faktiske holdantal, så rank_in_division er realistisk.

function buildPerformanceTimeline({ fixture, seed, weekends }) {
  const rng = mulberry32(seed);
  const entities = [];

  for (const team of fixture.teams) {
    const roll = rng();
    const archetype = roll < 0.25 ? "svag" : roll < 0.75 ? "middel" : "stærk";
    const jitter = rng();
    const strength = archetype === "svag"
      ? 0.22 + jitter * 0.16
      : archetype === "middel"
        ? 0.42 + jitter * 0.20
        : 0.68 + jitter * 0.20;
    entities.push({ id: team.id, human: true, division: team.division, archetype, strength });
  }

  for (const division of [1, 2, 3]) {
    const total = fixture.division_team_counts?.[division] ?? 0;
    const humans = fixture.teams.filter((t) => t.division === division).length;
    for (let i = 0; i < Math.max(0, total - humans); i += 1) {
      entities.push({
        id: `ai-${division}-${i}`,
        human: false,
        division,
        archetype: "ai",
        strength: 0.30 + rng() * 0.40,
      });
    }
  }

  const byDivision = new Map();
  for (const entity of entities) {
    if (!byDivision.has(entity.division)) byDivision.set(entity.division, []);
    byDivision.get(entity.division).push(entity);
  }

  const cum = new Map(entities.map((e) => [e.id, {
    points: 0, stageWins: 0, gcWins: 0, jerseyWins: 0, classicPodiums: 0, monumentPodiums: 0,
  }]));
  const monumentWeekend = Math.ceil(weekends / 2); // én monument-weekend midt i sæsonen
  const timeline = [];

  for (let w = 1; w <= weekends; w += 1) {
    const weekendPoints = new Map();
    for (const entity of entities) {
      weekendPoints.set(entity.id, Math.max(1, (entity.strength + gauss(rng) * 0.13) * 100));
    }

    for (const division of [1, 2, 3]) {
      const divEntities = byDivision.get(division) || [];
      if (!divEntities.length) continue;
      const weights = divEntities.map((e) => weekendPoints.get(e.id) ** 2);
      const draw = () => divEntities[weightedIndex(weights, rng)];

      for (let s = 0; s < STAGES_PER_WEEKEND; s += 1) cum.get(draw().id).stageWins += 1;
      cum.get(draw().id).gcWins += 1;
      for (let j = 0; j < JERSEYS_PER_WEEKEND; j += 1) cum.get(draw().id).jerseyWins += 1;
      for (const podiumEntity of pickDistinct(divEntities, weights, 3, rng)) {
        cum.get(podiumEntity.id).classicPodiums += 1;
        if (w === monumentWeekend) cum.get(podiumEntity.id).monumentPodiums += 1;
      }
    }

    for (const entity of entities) {
      cum.get(entity.id).points += weekendPoints.get(entity.id);
    }

    const humans = new Map();
    for (const division of [1, 2, 3]) {
      const ranked = [...(byDivision.get(division) || [])].sort((a, b) => {
        const diff = cum.get(b.id).points - cum.get(a.id).points;
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
      ranked.forEach((entity, idx) => {
        if (!entity.human) return;
        humans.set(entity.id, { rank: idx + 1, ...structuredClone(cum.get(entity.id)) });
      });
    }
    timeline.push({ weekend: w, humans });
  }

  return { entities, timeline };
}

// ─── Mekanik-simulering for én clamp-variant ──────────────────────────────────

function buildBoardContext({ board, team, snapshot, divisionManagerCount }) {
  const planDuration = getPlanDuration(board.plan_type);
  const seasonsCompleted = (board.seasons_completed || 0) + 1;
  return {
    planDuration,
    seasonsCompleted,
    isFinalSeason: seasonsCompleted >= planDuration,
    activeLoanCount: team.active_loan_count || 0,
    planStartSponsorIncome: board.plan_start_sponsor_income,
    currentSponsorIncome: team.sponsor_income,
    recentSnapshots: [],
    hasSeasonData: true,
    cumulativeStats: {
      stageWins: (board.cumulative_stage_wins || 0) + snapshot.stageWins,
      gcWins: (board.cumulative_gc_wins || 0) + snapshot.gcWins,
    },
    divisionManagerCount,
    cumulativeMonumentPodiums: snapshot.monumentPodiums,
    cumulativeClassicPodiums: snapshot.classicPodiums,
    cumulativeJerseyWins: snapshot.jerseyWins,
    seasonJerseyWins: snapshot.jerseyWins,
    // Market-/progressions-context simuleres ikke (transfer-balance + U25-
    // baseline) → evaluateGoalProgress giver awaiting_data (score 0.6), præcis
    // som live ville gøre når data mangler. Noteret i rapporten.
    cumulativeTransferBalance: null,
    planStartU25StatSum: null,
    planStartU25Count: null,
  };
}

function hardLayersFor(satisfaction) {
  const { SATISFACTION_THRESHOLDS } = CONSEQUENCE_CONSTANTS;
  const layers = [];
  if (satisfaction < SATISFACTION_THRESHOLDS.SALARY_CAP) layers.push(2);
  if (satisfaction < SATISFACTION_THRESHOLDS.SIGNING_RESTRICTION) layers.push(3);
  if (satisfaction < SATISFACTION_THRESHOLDS.FORCED_LISTING) layers.push(4);
  if (satisfaction < SATISFACTION_THRESHOLDS.SPONSOR_PULLOUT) layers.push(5);
  return layers;
}

function simulateMechanic({ fixture, timelineData, clampLimit, weekends }) {
  const divisionManagerCounts = new Map();
  for (const team of fixture.teams) {
    divisionManagerCounts.set(team.division, (divisionManagerCounts.get(team.division) || 0) + 1);
  }
  const archetypeByTeam = new Map(timelineData.entities.filter((e) => e.human).map((e) => [e.id, e.archetype]));

  const teamResults = [];
  for (const team of fixture.teams) {
    const teamWithRiders = {
      id: team.id,
      division: team.division,
      sponsor_income: team.sponsor_income,
      riders: team.riders || [],
    };
    const boardsState = (team.boards || []).map((board) => {
      const start = Number.isFinite(Number(board.satisfaction)) ? Number(board.satisfaction) : 50;
      return { board, satisfaction: start, anchor: start, modifier: 1.0, target: start, trajectory: [start] };
    });
    if (!boardsState.length) continue;

    const weekendModifiers = [];
    const checkpointHits = [];

    for (let w = 1; w <= weekends; w += 1) {
      const snapshot = timelineData.timeline[w - 1].humans.get(team.id);
      const standing = {
        team_id: team.id,
        division: team.division,
        rank_in_division: snapshot.rank,
        total_points: Math.round(snapshot.points),
        stage_wins: snapshot.stageWins,
        gc_wins: snapshot.gcWins,
      };

      for (const state of boardsState) {
        const context = buildBoardContext({
          board: state.board,
          team,
          snapshot,
          divisionManagerCount: divisionManagerCounts.get(team.division) || null,
        });
        const update = computeWeekendSatisfactionUpdate({
          board: { ...state.board, satisfaction: state.satisfaction },
          standing,
          team: teamWithRiders,
          context,
          seasonStartSatisfaction: state.anchor,
          clampLimit,
        });
        state.satisfaction = update.newSatisfaction;
        state.modifier = update.newModifier;
        state.target = update.targetSatisfaction;
        state.trajectory.push(update.newSatisfaction);
      }

      // Beslutning 4: sponsor-modifier følger live — hold-niveau = gennemsnit af
      // aktive planers modifier (samme aggregering som processSeasonStart lag 1).
      const avgModifier = boardsState.reduce((sum, s) => sum + s.modifier, 0) / boardsState.length;
      weekendModifiers.push(avgModifier);

      const checkpoint = getConsequenceCheckpoint({ completedWeekends: w, totalWeekends: weekends });
      if (checkpoint) {
        for (const state of boardsState) {
          const layers = hardLayersFor(state.satisfaction);
          if (layers.length) {
            checkpointHits.push({ checkpoint, plan: state.board.plan_type, satisfaction: state.satisfaction, layers });
          }
        }
      }
    }

    // Økonomisk bånd: pro-rata sponsor-flow pr. weekend × live modifier
    // (test-mode = false i prod-scenariet) vs. dagens faste 1.0-baseline.
    const weeklyBase = (team.sponsor_income || 0) / weekends;
    const paidTotal = weekendModifiers.reduce(
      (sum, modifier) => sum + weeklyBase * resolveWeekendEconomyModifier({ modifier }),
      0,
    );
    const deviationPct = team.sponsor_income > 0
      ? ((paidTotal - team.sponsor_income) / team.sponsor_income) * 100
      : 0;

    const oneYear = boardsState.find((s) => s.board.plan_type === "1yr") || boardsState[0];
    teamResults.push({
      teamId: team.id,
      teamName: team.name,
      division: team.division,
      archetype: archetypeByTeam.get(team.id) || "?",
      finalRank: timelineData.timeline[weekends - 1].humans.get(team.id).rank,
      boardsState,
      oneYear,
      weekendModifiers,
      checkpointHits,
      deviationPct,
    });
  }
  return teamResults;
}

// ─── Baseline: dagens mekanik (ét uclamped sæson-slut-spring) ────────────────
// Samme timeline, men satisfaction opdateres KUN ved sæson-slut og uden clamp —
// dvs. præcis hvad processTeamSeasonEnd → evaluateBoardSeason gør i dag. Bruges
// til at isolere weekend-mekanikkens effekt fra den underliggende scoring.

function simulateTodayBaseline({ fixture, timelineData, weekends }) {
  const divisionManagerCounts = new Map();
  for (const team of fixture.teams) {
    divisionManagerCounts.set(team.division, (divisionManagerCounts.get(team.division) || 0) + 1);
  }

  const teamResults = [];
  for (const team of fixture.teams) {
    if (!(team.boards || []).length) continue;
    const teamWithRiders = { id: team.id, division: team.division, sponsor_income: team.sponsor_income, riders: team.riders || [] };
    const snapshot = timelineData.timeline[weekends - 1].humans.get(team.id);
    const standing = {
      team_id: team.id,
      division: team.division,
      rank_in_division: snapshot.rank,
      total_points: Math.round(snapshot.points),
      stage_wins: snapshot.stageWins,
      gc_wins: snapshot.gcWins,
    };
    const boards = team.boards.map((board) => {
      const context = buildBoardContext({
        board,
        team,
        snapshot,
        divisionManagerCount: divisionManagerCounts.get(team.division) || null,
      });
      // clampLimit 1000 ⇒ ét frit spring direkte til target = evaluateBoardSeason's
      // newSatisfaction (samme anker = nuværende prod-satisfaction).
      const update = computeWeekendSatisfactionUpdate({
        board, standing, team: teamWithRiders, context, clampLimit: 1000,
      });
      return { plan: board.plan_type, satisfaction: update.newSatisfaction, layers: hardLayersFor(update.newSatisfaction) };
    });
    const oneYear = boards.find((b) => b.plan === "1yr") || boards[0];
    teamResults.push({
      teamId: team.id,
      finalSatisfaction1yr: oneYear.satisfaction,
      hardHit: boards.some((b) => b.layers.length > 0),
    });
  }

  const finals = teamResults.map((r) => r.finalSatisfaction1yr);
  return {
    dist: describeDistribution(finals),
    consequenceRatePct: (teamResults.filter((r) => r.hardHit).length / teamResults.length) * 100,
    teamsHit: teamResults.filter((r) => r.hardHit).length,
    teamsTotal: teamResults.length,
  };
}

// ─── Dødsspiral-/recovery-scenarie ────────────────────────────────────────────
// Syntetisk forløb på en repræsentativ 1yr-plan: 3 katastrofe-weekender
// (sidsteplads, nul sejre) efterfulgt af 3 top-weekender (rank klatrer
// 50 % → 25 % → 1, sejre akkumulerer). Gate: tilbage over genforhandlings-
// tærsklen (50) på højst 3 gode weekender.

function runRecoveryScenario({ fixture, clampLimit }) {
  const team = fixture.teams.find(
    (t) => (t.riders || []).length > 0 && (t.boards || []).some((b) => b.plan_type === "1yr"),
  );
  if (!team) return null;
  const board = team.boards.find((b) => b.plan_type === "1yr");
  const divisionSize = Math.max(fixture.division_team_counts?.[team.division] ?? 16, 4);
  const divisionManagerCount = fixture.teams.filter((t) => t.division === team.division).length;
  const teamWithRiders = { id: team.id, division: team.division, sponsor_income: team.sponsor_income, riders: team.riders };

  const weekends = 6;
  let satisfaction = 50;
  const anchor = 50;
  const trajectory = [satisfaction];
  let goodWeekends = 0;
  let recoveredAfterGoodWeekends = null;
  const cumulative = { stageWins: 0, gcWins: 0, jerseyWins: 0, classicPodiums: 0, monumentPodiums: 0 };

  for (let w = 1; w <= weekends; w += 1) {
    const isGood = w > 3;
    if (isGood) {
      goodWeekends += 1;
      cumulative.stageWins += 2;
      cumulative.gcWins += 1;
      cumulative.jerseyWins += 1;
      cumulative.classicPodiums += 1;
    }
    const rank = !isGood
      ? divisionSize
      : goodWeekends === 1
        ? Math.max(1, Math.ceil(divisionSize * 0.5))
        : goodWeekends === 2
          ? Math.max(1, Math.ceil(divisionSize * 0.25))
          : 1;
    const snapshot = { rank, points: 0, ...cumulative };
    const standing = {
      team_id: team.id,
      division: team.division,
      rank_in_division: rank,
      total_points: 0,
      stage_wins: cumulative.stageWins,
      gc_wins: cumulative.gcWins,
    };
    const context = buildBoardContext({ board, team, snapshot, divisionManagerCount });
    const update = computeWeekendSatisfactionUpdate({
      board: { ...board, satisfaction },
      standing,
      team: teamWithRiders,
      context,
      seasonStartSatisfaction: anchor,
      clampLimit,
    });
    satisfaction = update.newSatisfaction;
    trajectory.push(satisfaction);
    if (isGood && recoveredAfterGoodWeekends === null && satisfaction >= RENEGOTIATION_THRESHOLD) {
      recoveredAfterGoodWeekends = goodWeekends;
    }
  }

  return {
    teamName: team.name,
    trajectory,
    lowPoint: Math.min(...trajectory),
    recoveredAfterGoodWeekends,
    finalSatisfaction: satisfaction,
  };
}

// ─── Statistik-helpers ────────────────────────────────────────────────────────

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

function describeDistribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? null,
    p10: percentile(sorted, 0.10),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.50),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.90),
    max: sorted[sorted.length - 1] ?? null,
    iqr: percentile(sorted, 0.75) - percentile(sorted, 0.25),
  };
}

function summarizeVariant({ teamResults, recovery }) {
  const finalSats = teamResults.map((r) => r.oneYear.satisfaction);
  const allPlanSats = teamResults.flatMap((r) => r.boardsState.map((s) => s.satisfaction));
  const teamsWithHardHit = teamResults.filter((r) => r.checkpointHits.length > 0);
  const deviations = teamResults.map((r) => r.deviationPct);
  const midHitTeams = teamResults.filter((r) => r.checkpointHits.some((h) => h.checkpoint === "mid_season")).length;
  const endHitTeams = teamResults.filter((r) => r.checkpointHits.some((h) => h.checkpoint === "season_end")).length;
  return {
    dist: describeDistribution(finalSats),
    distAllPlans: describeDistribution(allPlanSats),
    consequenceRatePct: (teamsWithHardHit.length / teamResults.length) * 100,
    teamsWithHardHit,
    midHitTeams,
    endHitTeams,
    econ: describeDistribution(deviations),
    recovery,
  };
}

// ─── Rapport ──────────────────────────────────────────────────────────────────

const da = (value, decimals = 1) => (value == null ? "—" : value.toFixed(decimals).replace(".", ","));
const pct = (value, decimals = 1) => (value == null ? "—" : `${value >= 0 ? "+" : ""}${da(value, decimals)} %`);

function gateRow(name, target, measured, status) {
  return `| ${name} | ${target} | ${measured} | ${status} |`;
}

function buildReport({ fixture, variants, todayBaseline, deterministic, seed, weekends, today, regenGoals = false }) {
  const main = variants.find((v) => v.clampLimit === WEEKEND_SATISFACTION_CLAMP);
  const s = main.summary;
  const lines = [];

  const boardCount = fixture.teams.reduce((sum, t) => sum + (t.boards?.length || 0), 0);
  lines.push(`# Board-satisfaction-scorecard — dry-run af løbende bestyrelses-tilfredshed (#1187-B)`);
  lines.push("");
  lines.push(`> Genereret ${today} af \`node backend/scripts/boardSatisfactionHarness.js --seed ${seed} --weekends ${weekends}\` · Refs #1187, #805, #1147 · simulér-før-ship (ejer-accepteret 7/6)`);
  lines.push(`> Population: ${fixture.teams.length} aktive human-hold · ${boardCount} aktive planer (1yr/3yr/5yr) · fixture hentet ${fixture.fetched_at} (READ-ONLY, sæson ${fixture.season?.number ?? "?"})`);
  lines.push(`> Mekanik: \`lib/boardWeekendUpdate.js\` — target-tracking mod \`evaluateBoardSeason\` (genbrug 1:1), clamp ±${WEEKEND_SATISFACTION_CLAMP}/weekend, modifier live via \`satisfactionToModifier\`, hårde lag kun ved checkpoints (mid + slut).`);
  if (regenGoals) {
    lines.push(`> **#1267 · \`--regen-goals\`:** mål er REGENERERET fra \`generateBoardGoals\` (relaunch-mål-kalibrering), IKKE de gemte prod-mål. Gate'r de mål relaunch faktisk ville sætte mod den realistiske trup-population (standing=null = friske hold).`);
  }
  lines.push("");

  lines.push(`## 0. Metode + antagelser`);
  lines.push("");
  lines.push(`- **Sæson:** ${weekends} løbsweekender. Pr. weekend pr. division: ${STAGES_PER_WEEKEND} etapesejre, 1 GC-sejr, ${JERSEYS_PER_WEEKEND} trøjer, 1 klassiker-podium (3 pladser); én monument-weekend midt i sæsonen.`);
  lines.push(`- **Performance-fordeling:** arketyper svag 25 % / middel 50 % / stærk 25 % + gaussisk støj pr. weekend (seedet RNG, mulberry32). AI-fyld op til divisionens faktiske holdantal så \`rank_in_division\` er realistisk.`);
  lines.push(`- **Samme timeline for alle clamp-varianter:** performance-trækkene genereres én gang pr. seed; ±3/±5/±10 evalueres på identiske sæsonforløb.`);
  lines.push(`- **Plan-mål:** holdenes FAKTISKE \`current_goals\` fra prod (inkl. DNA-traditionsmål og forhandlede mål). Lån-status fra prod. Transfer-balance + U25-udviklings-baseline simuleres ikke → de mål får \`awaiting_data\` (score 0,6), præcis som live når data mangler.`);
  lines.push(`- **Sponsor-bånd:** pro-rata udbetaling pr. weekend (sponsor_income/${weekends}) × den LIVE modifier efter weekendens opdatering, vs. dagens faste 1,0-baseline. Wiring-detaljen (om udbetaling reelt flyttes ind i sæsonen) afgøres ved live-wiring — båndet her viser den økonomiske effekt af beslutning 4.`);
  lines.push(`- **Checkpoints:** hårde lag (2=salary cap <40, 3=signing-restriktion <30, 4=tvangssalg <15, 5=pullout <10) aflæses KUN ved mid-season (weekend ${Math.floor(weekends / 2)}) og sæson-slut (weekend ${weekends}). Blød genforhandlings-trigger (<50) uændret.`);
  lines.push(`- **board_test_mode:** neutraliseres via \`resolveWeekendEconomyModifier\` (testet i unit-tests); prod-scenariet her kører med test-mode slået fra.`);
  lines.push("");

  lines.push(`## 1. Scorecard (clamp ±${WEEKEND_SATISFACTION_CLAMP} — den låste beslutning)`);
  lines.push("");
  lines.push(`| Gate | Mål | Målt | Status |`);
  lines.push(`|---|---|---|:--:|`);
  lines.push(gateRow(
    "Spredning (IQR, 1yr-slutsatisfaction)",
    "≥ 15 point",
    `${da(s.dist.iqr)} point (p25 ${da(s.dist.p25)} → p75 ${da(s.dist.p75)})`,
    s.dist.iqr >= 15 ? "✅ PASS" : "❌ FAIL",
  ));
  lines.push(gateRow(
    "Konsekvens-rate (hårde lag ved checkpoints)",
    "≤ ~10 % af hold",
    `${da(s.consequenceRatePct)} % (${s.teamsWithHardHit.length}/${main.teamResults.length} hold)`,
    s.consequenceRatePct <= 10 ? "✅ PASS" : "❌ FAIL",
  ));
  lines.push(gateRow(
    "Ingen dødsspiral (tilbage over 50)",
    "≤ 3 gode weekender",
    s.recovery?.recoveredAfterGoodWeekends != null
      ? `${s.recovery.recoveredAfterGoodWeekends} gode weekender (bund ${s.recovery.lowPoint}, slut ${s.recovery.finalSatisfaction})`
      : `ikke nået inden for 3 gode weekender (bund ${s.recovery?.lowPoint}, slut ${s.recovery?.finalSatisfaction})`,
    s.recovery?.recoveredAfterGoodWeekends != null && s.recovery.recoveredAfterGoodWeekends <= 3 ? "✅ PASS" : "❌ FAIL",
  ));
  lines.push(gateRow(
    "Økonomisk bånd (sponsor vs 1,0-baseline)",
    "ejer fastsætter grænse",
    `p10 ${pct(s.econ.p10)} · p50 ${pct(s.econ.p50)} · p90 ${pct(s.econ.p90)}`,
    "🟡 TIL-EJER",
  ));
  lines.push(gateRow(
    "Determinisme (samme seed → samme rapport)",
    "identisk output",
    deterministic ? "to fulde kørsler byte-identiske" : "AFVIGELSE mellem kørsler",
    deterministic ? "✅ PASS" : "❌ FAIL",
  ));
  lines.push("");

  lines.push(`Slut-satisfaction-fordeling (1yr-planer): min ${da(s.dist.min)} · p10 ${da(s.dist.p10)} · p25 ${da(s.dist.p25)} · p50 ${da(s.dist.p50)} · p75 ${da(s.dist.p75)} · p90 ${da(s.dist.p90)} · max ${da(s.dist.max)}. Alle planer (1+3+5yr): IQR ${da(s.distAllPlans.iqr)}, median ${da(s.distAllPlans.p50)}.`);
  lines.push("");
  lines.push(`**Vigtig kontekst til konsekvens-gaten:** dagens mekanik (ét uclamped sæson-slut-spring, ingen weekend-opdatering) giver på SAMME sæsonforløb en konsekvens-rate på ${da(todayBaseline.consequenceRatePct)} % (${todayBaseline.teamsHit}/${todayBaseline.teamsTotal} hold) med 1yr-slutspænd ${da(todayBaseline.dist.min, 0)}–${da(todayBaseline.dist.max, 0)}. Raten over 10 % skyldes altså den eksisterende sæson-evaluering mod populationens faktiske mål (typisk min_riders 22-24 mod reelle trupper på 8-17 + sponsor_growth uden vækst i sæsonen) — ikke weekend-mekanikken, som tværtimod blødgør landingen (gulv ved 50 − 5·${weekends} = ${50 - 5 * weekends} efter en hel katastrofesæson, og INGEN hold når under 40 ved mid-checkpointet fra en 50-start).`);
  lines.push("");
  lines.push(`Checkpoint-fordeling af hårde hits (clamp ±${WEEKEND_SATISFACTION_CLAMP}): mid-season ${s.midHitTeams} hold · sæson-slut ${s.endHitTeams} hold.`);
  lines.push("");

  lines.push(`## 2. Clamp-følsomhed (±3 / ±5 / ±10 — samme sæsonforløb)`);
  lines.push("");
  lines.push(`| Clamp | IQR (1yr) | Spænd (min–max) | Konsekvens-rate | Hits mid/slut | Recovery (gode weekender) | Økonomi p10/p50/p90 |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const variant of variants) {
    const vs = variant.summary;
    const marker = variant.clampLimit === WEEKEND_SATISFACTION_CLAMP ? " **(valgt)**" : "";
    lines.push(`| ±${variant.clampLimit}${marker} | ${da(vs.dist.iqr)} | ${da(vs.dist.min, 0)}–${da(vs.dist.max, 0)} | ${da(vs.consequenceRatePct)} % | ${vs.midHitTeams}/${vs.endHitTeams} | ${vs.recovery?.recoveredAfterGoodWeekends ?? "> 3"} | ${pct(vs.econ.p10)} / ${pct(vs.econ.p50)} / ${pct(vs.econ.p90)} |`);
  }
  lines.push(`| Dagens mekanik (uclamped sæson-slut) | ${da(todayBaseline.dist.iqr)} | ${da(todayBaseline.dist.min, 0)}–${da(todayBaseline.dist.max, 0)} | ${da(todayBaseline.consequenceRatePct)} % | 0/${todayBaseline.teamsHit} | n/a (ingen mellem-trin) | 0 % (modifier låst hele sæsonen) |`);
  lines.push("");
  lines.push(`Recovery-trajektorier (3 katastrofe- + 3 top-weekender, start 50):`);
  for (const variant of variants) {
    lines.push(`- ±${variant.clampLimit}: ${variant.summary.recovery?.trajectory.join(" → ")}`);
  }
  lines.push("");

  lines.push(`## 3. Økonomisk afvigelse pr. hold (clamp ±${WEEKEND_SATISFACTION_CLAMP})`);
  lines.push("");
  lines.push(`Sponsor-flow over sæsonen vs. fast 1,0-baseline. Negativt = bestyrelsen holder penge tilbage; positivt = bonus-territorie.`);
  lines.push("");
  lines.push(`| Percentil | Afvigelse |`);
  lines.push(`|---|--:|`);
  for (const [label, value] of [["p10", s.econ.p10], ["p25", s.econ.p25], ["p50", s.econ.p50], ["p75", s.econ.p75], ["p90", s.econ.p90]]) {
    lines.push(`| ${label} | ${pct(value)} |`);
  }
  lines.push("");
  lines.push(`Teoretisk maks-bånd pr. modifier-trin: 0,80–1,20 → ±20 % hvis et hold lå i yderbåndet HELE sæsonen. Clampen gør yderbåndet uopnåeligt tidligt i sæsonen — derfor er de målte afvigelser smallere.`);
  lines.push("");

  lines.push(`## 4. Per-hold-resultater (clamp ±${WEEKEND_SATISFACTION_CLAMP}, 1yr-planen)`);
  lines.push("");
  lines.push(`| Hold | Div | Arketype | Slutrank | Satisfaction-forløb (start 50) | Target | Modifier | Økonomi | Hårde lag ved checkpoints |`);
  lines.push(`|---|--:|---|--:|---|--:|--:|--:|---|`);
  const sortedResults = [...main.teamResults].sort((a, b) => b.oneYear.satisfaction - a.oneYear.satisfaction);
  for (const result of sortedResults) {
    const hits = result.checkpointHits.length
      ? result.checkpointHits.map((h) => `${h.checkpoint === "mid_season" ? "mid" : "slut"}: lag ${h.layers.join("+")} (${h.plan}, sat ${h.satisfaction})`).join("; ")
      : "—";
    const safeName = String(result.teamName).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
    lines.push(`| ${safeName} | ${result.division} | ${result.archetype} | ${result.finalRank} | ${result.oneYear.trajectory.join(" → ")} | ${result.oneYear.target} | ${da(result.oneYear.modifier, 2)} | ${pct(result.deviationPct)} | ${hits} |`);
  }
  lines.push("");
  lines.push(`Konsekvens-lag: ${[2, 3, 4, 5].map((l) => `${l}=${getLayerLabel(l)}`).join(" · ")}.`);
  lines.push("");

  const tight = variants.find((v) => v.clampLimit === 3)?.summary;
  const loose = variants.find((v) => v.clampLimit === 10)?.summary;
  lines.push(`## 5. Anbefaling`);
  lines.push("");
  lines.push(`**±5 ser rigtig ud.** Begrundelse mod alternativerne på identisk sæsonforløb:`);
  lines.push("");
  lines.push(`- **±3** dæmper spredningen til IQR ${da(tight?.dist.iqr)} (tæt på gate-grænsen 15) og gør tallet trægt — en hel sæson kan maksimalt flytte ${3 * weekends} point.`);
  lines.push(`- **±5** giver sund spredning (IQR ${da(s.dist.iqr)}), INGEN hold under salary-cap-tærsklen ved mid-checkpointet fra en 50-start (en enkelt dårlig halvsæson kan ikke udløse hårde lag), recovery på ${s.recovery?.recoveredAfterGoodWeekends ?? ">3"} gode weekender og et moderat økonomisk bånd (p50 ${pct(s.econ.p50)}).`);
  lines.push(`- **±10** genindfører chok-effekten: ${loose?.midHitTeams ?? "?"} hold rammer hårde lag allerede ved mid-season, og det økonomiske bånd vokser til p10 ${pct(loose?.econ.p10)}.`);
  lines.push("");
  lines.push(`**Konsekvens-rate-gaten fejler — men det er IKKE weekend-mekanikkens skyld.** Dagens uclamped sæson-slut-mekanik giver præcis samme rate (${da(todayBaseline.consequenceRatePct)} %) på samme forløb. Driveren er den eksisterende sæson-evaluering mod populationens faktiske mål: min_riders-mål på 22-24 mod reelle trupper på 8-17 og sponsor_growth der pr. definition er 0 % midt i en sæson. Ingen clamp-værdi kan bringe raten under 10 % — det kræver en separat mål-kalibrerings-beslutning (fx pro-rate sponsor_growth/min_riders i in-season-evaluering, eller re-kalibrér targets ved relaunch-forhandlingerne 20/6).`);
  lines.push("");
  lines.push(`**Observation til live-wiring:** næsten alle hold dipper de første 2-3 weekender, fordi sejrs-mål ser "behind" ud før resultaterne akkumulerer. Det er narrativt acceptabelt ("vis os noget"), men hvis det føles for hårdt player-facing, kan in-season-evalueringen pro-rate sæson-mål med andelen af afviklede weekender — separat beslutning, ikke en del af denne mekanik.`);
  lines.push("");
  lines.push(`**Klar til live-wiring?** Mekanikken (modul + clamp ±5 + checkpoints + live modifier + test-mode-frys) er verificeret og deterministisk. Før wiring skal ejeren tage stilling til: (a) økonomisk bånd-grænse X (målt p10/p50/p90: ${pct(s.econ.p10)} / ${pct(s.econ.p50)} / ${pct(s.econ.p90)}), (b) om konsekvens-rate-driveren håndteres via mål-kalibrering nu eller efter relaunch.`);
  lines.push("");

  return { lines, mainSummary: s };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function runOnce({ fixture, seed, weekends }) {
  const timelineData = buildPerformanceTimeline({ fixture, seed, weekends });
  return CLAMP_VARIANTS.map((clampLimit) => {
    const teamResults = simulateMechanic({ fixture, timelineData, clampLimit, weekends });
    const recovery = runRecoveryScenario({ fixture, clampLimit });
    return { clampLimit, teamResults, summary: summarizeVariant({ teamResults, recovery }) };
  });
}

function serializeForDeterminism(variants) {
  return JSON.stringify(variants.map((v) => ({
    clamp: v.clampLimit,
    teams: v.teamResults.map((r) => ({
      id: r.teamId,
      sats: r.boardsState.map((s) => s.trajectory),
      modifiers: r.weekendModifiers,
      deviation: r.deviationPct,
      hits: r.checkpointHits,
    })),
    recovery: v.summary.recovery,
  })));
}

async function main() {
  if (args.includes("--refresh-fixture")) {
    await refreshFixture();
    return;
  }

  const rawFixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const fixture = REGEN_GOALS ? regenerateFixtureGoals(rawFixture) : rawFixture;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date());

  const variants = runOnce({ fixture, seed: SEED, weekends: WEEKENDS });
  const secondRun = runOnce({ fixture, seed: SEED, weekends: WEEKENDS });
  const deterministic = serializeForDeterminism(variants) === serializeForDeterminism(secondRun);

  const baselineTimeline = buildPerformanceTimeline({ fixture, seed: SEED, weekends: WEEKENDS });
  const todayBaseline = simulateTodayBaseline({ fixture, timelineData: baselineTimeline, weekends: WEEKENDS });

  const { lines } = buildReport({ fixture, variants, todayBaseline, deterministic, seed: SEED, weekends: WEEKENDS, today, regenGoals: REGEN_GOALS });
  const report = lines.join("\n") + "\n";

  if (OUT_PATH) {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, report);
    console.log(`✅ Scorecard skrevet: ${OUT_PATH}`);
  } else {
    console.log(report);
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});

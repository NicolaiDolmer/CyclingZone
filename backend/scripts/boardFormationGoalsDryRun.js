#!/usr/bin/env node
// #2022 fase 2 · Dry-run for board-mål-kalibrering VED DANNELSE (simulér-før-ship).
// =============================================================================
// Komplementerer boardSatisfactionHarness.js: den harness simulerer satisfaction-
// MEKANIKKEN mod completed boards; DETTE script gater den FORMATIONS-mål-
// kalibrering #2022 fase 2 indfører — dvs. forskellen mellem de STATISKE fallback-
// mål et nyt hold får i dag (createInitialBoardProfile → generateBoardGoals UDEN
// team/riders) og de KALIBREREDE mål samme kald ville give MED team+trup-kontekst.
//
// Populationen er præcis de board-rows der lider under bug'en: de ægte humane holds
// formations-boards (negotiation_status='pending', is_baseline=false) — dem
// boardSatisfactionHarness.js's fixture filtrerer FRA (den tager kun 'completed').
// Plus ét syntetisk friskt entry-hold (div 4, 8 ryttere) for new-signup-stien.
//
//   node scripts/boardFormationGoalsDryRun.js                 # rapport til stdout
//   node scripts/boardFormationGoalsDryRun.js --out <fil.md>  # rapport til fil
//   node scripts/boardFormationGoalsDryRun.js --env <sti>     # alt. .env-sti
//
// READ-ONLY: kun SELECT via service-key. Skriver INTET til DB. Ingen secrets
// printes. Selve kalibreringen + backfill af de eksisterende pending-boards sker
// først efter ejer-review af denne rapport.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateBoardGoals } from "../lib/boardGoals.js";
import { evaluateBoardSeason } from "../lib/boardEvaluation.js";
import { BOARD_IDENTITY_RIDER_SELECT } from "../lib/boardConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] !== undefined ? args[idx + 1] : fallback;
}
const OUT_PATH = argValue("--out", null);

// ─── Read-only datahentning ────────────────────────────────────────────────────

async function fetchPopulation() {
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

  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, division, sponsor_income, balance")
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
      .select("id, team_id, plan_type, focus, satisfaction, current_goals")
      .in("team_id", teamIds)
      .eq("is_baseline", false)
      .eq("negotiation_status", "pending"),
    supabase.from("riders").select(`team_id, ${BOARD_IDENTITY_RIDER_SELECT}`).in("team_id", teamIds),
    supabase.from("loans").select("team_id").eq("status", "active").in("team_id", teamIds),
    supabase.from("seasons").select("id, number").eq("status", "active").maybeSingle(),
  ]);
  for (const [label, res] of [["board_profiles", boardsRes], ["riders", ridersRes], ["loans", loansRes], ["seasons", seasonRes]]) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  // Divisions-størrelse (inkl. AI-fyld) til results-gulv + relative_rank.
  let divisionTeamCounts = {};
  let divisionManagerCounts = {};
  if (seasonRes.data?.id) {
    const { data: standings, error: stErr } = await supabase
      .from("season_standings")
      .select("team_id, division")
      .eq("season_id", seasonRes.data.id);
    if (stErr) throw new Error(`season_standings: ${stErr.message}`);
    const humanIds = new Set(teamIds);
    for (const row of standings || []) {
      if (row.division == null) continue;
      divisionTeamCounts[row.division] = (divisionTeamCounts[row.division] || 0) + 1;
      if (humanIds.has(row.team_id)) {
        divisionManagerCounts[row.division] = (divisionManagerCounts[row.division] || 0) + 1;
      }
    }
  }

  const ridersByTeam = new Map();
  for (const r of ridersRes.data || []) {
    if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
    const { team_id: _omit, ...fields } = r;
    ridersByTeam.get(r.team_id).push(fields);
  }
  const loanCounts = new Map();
  for (const l of loansRes.data || []) loanCounts.set(l.team_id, (loanCounts.get(l.team_id) || 0) + 1);
  const teamById = new Map((teams || []).map((t) => [t.id, t]));

  const pendingBoards = (boardsRes.data || []).map((board) => {
    const team = teamById.get(board.team_id);
    return {
      board,
      team: { ...team, riders: ridersByTeam.get(board.team_id) || [] },
      activeLoanCount: loanCounts.get(board.team_id) || 0,
    };
  });

  return {
    season: seasonRes.data ? { number: seasonRes.data.number } : null,
    divisionTeamCounts,
    divisionManagerCounts,
    pendingBoards,
  };
}

// ─── Syntetisk friskt entry-hold (div 4, 8 ryttere) ───────────────────────────
// New-signup-stien findes ikke i prod endnu (alle 15 pending er div 3), men det er
// den case kalibreringen primært skal beskytte: 8-rytters trup + statisk min_riders
// 15. Trup-stats er bevidst middelmådige (entry-pulje #1487); kun is_u25 + antal
// driver de mål kalibreringen rører.
function syntheticEntryTeam() {
  const nats = ["FR", "IT", "ES", "BE", "NL", "DE", "GB", "DK"];
  const riders = Array.from({ length: 8 }, (_, i) => ({
    id: 900000 + i,
    is_u25: i < 3,
    salary: 40000,
    market_value: 200000,
    uci_points: 20,
    nationality_code: nats[i],
    popularity: 30,
    stat_fl: 62, stat_bj: 60, stat_kb: 58, stat_bk: 60, stat_tt: 59, stat_bro: 58,
    stat_sp: 60, stat_acc: 60, stat_udh: 60, stat_mod: 60, stat_res: 62, stat_ftr: 60,
  }));
  return {
    board: { plan_type: "1yr", focus: "balanced", satisfaction: 50, current_goals: null },
    team: { id: "synthetic-entry", name: "(syntetisk entry-hold)", division: 4, sponsor_income: 100, balance: 0, riders },
    activeLoanCount: 0,
  };
}

// ─── Mål-formatering + diff ────────────────────────────────────────────────────

function goalKey(g) {
  return g.type === "min_national_riders" ? `min_national_riders:${g.nationality_code}` : g.type;
}
function goalLine(g) {
  return `${g.label} _(pen −${g.satisfaction_penalty})_`;
}

function diffGoals(beforeGoals, afterGoals) {
  const beforeMap = new Map(beforeGoals.map((g) => [goalKey(g), g]));
  const afterMap = new Map(afterGoals.map((g) => [goalKey(g), g]));
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];
  return keys.map((k) => {
    const b = beforeMap.get(k) || null;
    const a = afterMap.get(k) || null;
    let change = "uændret";
    if (b && !a) change = "FJERNET";
    else if (!b && a) change = "NY";
    else if (b && a && (b.target !== a.target || b.label !== a.label)) change = "ÆNDRET";
    return { key: k, before: b, after: a, change };
  });
}

// Strukturel opnåelighed for trup-afhængige mål (ingen løbsdata nødvendig).
function squadReachability(goal, team) {
  const riders = team.riders || [];
  switch (goal.type) {
    case "min_riders":
      return { actual: riders.length, target: goal.target, met: riders.length >= goal.target, kind: "ryttere" };
    case "min_u25_riders":
      return { actual: riders.filter((r) => r.is_u25).length, target: goal.target, met: riders.filter((r) => r.is_u25).length >= goal.target, kind: "U25" };
    case "min_national_riders": {
      const c = riders.filter((r) => (r.nationality_code || "").toUpperCase() === goal.nationality_code).length;
      return { actual: c, target: goal.target, met: c >= goal.target, kind: `${goal.nationality_code}-ryttere` };
    }
    case "signature_rider": {
      const c = riders.filter((r) => Number(r.popularity || 0) >= 75).length;
      return { actual: c, target: goal.target, met: c >= goal.target, kind: "omdømme≥75" };
    }
    default:
      return null;
  }
}

// ─── Satisfaction-projektion (sæson-slut, repræsentative placeringer) ──────────
// Isolerer kalibrerings-effekten: SAMME løbsforløb for før+efter, så forskellen i
// newSatisfaction skyldes alene de ændrede mål. Scenarier spænder feltet.

function projectSatisfaction({ entry, goals, scenario, divTeamCount, divManagerCount }) {
  const { team, board, activeLoanCount } = entry;
  const standing = {
    team_id: team.id,
    division: team.division,
    rank_in_division: scenario.rank,
    total_points: scenario.points,
    stage_wins: scenario.stageWins,
    gc_wins: scenario.gcWins,
  };
  const context = {
    planDuration: 1,
    seasonsCompleted: 1,
    isFinalSeason: true,
    hasSeasonData: true,
    recentSnapshots: [],
    activeLoanCount,
    divisionManagerCount: divManagerCount,
    divisionTeamCount: divTeamCount,
    cumulativeStats: { stageWins: scenario.stageWins, gcWins: scenario.gcWins },
    cumulativeMonumentPodiums: 0,
    cumulativeClassicPodiums: 0,
    cumulativeJerseyWins: 0,
    seasonJerseyWins: scenario.jerseyWins ?? 0,
  };
  const result = evaluateBoardSeason({
    board: { ...board, current_goals: goals },
    standing,
    team,
    context,
  });
  return { newSatisfaction: result.newSatisfaction, overallScore: result.overallScore, goalsMet: result.goalsMet, goalsTotal: goals.length };
}

function scenariosFor(divTeamCount) {
  const size = Math.max(divTeamCount || 16, 8);
  return [
    { key: "stærk", rank: 2, points: 900, stageWins: 2, gcWins: 0, jerseyWins: 1 },
    { key: "midt", rank: Math.round(size / 2), points: 450, stageWins: 0, gcWins: 0, jerseyWins: 0 },
    { key: "svag", rank: size - 1, points: 120, stageWins: 0, gcWins: 0, jerseyWins: 0 },
  ];
}

// ─── Rapport ───────────────────────────────────────────────────────────────────

const da = (v, d = 1) => (v == null ? "—" : Number(v).toFixed(d).replace(".", ","));

function buildReport({ population, today }) {
  const lines = [];
  const entries = [...population.pendingBoards, syntheticEntryTeam()];

  lines.push(`# Board-mål-kalibrering ved dannelse — dry-run (#2022 fase 2)`);
  lines.push("");
  lines.push(`> Genereret ${today} af \`node backend/scripts/boardFormationGoalsDryRun.js\` · READ-ONLY · simulér-før-ship (ejer-accepteret 7/6)`);
  lines.push(`> Population: ${population.pendingBoards.length} ægte formations-boards (negotiation_status='pending') + 1 syntetisk entry-hold · aktiv sæson ${population.season?.number ?? "?"}`);
  lines.push(`> BEFORE = statiske fallback-mål (\`generateBoardGoals({focus,planType})\` — præcis hvad \`createInitialBoardProfile\` giver i dag). AFTER = kalibreret (\`generateBoardGoals({focus,planType,team,riders})\`).`);
  lines.push("");

  // Aggregeret: hvor mange uopnåelige identitets-mål før vs efter.
  let unreachBefore = 0;
  let unreachAfter = 0;
  const perTeamRows = [];
  const satRows = [];

  for (const entry of entries) {
    const { team, board } = entry;
    const focus = board.focus || "balanced";
    const planType = board.plan_type || "1yr";
    const before = generateBoardGoals({ focus, planType });
    const after = generateBoardGoals({ focus, planType, team, riders: team.riders, standing: null });

    for (const g of before) { const r = squadReachability(g, team); if (r && !r.met) unreachBefore += 1; }
    for (const g of after) { const r = squadReachability(g, team); if (r && !r.met) unreachAfter += 1; }

    const divTeamCount = population.divisionTeamCounts?.[team.division] ?? (team.division === 4 ? 15 : 16);
    const divManagerCount = population.divisionManagerCounts?.[team.division] ?? null;
    const scenarios = scenariosFor(divTeamCount);

    const satBefore = {};
    const satAfter = {};
    for (const sc of scenarios) {
      satBefore[sc.key] = projectSatisfaction({ entry, goals: before, scenario: sc, divTeamCount, divManagerCount });
      satAfter[sc.key] = projectSatisfaction({ entry, goals: after, scenario: sc, divTeamCount, divManagerCount });
    }

    perTeamRows.push({ team, before, after, focus, planType });
    satRows.push({ team, satBefore, satAfter, scenarios });
  }

  lines.push(`## 1. Sammendrag`);
  lines.push("");
  lines.push(`- **Strukturelt uopnåelige identitets-mål** (target > faktisk trup): **${unreachBefore} før → ${unreachAfter} efter** (på tværs af ${entries.length} hold).`);
  lines.push(`- Drivende mål: \`min_riders\` (statisk 15 for balanced) rammer enhver trup < 15. Kalibreret følger divisionens squad-limits (div 3/4: 8–10) → typisk target 8–9, som ægte trupper opfylder.`);
  lines.push("");

  lines.push(`## 2. Satisfaction-projektion (sæson-slut, samme løbsforløb før/efter)`);
  lines.push("");
  lines.push(`Newsatisfaction fra \`evaluateBoardSeason\` (start 50, 1yr final). Tre repræsentative placeringer pr. hold. Δ = efter − før (positivt = kalibrering hæver bestyrelsens vurdering ved samme præstation).`);
  lines.push("");
  lines.push(`| Hold | Div | Trup | midt: før→efter (Δ) | stærk: før→efter (Δ) | svag: før→efter (Δ) |`);
  lines.push(`|---|--:|--:|---|---|---|`);
  for (const row of satRows) {
    const cell = (k) => {
      const b = row.satBefore[k].newSatisfaction;
      const a = row.satAfter[k].newSatisfaction;
      const d = a - b;
      return `${b}→${a} (${d >= 0 ? "+" : ""}${d})`;
    };
    lines.push(`| ${safeName(row.team.name)} | ${row.team.division} | ${(row.team.riders || []).length} | ${cell("midt")} | ${cell("stærk")} | ${cell("svag")} |`);
  }
  lines.push("");

  lines.push(`## 3. Mål-diff pr. hold (BEFORE → AFTER)`);
  lines.push("");
  for (const row of perTeamRows) {
    const diff = diffGoals(row.before, row.after);
    const changed = diff.filter((d) => d.change !== "uændret");
    lines.push(`### ${safeName(row.team.name)} — div ${row.team.division}, ${(row.team.riders || []).length} ryttere (${row.focus}/${row.planType})`);
    if (!changed.length) {
      lines.push(`_Ingen mål-ændring._`);
      lines.push("");
      continue;
    }
    lines.push(`| Mål | Før | Efter | Trup-status |`);
    lines.push(`|---|---|---|---|`);
    for (const d of diff) {
      if (d.change === "uændret") continue;
      const beforeTxt = d.before ? goalLine(d.before) : "—";
      const afterTxt = d.after ? goalLine(d.after) : "—";
      const r = d.after ? squadReachability(d.after, row.team) : (d.before ? squadReachability(d.before, row.team) : null);
      const reach = r ? (r.met ? `✅ ${r.actual}/${r.target} ${r.kind}` : `❌ ${r.actual}/${r.target} ${r.kind}`) : "(løbs-afhængigt)";
      lines.push(`| ${d.key} | ${beforeTxt} | ${afterTxt} | ${reach} |`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function safeName(name) {
  return String(name).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const population = await fetchPopulation();
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(new Date());
  const report = buildReport({ population, today });

  if (OUT_PATH) {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, report);
    console.log(`✅ Rapport skrevet: ${OUT_PATH}`);
  } else {
    console.log(report);
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});

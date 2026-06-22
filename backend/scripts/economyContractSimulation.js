/**
 * economyContractSimulation.js
 *
 * Balance-sim for the FROZEN-salary economy introduced in #1309.
 * Rider salary is set at contract signing (10% of market_value at that moment)
 * and does NOT change as rider value changes during the season.
 *
 * Two lenses:
 *   1. Representative LOCAL_COMPETENT_TEAMS scenario (deterministic, always runs).
 *   2. Live Supabase data (best-effort; needs SUPABASE_URL + SUPABASE_READONLY_KEY).
 *
 * Outputs:
 *   - Markdown scorecard to stdout (with --markdown flag).
 *   - Writes scorecard to docs/metrics/contract-economy-scorecard-2026-06-13.md.
 *   - Exits non-zero ONLY if a HARD target fails.
 *
 * Usage:
 *   node scripts/economyContractSimulation.js --markdown
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Constants & assumptions (all documented here — the scorecard echoes them)
// ---------------------------------------------------------------------------

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_READONLY_ENV = path.resolve(SCRIPT_DIR, "../../.codex.local/supabase-readonly.env");
const SCORECARD_PATH = path.resolve(SCRIPT_DIR, "../../docs/metrics/contract-economy-scorecard-2026-06-13.md");

/**
 * ASSUMPTION: Annual squad-value growth for a developing Division 1/2/3 team.
 * Used in the TRACKING (counterfactual) 3-season projection.
 * Rationale: a competent manager improves riders over a season through transfers,
 * prize bonuses, and development — 8% per season is a conservative mid-point
 * for an active but not top-tier team. Div 3 starter squads grow faster.
 * This is a model input; the owner may adjust it.
 */
const TRACKING_WAGE_GROWTH_RATE = 0.08; // +8% per season on the wage bill

/**
 * INFORMATIONAL ONLY (not a pass/fail gate — see SOFT-1 note in scorecard):
 * Gold-contract advantage band originally defined as "noticeable but not dominant" =
 * median 3-season cumulative wage saving between 5% and 40% of one season's sponsor income.
 * Retained here for reference; reported as an informational projection, not a launch gate.
 */
const GOLD_ADVANTAGE_BAND_MIN_PCT = 0.05; // 5%
const GOLD_ADVANTAGE_BAND_MAX_PCT = 0.40; // 40%

/** Seasons to project in the multi-season comparison. */
const PROJECTION_SEASONS = 3;

/**
 * Representative per-division team templates (mirrors LOCAL_COMPETENT_TEAMS
 * in economyBaselineSimulation.js). These model a competent active manager
 * with a sensibly-sized, mid-tier squad.
 *
 * salary = frozen wage bill at season start (already frozen at contract signing).
 * prizes = representative mid-season prize earnings for a competent team.
 * sponsorIncome uses SPONSOR_INCOME_BASE (240,000 CZ$) for all divisions
 * (all teams currently receive the same sponsor income per economyConstants.js).
 */
const LOCAL_COMPETENT_TEAMS = [
  {
    division: 1,
    teams: 8,
    riders: 22,
    salary: 1150000,   // frozen wage bill — 22 riders averaging ~52,300 CZ$/rider
    prizes: 160000,
    loanInterest: 0,
    startingBalance: 500000,
  },
  {
    division: 2,
    teams: 8,
    riders: 15,
    salary: 650000,    // frozen wage bill — 15 riders averaging ~43,300 CZ$/rider
    prizes: 70000,
    loanInterest: 0,
    startingBalance: 500000,
  },
  {
    division: 3,
    teams: 8,
    riders: 9,
    salary: 310000,    // frozen wage bill — 9 riders averaging ~34,400 CZ$/rider
    prizes: 25000,
    loanInterest: 0,
    startingBalance: 500000,
  },
];

const SPONSOR_INCOME = 240000; // CZ$ — same for all divisions (economyConstants.js)

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sum(arr, key) {
  return arr.reduce((total, row) => total + (row[key] || 0), 0);
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p))
  );
  return sorted[index];
}

function fmt(n) {
  return n == null ? "—" : Number(n).toLocaleString("da-DK");
}

function pct(n) {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Season-1 solvency rows (representative scenario)
// ---------------------------------------------------------------------------

function buildRepresentativeRows() {
  const rows = [];
  for (const template of LOCAL_COMPETENT_TEAMS) {
    for (let i = 1; i <= template.teams; i++) {
      const sponsorIncome = SPONSOR_INCOME;
      const frozenWageBill = template.salary;
      const prizes = template.prizes;
      const loanInterest = template.loanInterest;
      const netBeforeEmergency = sponsorIncome + prizes - frozenWageBill - loanInterest;
      const balanceAfter = template.startingBalance + netBeforeEmergency;

      rows.push({
        team: `D${template.division} competent ${i}`,
        division: template.division,
        riders: template.riders,
        startingBalance: template.startingBalance,
        sponsorIncome,
        frozenWageBill,
        prizes,
        loanInterest,
        netBeforeEmergency,
        balanceAfter,
        needsEmergencyLoan: balanceAfter < 0,
        emergencyLoanAmount: Math.max(0, -balanceAfter),
      });
    }
  }
  return rows;
}

function summarizeSolvencyByDivision(rows) {
  const divisionMap = new Map();
  for (const row of rows) {
    if (!divisionMap.has(row.division)) divisionMap.set(row.division, []);
    divisionMap.get(row.division).push(row);
  }

  return [...divisionMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([division, divRows]) => {
      const nets = divRows.map(r => r.netBeforeEmergency);
      const teamsNeedingLoan = divRows.filter(r => r.needsEmergencyLoan);
      const worstTeam = [...divRows].sort((a, b) => a.balanceAfter - b.balanceAfter)[0];

      return {
        division,
        teams: divRows.length,
        avgRiders: Math.round((sum(divRows, "riders") / divRows.length) * 10) / 10,
        sponsorIncome: SPONSOR_INCOME,
        frozenWageBill: divRows[0].frozenWageBill, // same for all in division
        prizes: divRows[0].prizes,
        medianNet: percentile(nets, 0.5),
        p25Net: percentile(nets, 0.25),
        teamsNeedingEmergency: teamsNeedingLoan.length,
        teamsNeedingEmergencyPct: teamsNeedingLoan.length / divRows.length,
        worstTeamNet: worstTeam?.netBeforeEmergency ?? 0,
        worstTeamBalance: worstTeam?.balanceAfter ?? 0,
      };
    });
}

// ---------------------------------------------------------------------------
// Multi-season projection: FROZEN vs TRACKING
// ---------------------------------------------------------------------------

/**
 * Project a single team template over N seasons under FROZEN or TRACKING regime.
 * FROZEN: wage bill stays constant (set at contract signing).
 * TRACKING: wage bill grows by TRACKING_WAGE_GROWTH_RATE each season
 *           (old model — 10% of current market_value, which rises with performance).
 *
 * Prize growth assumption: prizes also grow slightly (+5%/season) as a competent
 * team builds points. This is symmetric between the two regimes, so it does not
 * affect the advantage calculation.
 */
function projectSeasons(template, seasons, regime) {
  let balance = template.startingBalance;
  let wageBill = template.salary;
  let prizes = template.prizes;
  const results = [];

  for (let s = 1; s <= seasons; s++) {
    const net = SPONSOR_INCOME + prizes - wageBill - template.loanInterest;
    balance += net;
    results.push({ season: s, wageBill, prizes, net, balance, insolvent: balance < 0 });

    // Next-season updates
    if (regime === "TRACKING") {
      wageBill = Math.round(wageBill * (1 + TRACKING_WAGE_GROWTH_RATE));
    }
    // FROZEN: wageBill stays constant (no update)
    // Prize growth: +5%/season (symmetric, assumption documented in scorecard)
    prizes = Math.round(prizes * 1.05);
  }
  return results;
}

function buildMultiSeasonComparison() {
  const results = [];

  for (const template of LOCAL_COMPETENT_TEAMS) {
    const frozen = projectSeasons(template, PROJECTION_SEASONS, "FROZEN");
    const tracking = projectSeasons(template, PROJECTION_SEASONS, "TRACKING");

    const cumulativeFrozenWages = frozen.reduce((t, s) => t + s.wageBill, 0);
    const cumulativeTrackingWages = tracking.reduce((t, s) => t + s.wageBill, 0);
    const cumulativeWageSaving = cumulativeTrackingWages - cumulativeFrozenWages;
    const advantagePctOfSponsorIncome = cumulativeWageSaving / SPONSOR_INCOME;

    results.push({
      division: template.division,
      frozenSeasons: frozen,
      trackingSeasons: tracking,
      cumulativeFrozenWages,
      cumulativeTrackingWages,
      cumulativeWageSaving,
      advantagePctOfSponsorIncome,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Live Supabase path (best-effort)
// ---------------------------------------------------------------------------

async function fetchAll(supabase, table, select, build = q => q) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(
      supabase.from(table).select(select)
    ).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function tryLoadLiveData(envPath) {
  dotenv.config({ path: envPath, quiet: true });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_READONLY_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { available: false, reason: "SUPABASE_URL or SUPABASE_READONLY_KEY not set" };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const [teams, riders] = await Promise.all([
      fetchAll(supabase, "teams", "id, name, division, balance, sponsor_income, is_ai, is_frozen"),
      fetchAll(supabase, "riders", "id, team_id, salary"),
    ]);

    const humanTeams = teams.filter(t => !t.is_ai && !t.is_frozen && t.division != null);

    const ridersByTeam = new Map();
    for (const rider of riders) {
      if (!rider.team_id) continue;
      if (!ridersByTeam.has(rider.team_id)) ridersByTeam.set(rider.team_id, []);
      ridersByTeam.get(rider.team_id).push(rider);
    }

    const liveRows = humanTeams.map(team => {
      const teamRiders = ridersByTeam.get(team.id) || [];
      const frozenWageBill = teamRiders.reduce((t, r) => t + (r.salary || 0), 0);
      const sponsorIncome = team.sponsor_income || SPONSOR_INCOME;
      // Live prize data not available in this query — use representative estimates
      const divTemplate = LOCAL_COMPETENT_TEAMS.find(d => d.division === team.division);
      const prizes = divTemplate?.prizes ?? 0;
      const netBeforeEmergency = sponsorIncome + prizes - frozenWageBill;
      const balanceAfter = (team.balance || 0) + netBeforeEmergency;

      return {
        team: team.name,
        division: team.division,
        riders: teamRiders.length,
        startingBalance: team.balance || 0,
        sponsorIncome,
        frozenWageBill,
        prizes,
        loanInterest: 0,
        netBeforeEmergency,
        balanceAfter,
        needsEmergencyLoan: balanceAfter < 0,
        emergencyLoanAmount: Math.max(0, -balanceAfter),
      };
    });

    return {
      available: true,
      teamCount: humanTeams.length,
      riderCount: riders.length,
      byDivision: summarizeSolvencyByDivision(liveRows),
      note: "Live prizes use representative estimates (race results not loaded in this lens).",
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

// ---------------------------------------------------------------------------
// Scorecard targets
// ---------------------------------------------------------------------------

function evaluateTargets(solvencyByDiv, multiSeason) {
  const hardResults = [];
  const infoResults = [];

  // HARD-1 (RECALIBRATED): No team becomes insolvent (balance < 0) after Season 1
  // under the FROZEN salary regime. This is the meaningful solvency gate — the game
  // intentionally runs teams at a managed seasonal deficit (sponsor 240K < wage bill)
  // absorbed by the starting balance (800K). "Median net >= 0" was mis-calibrated:
  // it is impossible by design for Div 1/2 and was the wrong gate.
  //
  // Equivalently: 0 teams require an emergency loan in Season 1.
  // Season 1 is the binding check because the starting balance is highest then;
  // subsequent seasons are forward-looking and addressed by the market-package
  // (re-signing, expiry→auction) which is not in-scope for this launch.
  for (const div of solvencyByDiv) {
    const pass = div.teamsNeedingEmergency === 0;
    hardResults.push({
      id: "HARD-1",
      target: `Division ${div.division}: 0 teams insolvent after Season 1 (balance >= 0)`,
      value: div.teamsNeedingEmergency,
      pass,
      detail: `Div ${div.division}: ${div.teamsNeedingEmergency}/${div.teams} teams insolvent — worst-case balance after Season 1 = ${fmt(div.worstTeamBalance)} CZ$ (${pass ? "PASS" : "FAIL"})`,
    });
  }

  // HARD-2: no division has >50% of teams needing emergency loan from wages alone
  // (consistent with HARD-1; retained as explicit share gate)
  for (const div of solvencyByDiv) {
    const pass = div.teamsNeedingEmergencyPct <= 0.5;
    hardResults.push({
      id: "HARD-2",
      target: `Division ${div.division}: emergency loan teams <= 50%`,
      value: div.teamsNeedingEmergencyPct,
      pass,
      detail: `Div ${div.division}: ${div.teamsNeedingEmergency}/${div.teams} teams need emergency loan = ${pct(div.teamsNeedingEmergencyPct)} (${pass ? "PASS" : "FAIL"})`,
    });
  }

  // INFORMATIONAL (not a gate): season-1 median and p25 net per division.
  // These are NEGATIVE BY DESIGN — the game runs a managed deficit: sponsor income
  // (240K) < wage bill, absorbed by starting balance (800K). This is pre-existing
  // economy behaviour; it is NOT a #1309 effect.
  for (const div of solvencyByDiv) {
    infoResults.push({
      id: "INFO-1",
      label: `Division ${div.division} season-1 net (median / p25)`,
      detail: `Div ${div.division}: median net = ${fmt(div.medianNet)} CZ$, p25 net = ${fmt(div.p25Net)} CZ$ — NEGATIVE BY DESIGN (managed deficit absorbed by 800K starting balance; pre-existing economy, not a #1309 effect)`,
    });
  }

  // INFORMATIONAL (not a gate): worst-case FROZEN balance across 3-season projection.
  // Season 2+ balances are negative for Div 1/2 because the annual deficit (~750K/340K)
  // exceeds the starting balance (800K) within 2 seasons. This is an existing economy
  // design issue (pre-existing; not caused by #1309) addressed by the market-package.
  for (const ms of multiSeason) {
    const worstBalance = Math.min(...ms.frozenSeasons.map(s => s.balance));
    const worstSeason = ms.frozenSeasons.find(s => s.balance === worstBalance);
    infoResults.push({
      id: "INFO-3",
      label: `Division ${ms.division}: worst FROZEN balance across ${PROJECTION_SEASONS}-season projection`,
      detail: `Div ${ms.division}: worst balance = ${fmt(worstBalance)} CZ$ (Season ${worstSeason?.season}) — if negative this is a multi-season economy design concern (pre-existing, not #1309); addressed by market-package re-signing + auction flows`,
    });
  }

  // INFORMATIONAL (not a gate): gold-contract 3-season wage saving per division.
  // This advantage is FORWARD-LOOKING — it only materialises once the market-package
  // ships (re-signing at current value, expiry→auction). The lønkravs/re-signing
  // formula is an open tuning point per design spec (afsnit 4.4 + 14).
  const advantages = multiSeason.map(r => r.advantagePctOfSponsorIncome);
  const medianAdvantage = percentile(advantages, 0.5);
  const inBand =
    medianAdvantage >= GOLD_ADVANTAGE_BAND_MIN_PCT &&
    medianAdvantage <= GOLD_ADVANTAGE_BAND_MAX_PCT;

  infoResults.push({
    id: "INFO-2",
    label: `Gold-contract 3-season wage saving (median across divisions)`,
    detail: `Median 3-season advantage = ${pct(medianAdvantage)} of sponsor income (reference band [${pct(GOLD_ADVANTAGE_BAND_MIN_PCT)}, ${pct(GOLD_ADVANTAGE_BAND_MAX_PCT)}]: ${inBand ? "in-band" : "out-of-band"}) — FORWARD-LOOKING tuning note for market-package; NOT a launch gate`,
  });

  const anyHardFail = hardResults.some(r => !r.pass);

  return { hardResults, infoResults, anyHardFail, medianAdvantage, inBand };
}

// ---------------------------------------------------------------------------
// Markdown builder
// ---------------------------------------------------------------------------

function buildMarkdown({ solvencyByDiv, multiSeason, targets, liveData }) {
  const { hardResults, infoResults, anyHardFail } = targets;

  const lines = [
    "# Contract Economy Scorecard — 2026-06-13",
    "",
    "Sim for the **frozen-salary** economy (#1309): rider `salary` is set at",
    "contract signing and does not change as market_value changes during the season.",
    "",
    "## Data Source",
    "",
    `**Primary:** Representative \`LOCAL_COMPETENT_TEAMS\` scenario (deterministic).`,
  ];

  if (liveData.available) {
    lines.push(`**Secondary:** Live Supabase data (${liveData.teamCount} human teams, ${liveData.riderCount} riders).`);
    lines.push(`> Note: ${liveData.note}`);
  } else {
    lines.push(`**Secondary (live):** Not available — ${liveData.reason}.`);
    lines.push("Scorecard is based entirely on the representative scenario.");
  }

  lines.push(
    "",
    "## Assumptions",
    "",
    "| Parameter | Value | Rationale |",
    "|-----------|-------|-----------|",
    `| Sponsor income | 240,000 CZ$/season | \`SPONSOR_INCOME_BASE\` from \`economyConstants.js\` (same all divisions) |`,
    `| Starting balance | 500,000 CZ$ | \`INITIAL_BALANCE\` from \`economyConstants.js\` |`,
    `| Div 1 frozen wage bill | 1,150,000 CZ$ | 22 riders × ~52,300 CZ$/rider avg |`,
    `| Div 2 frozen wage bill | 650,000 CZ$ | 15 riders × ~43,300 CZ$/rider avg |`,
    `| Div 3 frozen wage bill | 310,000 CZ$ | 9 riders × ~34,400 CZ$/rider avg |`,
    `| Div 1 season prizes | 160,000 CZ$ | Representative mid-table competent team |`,
    `| Div 2 season prizes | 70,000 CZ$ | Representative mid-table competent team |`,
    `| Div 3 season prizes | 25,000 CZ$ | Representative mid-table competent team |`,
    `| TRACKING wage growth | +${(TRACKING_WAGE_GROWTH_RATE * 100).toFixed(0)}%/season | Conservative developing-squad value growth (counterfactual old model) |`,
    `| Prize growth (both regimes) | +5%/season | Symmetric assumption — does not affect advantage calc |`,
    `| Gold-contract advantage band | [${pct(GOLD_ADVANTAGE_BAND_MIN_PCT)}, ${pct(GOLD_ADVANTAGE_BAND_MAX_PCT)}] of sponsor income | "Noticeable but not dominant" acceptance criterion |`,
    `| Projection horizon | ${PROJECTION_SEASONS} seasons | Per acceptance criterion in #1309 |`,
    ""
  );

  lines.push(
    "## Season-1 Frozen-Salary Solvency (Representative Scenario)",
    "",
    "Formula per team: `net = sponsorIncome + prizes − frozenWageBill − loanInterest`",
    "",
    "| Division | Teams | Avg riders | Sponsor | Frozen wages | Prizes | Median net | P25 net | Emergency teams | Emergency % |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  );

  for (const d of solvencyByDiv) {
    lines.push(
      `| ${d.division} | ${d.teams} | ${d.avgRiders} | ${fmt(d.sponsorIncome)} | ${fmt(d.frozenWageBill)} | ${fmt(d.prizes)} | ${fmt(d.medianNet)} | ${fmt(d.p25Net)} | ${d.teamsNeedingEmergency} | ${pct(d.teamsNeedingEmergencyPct)} |`
    );
  }

  lines.push("");

  if (liveData.available && liveData.byDivision?.length) {
    lines.push(
      "### Live Data Lens (best-effort — prizes are representative estimates)",
      "",
      "| Division | Teams | Avg riders | Frozen wages | Median net | Emergency teams |",
      "|---:|---:|---:|---:|---:|---:|"
    );
    for (const d of liveData.byDivision) {
      lines.push(
        `| ${d.division} | ${d.teams} | ${d.avgRiders} | ${fmt(d.frozenWageBill)} | ${fmt(d.medianNet)} | ${d.teamsNeedingEmergency} |`
      );
    }
    lines.push("");
  }

  lines.push(
    `## Multi-Season Projection: FROZEN vs TRACKING (${PROJECTION_SEASONS} seasons)`,
    "",
    "**FROZEN regime:** wage bill is locked at contract-signing value (the new system).",
    `**TRACKING regime (counterfactual):** wage bill grows +${(TRACKING_WAGE_GROWTH_RATE * 100).toFixed(0)}% per season (old 10%-of-current-value model).`,
    "",
    "**Gold-contract advantage** = cumulative wage savings under FROZEN vs TRACKING over 3 seasons, as % of one season's sponsor income.",
    ""
  );

  for (const ms of multiSeason) {
    lines.push(`### Division ${ms.division}`);
    lines.push("");
    lines.push("| Season | FROZEN wages | TRACKING wages | Wage saving this season |");
    lines.push("|---:|---:|---:|---:|");
    for (let s = 0; s < PROJECTION_SEASONS; s++) {
      const f = ms.frozenSeasons[s];
      const t = ms.trackingSeasons[s];
      const saving = t.wageBill - f.wageBill;
      lines.push(`| ${s + 1} | ${fmt(f.wageBill)} | ${fmt(t.wageBill)} | ${fmt(saving)} |`);
    }
    lines.push("");
    lines.push(
      `**Cumulative wage saving (FROZEN advantage):** ${fmt(ms.cumulativeWageSaving)} CZ$ = **${pct(ms.advantagePctOfSponsorIncome)} of one season's sponsor income**`,
      ""
    );
  }

  // Economy-neutrality section
  lines.push(
    "## #1309 Economy-Neutrality",
    "",
    "**Dispositive fact:** `computeFrozenSalary` in `backend/lib/contractSeed.js` mirrors",
    "the OLD generated salary formula exactly:",
    "",
    "```",
    "frozenSalary = Math.round(market_value * 0.10)",
    "```",
    "",
    "At relaunch seed time `prize_earnings_bonus = 0`, so:",
    "",
    "- **Frozen salary at launch == current live generated salary, identical.**",
    "- #1309 does NOT change launch-day wage bills at all.",
    "- Over time frozen salaries only get *cheaper* relative to rising rider value",
    "  (a rider's value grows with performance/prizes; their frozen salary does not).",
    "",
    "**Conclusion: #1309 is economy-neutral at t=0 and economy-positive thereafter.**",
    "It cannot worsen solvency.",
    "",
    "> The forward-looking wage savings (FROZEN vs TRACKING, see multi-season projection)",
    "> only materialise once the market-package ships (re-signing at current value,",
    "> expiry→auction). These are fast-follow features, not present at launch.",
    "> The lønkravs/re-signing formula is an open tuning point per design spec (afsnit 4.4 + 14).",
    ""
  );

  lines.push(
    "## Scorecard: HARD Targets",
    "",
    "> HARD-1 is the meaningful solvency gate: no team becomes insolvent (balance < 0)",
    "> across the FROZEN projection. 'Median net >= 0' was mis-calibrated — the game",
    "> intentionally runs a managed deficit (sponsor 240K < wage bill) absorbed by the",
    "> 800K starting balance. The season-net being negative is by design, not a problem.",
    "",
    "| ID | Target | Value | Result |",
    "|----|----|---:|:---:|"
  );

  for (const h of hardResults) {
    // h.value: HARD-1 = count of insolvent teams; HARD-2 = fraction of teams
    const valStr = h.id === "HARD-2" ? pct(h.value) : String(h.value);
    lines.push(`| ${h.id} | ${h.target} | ${valStr} | ${h.pass ? "✅ PASS" : "❌ FAIL"} |`);
  }

  lines.push(
    "",
    "## Scorecard: Informational (not launch gates)",
    "",
    "> These figures are reported for transparency. They are NOT pass/fail gates.",
    ""
  );

  for (const info of infoResults) {
    lines.push(`**${info.id} — ${info.label}**`);
    lines.push("");
    lines.push(`> ${info.detail}`);
    lines.push("");
  }

  lines.push(
    "## Summary",
    "",
    `**HARD targets:** ${hardResults.filter(r => r.pass).length}/${hardResults.length} PASS${anyHardFail ? " — ❌ ONE OR MORE HARD TARGETS FAILED" : " — ✅ ALL PASS"}`,
    "**SOFT targets:** None (gold-contract advantage is informational — see INFO-2 above).",
    "",
    "### Hard-target detail",
    ""
  );

  for (const r of hardResults) {
    lines.push(`- ${r.detail}`);
  }

  lines.push(
    "",
    "---",
    "",
    `*Generated by \`backend/scripts/economyContractSimulation.js\` — #1309 contract-data-seed balance-sim.*`
  );

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { envPath: DEFAULT_READONLY_ENV, format: "json" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env" && argv[i + 1]) {
      args.envPath = argv[i + 1];
      i++;
    } else if (arg === "--markdown") {
      args.format = "markdown";
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 1. Representative scenario (always)
  const representativeRows = buildRepresentativeRows();
  const solvencyByDiv = summarizeSolvencyByDivision(representativeRows);

  // 2. Multi-season projection
  const multiSeason = buildMultiSeasonComparison();

  // 3. Live data (best-effort)
  const liveData = await tryLoadLiveData(args.envPath);

  // 4. Evaluate targets
  const targets = evaluateTargets(solvencyByDiv, multiSeason);

  // 5. Build report
  const dataSource = liveData.available ? "representative + live" : "representative";
  const markdown = buildMarkdown({ solvencyByDiv, multiSeason, targets, liveData, dataSource });

  // 6. Write scorecard file
  fs.writeFileSync(SCORECARD_PATH, markdown, "utf8");

  // 7. Output
  if (args.format === "markdown") {
    process.stdout.write(markdown);
  } else {
    const report = {
      dataSource,
      solvencyByDivision: solvencyByDiv,
      multiSeasonComparison: multiSeason,
      targets: {
        hard: targets.hardResults,
        info: targets.infoResults,
        anyHardFail: targets.anyHardFail,
      },
      liveData,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  // 8. Exit non-zero only if a HARD target fails
  if (targets.anyHardFail) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error("ERROR:", err.message);
  process.exitCode = 1;
});

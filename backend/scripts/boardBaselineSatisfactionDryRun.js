#!/usr/bin/env node
// #2521 · Read-only dry-run: baseline-bestyrelsen lever.
// =============================================================================
// Simulér-før-ship-gaten for #2521 (issue-krav, jf. simulate-before-ship-balance-
// reglen): beregner hvilken satisfaction ALLE nuværende baseline-boards i prod
// ville få efter ÉN weekend-kørsel med computeBaselineWeekendUpdate (boardWeekendUpdate.js),
// og printer scorecardet (min/median/max + histogram) til PR-body'en.
//
// INGEN skrivninger — kun SELECT via service-key (samme mønster som
// boardSatisfactionHarness.js --refresh-fixture).
//
//   node scripts/boardBaselineSatisfactionDryRun.js [--env <sti-til-.env>]
//
// #2521-fund: der findes IKKE nogen live baseline-boards i prod på tidspunktet
// for denne kørsel — sæson 1 har allerede onboardet alle rigtige hold til
// forhandlede planer (1yr/3yr/5yr). Scriptet falder derfor tilbage til at
// simulere formlen mod HELE den rigtige trup-population (samme diskriminator:
// ikke-AI/bank/test/frosne), som om hvert hold stadig var i baseline-fasen
// (satisfaction=50, ingen mål) — det er den korrekte proxy, fordi formlen kun
// afhænger af placerings-percentil + økonomi, ikke af boardets faktiske plan_type.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeBaselineWeekendUpdate, computeBaselineTargetSatisfaction } from "../lib/boardWeekendUpdate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] !== undefined ? args[idx + 1] : fallback;
}

async function main() {
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

  // Samme population-filter som UI/boardWeekendFinalization.js: rigtige hold =
  // ikke-AI/bank/test/frosne.
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, balance")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .eq("is_test_account", false);
  if (teamsError) throw new Error(`teams: ${teamsError.message}`);
  const teamIds = (teams || []).map((t) => t.id);
  const balanceByTeam = new Map((teams || []).map((t) => [t.id, t.balance]));

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number, status")
    .eq("status", "active")
    .maybeSingle();
  if (seasonError) throw new Error(`seasons: ${seasonError.message}`);
  if (!season?.id) {
    console.error("❌ Ingen aktiv sæson fundet — kan ikke bygge standings-puljer.");
    process.exit(1);
  }

  const [standingsRes, loansRes, baselineBoardsRes] = await Promise.all([
    supabase
      .from("season_standings")
      .select("team_id, division, league_division_id, rank_in_division, team:team_id(is_ai, is_bank, is_frozen, is_test_account)")
      .eq("season_id", season.id),
    supabase.from("loans").select("team_id").eq("status", "active").in("team_id", teamIds),
    supabase.from("board_profiles").select("id, team_id").eq("is_baseline", true).in("team_id", teamIds),
  ]);
  if (standingsRes.error) throw new Error(`season_standings: ${standingsRes.error.message}`);
  if (loansRes.error) throw new Error(`loans: ${loansRes.error.message}`);
  if (baselineBoardsRes.error) throw new Error(`board_profiles: ${baselineBoardsRes.error.message}`);

  const standings = standingsRes.data || [];
  const standingByTeam = new Map(standings.map((s) => [s.team_id, s]));

  const loanCountByTeam = new Map();
  for (const loan of loansRes.data || []) {
    loanCountByTeam.set(loan.team_id, (loanCountByTeam.get(loan.team_id) || 0) + 1);
  }

  const liveBaselineCount = (baselineBoardsRes.data || []).length;

  function scorecard(label, values) {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[(n - 1) / 2];
    const min = sorted[0];
    const max = sorted[n - 1];
    const atFloor = sorted.filter((v) => v <= 30).length;
    const atCeiling = sorted.filter((v) => v >= 75).length;
    const buckets = [[30, 39], [40, 49], [50, 59], [60, 69], [70, 75]];
    const histogram = buckets.map(([lo, hi]) => ({
      range: `${lo}-${hi}`,
      count: sorted.filter((v) => v >= lo && v <= hi).length,
    }));

    console.log(`--- ${label} ---`);
    console.log(`n = ${n}`);
    console.log(`min = ${min}, median = ${median}, max = ${max}`);
    console.log(`Ved klamp-gulv (≤30): ${atFloor} (${((atFloor / n) * 100).toFixed(1)}%)`);
    console.log(`Ved klamp-loft (≥75): ${atCeiling} (${((atCeiling / n) * 100).toFixed(1)}%)`);
    console.log("Histogram:");
    for (const bucket of histogram) {
      console.log(`  ${bucket.range}: ${"#".repeat(bucket.count)} (${bucket.count})`);
    }
    console.log("");
  }

  // A) Efter ÉN weekend-kørsel fra baseline-default (satisfaction=50) — det
  // issue-krævede scorecard. Bevidst kompakt (±5/-8-clampen tillader kun ét
  // skridt), fordi bestyrelsen konvergerer over flere weekender, ikke springer.
  const afterOneWeekend = [];
  // B) Det FULDT KONVERGEREDE target (computeBaselineTargetSatisfaction, uden
  // inerti-clamp) — viser hvor bestyrelsen ender hen over en sæson, så
  // scorecardet ikke fejlagtigt undervurderer spredningen til kun ét weekend-skridt.
  const convergedTarget = [];

  for (const teamId of teamIds) {
    const standing = standingByTeam.get(teamId);
    if (!standing) continue; // ingen løbsdata endnu → intet target at beregne
    const balance = balanceByTeam.get(teamId);
    const activeLoanCount = loanCountByTeam.get(teamId) || 0;

    const update = computeBaselineWeekendUpdate({
      board: { satisfaction: 50 },
      teamId,
      standing,
      standings,
      balance,
      activeLoanCount,
    });
    if (update) afterOneWeekend.push(update.newSatisfaction);

    const target = computeBaselineTargetSatisfaction({ teamId, standing, standings, balance, activeLoanCount });
    convergedTarget.push(target.targetSatisfaction);
  }

  console.log("=== #2521 · Baseline-bestyrelsen lever — dry-run-scorecard ===");
  console.log(`Sæson: nr. ${season.number} (${season.id})`);
  console.log(`Live baseline-boards i prod lige nu: ${liveBaselineCount}`);
  if (liveBaselineCount === 0) {
    console.log("⚠️  INGEN live baseline-boards fundet — sæson 1 har allerede onboardet alle");
    console.log("    rigtige hold til forhandlede planer. Scorecardet nedenfor simulerer i");
    console.log("    stedet formlen mod HELE den rigtige trup-population (n = antal hold med");
    console.log("    standing), som proxy — formlen afhænger kun af placering + økonomi.");
  }
  console.log("");
  scorecard("A) Efter ÉN weekend fra satisfaction=50 (issue-krævet scorecard)", afterOneWeekend);
  scorecard("B) Fuldt konvergeret target (efter flere weekender, ingen inerti-clamp)", convergedTarget);
}

main().catch((error) => {
  console.error("❌ Dry-run fejlede:", error.message);
  process.exit(1);
});

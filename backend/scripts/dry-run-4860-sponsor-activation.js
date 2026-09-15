// Read-only S4 sponsor activation audit. No mutation mode exists.
// infisical run --env=dev -- node backend/scripts/dry-run-4860-sponsor-activation.js --dry-run
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { renownTarget } from "../lib/renownEngine.js";
import { FULL_CALENDAR_DAYS, generateOffers } from "../lib/sponsorOffers.js";
import { repricePendingContract, contractCoversSeason } from "../lib/sponsorContractsService.js";
import { resolveDivisionAdjustment } from "../lib/divisionAdjustment.js";

export function parseArgs(args) {
  let seasonNumber = 4;
  for (const arg of args) {
    if (arg === "--dry-run") continue;
    if (/^--season=\d+$/.test(arg)) seasonNumber = Number(arg.slice(9));
    else throw new Error(`Unsupported argument: ${arg}. This script only supports dry-run.`);
  }
  if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 4) throw new Error("Expected season >= 4");
  return { seasonNumber };
}

// Transport-level guard as well as SELECT-only application code. In particular,
// RPC, auth refresh, inserts and updates can never reach the database through it.
export function readOnlyFetch(input, init = {}) {
  const method = (init.method || input?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new Error("Dry-run rejected a non-read request");
  return fetch(input, init);
}

export function buildRows({ teams, contracts, standings, seasonNumber }) {
  const lockedTeams = new Set(contracts
    .filter((contract) => contract.status === "active" && contractCoversSeason(contract, seasonNumber))
    .map((contract) => contract.team_id));
  return teams.filter((team) => !lockedTeams.has(team.id))
    .map((team) => {
      const lastSeasonStanding = standings.find((row) => row.team_id === team.id) || null;
      const context = {
        lastSeasonStanding,
        divisionStandings: lastSeasonStanding
          ? standings.filter((row) => row.division === lastSeasonStanding.division) : [],
      };
      const target = renownTarget({ division: team.division, ...context });
      const selected = contracts.find((contract) => contract.team_id === team.id
        && contract.status === "pending" && contract.start_season === seasonNumber);
      const oldDivision = lastSeasonStanding?.division ?? team.division;
      const oldOffer = generateOffers({
        teamId: team.id, seasonNumber,
        renownTargetValue: renownTarget({ division: oldDivision, ...context }),
      }).find((offer) => offer.variant === "safe");
      const pending = selected || {
        team_id: team.id, start_season: seasonNumber, variant: oldOffer.variant,
        guaranteed_base: oldOffer.guaranteedBase, guaranteed_fraction: oldOffer.guaranteedFraction,
        race_day_share: oldOffer.raceDayShare, bonus_clauses: oldOffer.clauses,
        signed_division: oldDivision,
      };
      const repriced = repricePendingContract({
        pending, renownTargetValue: target, divisor: FULL_CALENDAR_DAYS, activationDivision: team.division,
      });
      const oldAdjustment = resolveDivisionAdjustment({ team, contract: pending, seasonNumber }).payout;
      const newAdjustment = resolveDivisionAdjustment({ team, contract: repriced, seasonNumber }).payout;
      const oldTotal = Number(pending.guaranteed_base) + oldAdjustment;
      const newTotal = repriced.guaranteed_base + newAdjustment;
      return {
        team: team.name, source: selected ? "Valgt" : "Auto", variant: pending.variant, division: team.division,
        signedBase: Number(pending.guaranteed_base), repricedBase: repriced.guaranteed_base,
        difference: repriced.guaranteed_base - Number(pending.guaranteed_base),
        oldAdjustment, newAdjustment, oldTotal, newTotal, totalDifference: newTotal - oldTotal,
      };
    }).sort((a, b) => b.difference - a.difference || a.team.localeCompare(b.team));
}

export function renderTable(rows) {
  const cell = (value) => String(value).replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
  const lines = [
    "| Hold | Valg | Variant | Div. nu | Base før | Base efter | Baseforskel | Tillæg før | Tillæg efter | I alt før | I alt efter | Forskel i alt |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${cell(row.team)} | ${row.source} | ${cell(row.variant)} | ${row.division} | ${row.signedBase} | ${row.repricedBase} | ${row.difference} | ${row.oldAdjustment} | ${row.newAdjustment} | ${row.oldTotal} | ${row.newTotal} | ${row.totalDifference} |`),
  ];
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  lines.push(`| **Sum (${rows.length} hold)** | | | | **${sum("signedBase")}** | **${sum("repricedBase")}** | **${sum("difference")}** | **${sum("oldAdjustment")}** | **${sum("newAdjustment")}** | **${sum("oldTotal")}** | **${sum("newTotal")}** | **${sum("totalDifference")}** |`);
  return lines.join("\n");
}

export async function audit({ supabase, seasonNumber }) {
  const { data: season, error } = await supabase.from("seasons")
    .select("id, number, status").eq("number", seasonNumber - 1).single();
  if (error) throw error;
  if (!season) throw new Error("Previous season is missing");
  const teams = await fetchAllRows(() => supabase.from("teams")
    .select("id, name, division")
    .eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false)
    .order("id"));
  const contracts = await fetchAllRows(() => supabase.from("sponsor_contracts")
    .select("*").in("status", ["pending", "active"]).order("id"));
  const standings = await fetchAllRows(() => supabase.from("season_standings")
    .select("id, team_id, division, rank_in_division, total_points")
    .eq("season_id", season.id).order("id"));
  const rows = buildRows({ teams, contracts, standings, seasonNumber });
  return { rows, sourceSeason: season };
}

async function main() {
  const { seasonNumber } = parseArgs(process.argv.slice(2));
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Run through Infisical with Supabase credentials");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: readOnlyFetch },
  });
  const { rows, sourceSeason } = await audit({ supabase, seasonNumber });
  console.log(`Dry-run S${seasonNumber}, observed ${new Date().toISOString()}. SELECT only.`);
  console.log(`Uses S${sourceSeason.number} standings (${sourceSeason.status}) and current team divisions.`);
  console.log("Provisional snapshot, not final cutover amounts: final standings and S4 divisions can still change.");
  console.log("Selected and automatically renewed contracts; existing multi-season contracts are excluded. All amounts in CZ$, before board modifiers and additional bonus clauses. Auto: base before means the old renewal rule, not a signed amount.");
  console.log(renderTable(rows));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Do not print SDK errors or request objects that might contain credentials.
    console.error("Sponsor dry-run failed. No data was changed; check arguments, credentials and read access.");
    process.exitCode = 1;
  });
}

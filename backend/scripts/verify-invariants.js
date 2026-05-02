// Zero external dependencies — bruger kun Node built-ins og Supabase REST API.
// Kræver Node 18+ (built-in fetch). Loades env fra backend/.env med mindre --env angives.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENV = path.resolve(SCRIPT_DIR, "../.env");

const SQUAD_MAX = { 1: 30, 2: 20, 3: 10 };
const DEBT_CEILING = { 1: 1_200_000, 2: 900_000, 3: 600_000 };

const KNOWN_TX_TYPES = new Set([
  "sponsor", "prize", "salary", "transfer_in", "transfer_out",
  "interest", "bonus", "starting_budget",
  "loan_received", "loan_repayment", "loan_interest",
  "emergency_loan", "admin_adjustment",
]);

const KNOWN_NOTIF_TYPES = new Set([
  "bid_received", "bid_placed", "auction_won", "auction_lost", "auction_outbid",
  "transfer_offer_received", "transfer_offer_accepted", "transfer_offer_rejected",
  "transfer_counter", "transfer_offer_withdrawn", "transfer_interest",
  "new_race", "race_results_imported", "season_started", "season_ended",
  "board_update", "salary_paid", "sponsor_paid",
  "watchlist_rider_listed", "loan_created", "emergency_loan", "loan_paid_off",
]);

function parseArgs(argv) {
  const args = { envPath: DEFAULT_ENV, format: "text" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env" && argv[i + 1]) {
      args.envPath = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--json") {
      args.format = "json";
    }
  }
  return args;
}

function loadEnv(envPath) {
  let content;
  try { content = readFileSync(envPath, "utf8"); } catch { return; }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function fetchAll(baseUrl, apiKey, table, select, filters = {}) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const url = new URL(`${baseUrl}/rest/v1/${table}`);
    url.searchParams.set("select", select);
    for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Range: `${from}-${from + PAGE - 1}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} — ${await res.text()}`);
    const data = await res.json();
    rows.push(...data);
    const contentRange = res.headers.get("content-range");
    if (!contentRange || data.length < PAGE) break;
    const total = Number(contentRange.split("/")[1]);
    if (isNaN(total) || from + PAGE >= total) break;
  }
  return rows;
}

function check(ok, detail, violations = []) {
  return { ok, detail, ...(violations.length ? { violations } : {}) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv(args.envPath);

  const baseUrl = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_SERVICE_KEY;
  if (!baseUrl || !apiKey) throw new Error("Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");

  const fetch_ = (table, select, filters) => fetchAll(baseUrl, apiKey, table, select, filters);

  const [teams, riders, activeAuctions, openListings, financeRows, notifRows, activeLoans] = await Promise.all([
    fetch_("teams", "id,division,is_ai,is_frozen,is_bank"),
    fetch_("riders", "id,team_id"),
    fetch_("auctions", "id,rider_id,status", { status: "in.(active,extended)" }),
    fetch_("transfer_listings", "id,rider_id,status", { status: "eq.open" }),
    fetch_("finance_transactions", "type"),
    fetch_("notifications", "type"),
    fetch_("loans", "team_id,amount_remaining,loan_type", { status: "eq.active" }),
  ]);

  const humanTeams = teams.filter(t => !t.is_ai && !t.is_frozen && !t.is_bank);
  const humanTeamIds = new Set(humanTeams.map(t => t.id));
  const divisionOf = new Map(humanTeams.map(t => [t.id, t.division]));

  // Check 1: Ingen rytter med to samtidige aktive auktioner
  const auctionCount = new Map();
  for (const a of activeAuctions) {
    auctionCount.set(a.rider_id, (auctionCount.get(a.rider_id) || 0) + 1);
  }
  const doubleAuctions = [...auctionCount.entries()]
    .filter(([, n]) => n > 1)
    .map(([riderId, n]) => ({ riderId, count: n }));

  // Check 2: Trupstørrelse overskrider ikke max for divisionen (tæller kun human teams)
  const squadSize = new Map();
  for (const r of riders) {
    if (r.team_id && humanTeamIds.has(r.team_id)) {
      squadSize.set(r.team_id, (squadSize.get(r.team_id) || 0) + 1);
    }
  }
  const oversized = [];
  for (const [teamId, count] of squadSize.entries()) {
    const div = divisionOf.get(teamId);
    const max = SQUAD_MAX[div];
    if (max !== undefined && count > max) oversized.push({ teamId, division: div, count, max });
  }

  // Check 3: Finance transaction types er alle kendte
  const unknownTxTypes = [...new Set(financeRows.map(r => r.type))]
    .filter(t => !KNOWN_TX_TYPES.has(t));

  // Check 4: Notification types er alle kendte
  const unknownNotifTypes = [...new Set(notifRows.map(r => r.type))]
    .filter(t => !KNOWN_NOTIF_TYPES.has(t));

  // Check 5: Aktiv finance-gæld overskrider ikke divisionsloft
  const debtByTeam = new Map();
  for (const loan of activeLoans) {
    if (humanTeamIds.has(loan.team_id)) {
      debtByTeam.set(loan.team_id, (debtByTeam.get(loan.team_id) || 0) + Number(loan.amount_remaining));
    }
  }
  const debtBreaches = [];
  for (const [teamId, debt] of debtByTeam.entries()) {
    const div = divisionOf.get(teamId);
    const ceiling = DEBT_CEILING[div];
    if (ceiling !== undefined && debt > ceiling) debtBreaches.push({ teamId, division: div, debt, ceiling });
  }

  // Check 6: Ingen rytter er i både aktiv auktion og åben transferliste
  const activeAuctionRiders = new Set(activeAuctions.map(a => a.rider_id));
  const openListingRiders = new Set(openListings.map(l => l.rider_id));
  const doubleMarket = [...activeAuctionRiders]
    .filter(id => openListingRiders.has(id))
    .map(riderId => ({ riderId }));

  const checks = {
    no_double_active_auctions: check(
      doubleAuctions.length === 0,
      doubleAuctions.length === 0
        ? `OK — ${activeAuctions.length} aktive auktioner`
        : `${doubleAuctions.length} rytter(e) har 2+ aktive auktioner`,
      doubleAuctions
    ),
    squad_within_max: check(
      oversized.length === 0,
      oversized.length === 0
        ? `OK — ${humanTeams.length} hold kontrolleret`
        : `${oversized.length} hold overskrider max-trupgrænse`,
      oversized
    ),
    finance_types_known: check(
      unknownTxTypes.length === 0,
      unknownTxTypes.length === 0
        ? `OK — ${KNOWN_TX_TYPES.size} kendte typer`
        : `Ukendte typer: ${unknownTxTypes.join(", ")}`,
      unknownTxTypes.map(t => ({ type: t }))
    ),
    notification_types_known: check(
      unknownNotifTypes.length === 0,
      unknownNotifTypes.length === 0
        ? `OK — ${KNOWN_NOTIF_TYPES.size} kendte typer`
        : `Ukendte typer: ${unknownNotifTypes.join(", ")}`,
      unknownNotifTypes.map(t => ({ type: t }))
    ),
    debt_within_ceiling: check(
      debtBreaches.length === 0,
      debtBreaches.length === 0
        ? `OK — ${debtByTeam.size} hold med aktive lån kontrolleret`
        : `${debtBreaches.length} hold overskrider gældsloft`,
      debtBreaches
    ),
    no_double_market_listing: check(
      doubleMarket.length === 0,
      doubleMarket.length === 0
        ? `OK — ${activeAuctions.length} auktioner, ${openListings.length} transferlistinger`
        : `${doubleMarket.length} rytter(e) er i både aktiv auktion og åben transferliste`,
      doubleMarket
    ),
  };

  const failed = Object.entries(checks).filter(([, c]) => !c.ok);

  if (args.format === "json") {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), checks }, null, 2));
  } else {
    console.log(`\nverify-invariants — ${new Date().toISOString()}\n`);
    for (const [name, c] of Object.entries(checks)) {
      console.log(`  ${c.ok ? "[ok]  " : "[FEJL]"} ${name}: ${c.detail}`);
    }
    if (failed.length) {
      console.log(`\n${failed.length} invariant(er) brudt. Kør med --json for detaljer.\n`);
    } else {
      console.log("\nAlle invarianter holder.\n");
    }
  }

  if (failed.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(`[fatal] ${err.message}`);
  process.exitCode = 1;
});

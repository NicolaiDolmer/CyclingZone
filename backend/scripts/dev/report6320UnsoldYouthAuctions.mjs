// #6320 · READ-ONLY rapport: usolgte auktioner på egen akademirytter (U23/junior)
// der fejlagtigt endte med oprykning eller frigivelse.
//
// ROD-ÅRSAG (verificeret i kode 10/10)
//   #3650 (17/8) lod et hold sætte sin EGEN akademirytter på auktion som et
//   frivilligt salg. #4495 (6/9) tilføjede en udgang for usolgte GRADUATE-
//   auktioner (resolveUnsoldGraduate: oprykning hvis plads+råd, ellers fri agent)
//   — men grenen i auctionFinalization.js var gated på formen (sellerOwned,
//   is_youth=false, rider.is_academy=true), ikke på at auktionen faktisk var en
//   graduate-auktion. Et frivilligt salg uden bud ramte derfor samme udgang.
//
// HVAD SCRIPTET GØR
//   Kun læsning. Ingen skrivning til databasen, intet apply-flag.
//   1. Henter usolgte, ikke-garanterede senior-auktioner (is_youth=false,
//      status=completed, ingen budgiver) oprettet siden #3650.
//   2. Finder om #4495-udgangen fyrede: en academy_graduated-notifikation for
//      rytteren med messageCode unsoldPromoted/unsold, tæt på auktionens slut.
//   3. Afgør om auktionen var en ÆGTE graduate-auktion: en academy_graduation-
//      række for (sælger, rytter) i status sold/promoted/released, afgjort
//      omkring auktionens oprettelse eller slut (createGraduateAuction stempler
//      'sold' ved oprettelsen; restampSoldGraduation restempler ved slut).
//   4. Klassificerer hver auktion og rytterens NUVÆRENDE tilstand.
//
// OUTPUT
//   Konsol + docs/snapshots/6320/dry-run-<tid>.md: kun samlede tal (repoet er
//   offentligt — ingen navne, hold eller id'er).
//   balance-internals/6320/ (gitignoreret): fuld detalje med navne og id'er.
//
//   node backend/scripts/dev/report6320UnsoldYouthAuctions.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../../..");
export const PRIVATE_DIR = join(REPO_ROOT, "balance-internals", "6320");
export const PUBLIC_DIR = join(REPO_ROOT, "docs", "snapshots", "6320");

// #3650 landede 17/8 (bf79dac75); #4495-udgangen 6/9 (c2244ca62). Vi scanner fra
// #3650, så også frivillige salg fra før udgangen fandtes tælles som "rørt ikke".
export const SINCE_ISO = "2026-08-17T16:14:37.000Z";
export const EXIT_INTRODUCED_ISO = "2026-09-06T19:24:37.000Z";

// Hvor tæt på auktionens slut en academy_graduated-besked skal ligge for at
// tilskrives auktionens finalize (samme request; cron-retry kan forsinke lidt).
export const NOTIFICATION_WINDOW_MS = 30 * 60 * 1000;
// Vindue omkring oprettelse/slut hvor en grad-række regnes for auktionens egen.
export const GRAD_WINDOW_MS = 30 * 60 * 1000;

export const EXIT_CODES = Object.freeze({
  "notif.academyGraduated.unsoldPromoted": "promoted",
  "notif.academyGraduated.unsold": "released",
});

const GRAD_AUCTION_STATUSES = new Set(["sold", "promoted", "released"]);

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const within = (t, center, windowMs) => Number.isFinite(t) && Number.isFinite(center) && Math.abs(t - center) <= windowMs;

/** Fyrede #4495-udgangen for denne auktion? → 'promoted' | 'released' | null */
export function detectExit(auction, notifications = []) {
  const end = ms(auction.actual_end);
  const hits = notifications
    .filter((n) => n.related_id === auction.rider_id)
    .filter((n) => EXIT_CODES[n.metadata?.messageCode])
    .filter((n) => {
      const t = ms(n.created_at);
      return Number.isFinite(end) && t >= end - 2 * 60 * 1000 && t <= end + NOTIFICATION_WINDOW_MS;
    })
    .sort((a, b) => ms(a.created_at) - ms(b.created_at));
  return hits.length ? EXIT_CODES[hits[0].metadata.messageCode] : null;
}

/** Var auktionen en ægte graduate-auktion (grad-række bag sig)? */
export function isGraduateAuction(auction, gradRows = []) {
  const created = ms(auction.created_at);
  const end = ms(auction.actual_end);
  return gradRows.some((g) =>
    g.team_id === auction.seller_team_id
    && g.rider_id === auction.rider_id
    && GRAD_AUCTION_STATUSES.has(g.status)
    && (within(ms(g.resolved_at), created, GRAD_WINDOW_MS) || within(ms(g.resolved_at), end, GRAD_WINDOW_MS)));
}

/** Grad-række restemplet til promoted/released ved auktionens slut → det udfald. */
export function restampedExit(auction, gradRows = []) {
  const end = ms(auction.actual_end);
  const hit = gradRows.find((g) =>
    g.team_id === auction.seller_team_id
    && g.rider_id === auction.rider_id
    && (g.status === "promoted" || g.status === "released")
    && within(ms(g.resolved_at), end, GRAD_WINDOW_MS));
  return hit ? hit.status : null;
}

/** Rytterens nuværende tilstand set fra sælgerens side. */
export function currentState(auction, rider) {
  if (!rider) return "rider_missing";
  if (rider.is_retired) return "retired";
  if (rider.team_id === null || rider.team_id === undefined) return "free_agent";
  if (rider.team_id === auction.seller_team_id) {
    return rider.is_academy ? "on_seller_academy" : "on_seller_senior";
  }
  return "other_team";
}

/**
 * Klassificér én usolgt auktion.
 *   graduate_exit      — ægte graduate-auktion, udgangen fyrede (tilsigtet, #4495)
 *   graduate_no_exit   — ægte graduate-auktion, ingen udgang fundet (fx før 6/9)
 *   wrongly_exited     — #6320: frivilligt salg, men udgangen fyrede alligevel
 *   untouched          — frivilligt/almindeligt salg, ingen udgang (korrekt)
 */
export function classifyAuction(auction, { rider, gradRows, notifications }) {
  const graduate = isGraduateAuction(auction, gradRows);
  // For en graduate-auktion er restemplingen (sold → promoted/released ved
  // auktionens slut) også bevis for udgangen, selv hvis beskeden mangler.
  const exit = detectExit(auction, notifications) ?? (graduate ? restampedExit(auction, gradRows) : null);
  let category;
  if (graduate) category = exit ? "graduate_exit" : "graduate_no_exit";
  else category = exit ? "wrongly_exited" : "untouched";
  return {
    auction_id: auction.id,
    rider_id: auction.rider_id,
    seller_team_id: auction.seller_team_id,
    created_at: auction.created_at,
    actual_end: auction.actual_end,
    after_exit_introduced: ms(auction.actual_end) >= ms(EXIT_INTRODUCED_ISO),
    category,
    exit,
    state_now: currentState(auction, rider),
  };
}

export function buildReport({ auctions, ridersById, gradRows, notifications }) {
  const rows = auctions.map((a) => classifyAuction(a, {
    rider: ridersById.get(a.rider_id) ?? null,
    gradRows,
    notifications,
  }));
  const counts = {};
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1;
  const wrongly = rows.filter((r) => r.category === "wrongly_exited");
  const wronglyByExit = { promoted: 0, released: 0 };
  const wronglyByState = {};
  for (const r of wrongly) {
    wronglyByExit[r.exit] += 1;
    wronglyByState[r.state_now] = (wronglyByState[r.state_now] ?? 0) + 1;
  }
  const affectedTeams = new Set(wrongly.map((r) => r.seller_team_id)).size;
  // En rytter kan være ramt flere gange (sat på auktion igen efter en oprykning).
  const affectedRiders = new Set(wrongly.map((r) => r.rider_id)).size;
  return { rows, counts, wronglyByExit, wronglyByState, affectedTeams, affectedRiders, total: rows.length };
}

const STATE_LABELS = {
  free_agent: "stadig fri agent",
  other_team: "på et andet hold nu",
  on_seller_senior: "på sælgerens seniortrup",
  on_seller_academy: "tilbage i sælgerens akademi",
  retired: "stoppet",
  rider_missing: "rytter ikke fundet",
};

/** Offentlig opsummering: KUN tal, ingen navne/hold/id'er (repoet er offentligt). */
export function renderPublicSummary(report, { generatedAt }) {
  const c = report.counts;
  const lines = [
    `# #6320 dry-run (read-only) ${generatedAt}`,
    "",
    "Usolgte, ikke-garanterede senior-auktioner (is_youth=false, ingen bud) oprettet siden #3650.",
    "Ingen skrivning til databasen. Detaljer med navne ligger kun i balance-internals/6320/.",
    "",
    `- Auktioner scannet: ${report.total}`,
    `- Ægte graduate-auktion, udgang fyrede (tilsigtet, #4495): ${c.graduate_exit ?? 0}`,
    `- Ægte graduate-auktion, ingen udgang fundet: ${c.graduate_no_exit ?? 0}`,
    `- **Frivilligt salg ramt af udgangen (#6320): ${c.wrongly_exited ?? 0}** (ryttere: ${report.affectedRiders}, hold: ${report.affectedTeams})`,
    `  - rykket op uden managerens valg: ${report.wronglyByExit.promoted}`,
    `  - frigivet som fri agent: ${report.wronglyByExit.released}`,
    `- Usolgt uden udgang (korrekt adfærd): ${c.untouched ?? 0}`,
    "",
    "Ramte auktioners rytter, tilstand nu (pr. auktion):",
  ];
  const states = Object.entries(report.wronglyByState);
  if (states.length === 0) lines.push("- (ingen)");
  for (const [state, n] of states.sort()) lines.push(`- ${STATE_LABELS[state] ?? state}: ${n}`);
  lines.push("", "Ingen apply i dette script. En evt. reparation er en separat ejer-beslutning.");
  return `${lines.join("\n")}\n`;
}

/** Privat rapport (gitignoreret): fuld detalje. */
export function renderPrivateReport(report, { generatedAt, ridersById, teamsById }) {
  const lines = [`# #6320 privat detalje ${generatedAt}`, ""];
  const sorted = [...report.rows].sort((a, b) => a.category.localeCompare(b.category) || ms(a.actual_end) - ms(b.actual_end));
  for (const r of sorted) {
    const rider = ridersById.get(r.rider_id);
    const team = teamsById.get(r.seller_team_id);
    lines.push(
      `- [${r.category}${r.exit ? `/${r.exit}` : ""}] ${rider ? `${rider.firstname} ${rider.lastname}` : "?"} (${r.rider_id})`
      + ` · sælger ${team?.name ?? "?"} (${r.seller_team_id}) · slut ${r.actual_end} · nu: ${r.state_now}`
      + `${rider?.team_id && rider.team_id !== r.seller_team_id ? ` (hold ${teamsById.get(rider.team_id)?.name ?? rider.team_id})` : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function loadData(supabase) {
  const auctions = await fetchAllRows(() => supabase
    .from("auctions")
    .select("id, rider_id, seller_team_id, created_at, actual_end, status, is_youth, is_guaranteed_sale, current_bidder_id")
    .eq("status", "completed")
    .eq("is_youth", false)
    .eq("is_guaranteed_sale", false)
    .is("current_bidder_id", null)
    .not("seller_team_id", "is", null)
    .gte("created_at", SINCE_ISO)
    .order("id"));

  const riderIds = [...new Set(auctions.map((a) => a.rider_id).filter(Boolean))];
  const riders = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("riders")
    .select("id, firstname, lastname, team_id, is_academy, squad, is_retired")
    .in("id", chunk)
    .order("id"));
  const gradRows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("academy_graduation")
    .select("id, team_id, rider_id, status, created_at, resolved_at")
    .in("rider_id", chunk)
    .order("id"));
  const notifications = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("notifications")
    .select("id, related_id, type, created_at, metadata")
    .eq("type", "academy_graduated")
    .in("related_id", chunk)
    .gte("created_at", SINCE_ISO)
    .order("id"));

  const teamIds = [...new Set([
    ...auctions.map((a) => a.seller_team_id),
    ...riders.map((r) => r.team_id),
  ].filter(Boolean))];
  const teams = await fetchAllRowsChunkedIn(teamIds, (chunk) => supabase
    .from("teams")
    .select("id, name")
    .in("id", chunk)
    .order("id"));

  return {
    auctions,
    ridersById: new Map(riders.map((r) => [r.id, r])),
    gradRows,
    notifications,
    teamsById: new Map(teams.map((t) => [t.id, t])),
  };
}

async function main() {
  const dotenv = await import("dotenv");
  dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const data = await loadData(supabase);
  const report = buildReport(data);

  const summary = renderPublicSummary(report, { generatedAt });
  mkdirSync(PUBLIC_DIR, { recursive: true });
  mkdirSync(PRIVATE_DIR, { recursive: true });
  const publicPath = join(PUBLIC_DIR, `dry-run-${stamp}.md`);
  const privatePath = join(PRIVATE_DIR, `dry-run-${stamp}.md`);
  writeFileSync(publicPath, summary, "utf8");
  writeFileSync(privatePath, renderPrivateReport(report, { generatedAt, ...data }), "utf8");
  writeFileSync(join(PRIVATE_DIR, `dry-run-${stamp}.json`), JSON.stringify(report, null, 2), "utf8");

  console.log(summary);
  console.log(`Offentlig opsummering: ${publicPath}`);
  console.log(`Privat detalje:        ${privatePath}`);
  console.log("Read-only: intet skrevet til databasen.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(`FEJL: ${err.message}`); process.exitCode = 1; });
}

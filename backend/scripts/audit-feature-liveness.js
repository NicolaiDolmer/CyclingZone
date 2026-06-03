#!/usr/bin/env node
// Backwards-audit der finder "deployed kode + 0 data / 0 brugere"-mønstret.
//
// Generaliserer slice 14 / #279 lærepenge-mønstret til 4 detector-klasser:
//
//   A — write-but-no-data
//       Tabel har 0 rows i prod, men backend har INSERT/UPSERT-paths.
//       Indikerer en write-flow der aldrig udløses (eller stilfærdigt
//       rollbacker). Whitelist for tabeller der naturligt er tomme efter
//       beta-reset eller før første sæsonkørsel.
//
//   B — orphaned-endpoints
//       Backend Express-endpoint findes, men ingen frontend-caller.
//       Indikerer død API. Whitelist for cron-trigger / admin-only / webhook.
//
//   C — migration-drift
//       Forskel mellem committed `database/*.sql` og applied
//       `schema_migrations.filename` (begge veje).
//
//   D — schema-drift
//       Prod-tabeller uden tilsvarende `CREATE TABLE` i `database/*.sql`.
//       Slice 14-mønstret: Studio-oprettet tabel uden migration.
//
//   E — zero-impression-features
//       Event listet i frontend/src/lib/logEvent.js KNOWN_EVENTS men 0 events
//       i public.player_events sidste 30 dage. Fanger slice 14-mønstret for
//       frontend-only features (hvor Detector A ikke kan se en backend-insert).
//
// Usage:
//   node backend/scripts/audit-feature-liveness.js              # human-readable
//   node backend/scripts/audit-feature-liveness.js --json       # JSON for CI
//   node backend/scripts/audit-feature-liveness.js --strict     # exit 1 ved findings
//   node backend/scripts/audit-feature-liveness.js --only=A,C   # vælg detectors
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role required)
// Requires: helper RPCs i database/2026-05-10-feature-liveness-helper.sql.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSupabaseAuditError } from "./audit-error-classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const FRONTEND_SRC = join(REPO_ROOT, "frontend", "src");
const BACKEND_DIR = join(REPO_ROOT, "backend");
const DATABASE_DIR = join(REPO_ROOT, "database");
const ROUTES_FILE = join(REPO_ROOT, "backend", "routes", "api.js");
const SERVER_FILE = join(REPO_ROOT, "backend", "server.js");
const LOG_EVENT_FILE = join(REPO_ROOT, "frontend", "src", "lib", "logEvent.js");
const IMPRESSION_WINDOW_DAYS = 30;

dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const STRICT = args.includes("--strict");
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice("--only=".length).toUpperCase().split(",")) : null;
const skipArg = args.find((a) => a.startsWith("--skip="));
const SKIP = skipArg ? new Set(skipArg.slice("--skip=".length).toUpperCase().split(",")) : new Set();
function detectorEnabled(letter) {
  if (SKIP.has(letter)) return false;
  return !ONLY || ONLY.has(letter);
}

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Whitelists
// ---------------------------------------------------------------------------

// Detector A: tabeller der naturligt er tomme i prod (post-reset, sæson-state-tabeller, etc.)
// Halv-permanent: tilføj entry når en finding er bekræftet "intentional empty".
const WHITELIST_EMPTY_TABLES = new Set([
  // Reset af beta-state tømmer disse — de fyldes når sæson 1 + transfer-window kører
  "transfer_offers",
  "swap_offers",
  "race_results",
  "season_standings",
  "hall_of_fame",
  // Pending-imports er per-batch state — tomme uden for active import
  "pending_race_results",
  "pending_race_result_rows",
  // Board-tabeller er milestone-gated (skriv-paths fyrer ved sæson-end / manager-action).
  // Bekræftet i b53d831 + #284 — ikke broken, sæson 1 starter ~2026-05-15.
  "board_consequences",
  "board_request_log",
  "team_board_members",
  // Besøgs-log (#963) — bevidst tom ved oprettelse. Fyldes når PR #992-koden er
  // deployet og rigtige brugere åbner rytter-profiler; hele pointen er at BEGYNDE
  // at opsamle nu, så popularitet (#957) har historik. Skriv-path verificeret i
  // POST /api/riders/:id/view. Fjern denne whitelist-entry når tabellen har rows.
  "rider_profile_views",
]);

// Detector B: endpoints der er korrekt orphaned i frontend (cron, admin-curl, webhook)
// Match-form: HTTP method + path-pattern (samme som routes-listen).
const WHITELIST_ORPHANED_ENDPOINTS = new Set([
  // Cron / scheduled jobs (kaldes fra backend/cron.js eller eksterne hooks)
  "POST /admin/finalize-expired-auctions",
  "POST /admin/sync-dyn-cyclist",
  "POST /admin/import-results-sheets",
  "POST /admin/pay-prizes-to-date",
  "POST /admin/sync-uci",
  "POST /auctions/:id/finalize",
  // Health / probe
  "GET /health",
  // Admin-only via curl/admin-page-future-wiring (cancel-tools fra adminRouteOwnership-kontrakt #97)
  "POST /admin/transfers/offers/:id/cancel",
  "POST /admin/transfers/swaps/:id/cancel",
  "POST /admin/loans/:id/cancel",
  "POST /admin/race-pool/import-csv",
  // Admin-only operational tooling — baseline-måling og incident-triage for in-process response cache (#334)
  "GET /admin/cache-stats",
  // Frontend læser direkte via Supabase (RLS-gated read-paths) — endpoint er en parallel
  // backend-route der p.t. ikke bruges. Cleanup-kandidat (separat issue).
  "GET /riders",
  "GET /riders/:id",
  "GET /races",
  "GET /race-points",
  "GET /admin/users",
  "GET /achievements",
  // Frontend opdaterer notifications direkte via supabase.from("notifications").update(...)
  // Backend-PATCH er parallel implementation (cleanup-kandidat).
  "PATCH /notifications/:id/read",
  "PATCH /notifications/read-all",
  // Board DNA-suggestions: backend-route findes, men frontend wiring afventer
  // board-feature-rollout (milestone-gated, samme spor som board_consequences).
  "GET /board/dna-suggestions",
]);

// Detector C: schema-files der er committed men IKKE migrations (pre-workflow dumps).
const WHITELIST_NON_MIGRATION_SQL = new Set([
  "database/schema.sql",
  "database/supabase_setup.sql",
]);

// Detector E: events listet i KNOWN_EVENTS men som vi p.t. accepterer 0 impressions for
// (fx nye events tilføjet uden at være shipped endnu, eller events på milestone-gated
// features). Tilføj entry når en finding er bekræftet "intentional zero".
const WHITELIST_ZERO_IMPRESSION_EVENTS = new Set([
  // Board consequences er milestone-gated (#284): eventet fyrer først når
  // season-end consequences findes. Forventet naturlige impressions efter
  // sæson 1-start omkring 2026-05-15.
  "feature_board_consequences_panel_viewed",
  // Survey-CTA-banner (#364) er gated bag admin-preview via app_config-flag
  // indtil Tally-URL flippes (sprint uge 1 ons/tor). Naturlige impressions
  // begynder efter flag-flip — fjern denne entry når banner går live for alle.
  "survey_banner_dismissed",
]);

// Detector D: prod-tabeller vi accepterer uden CREATE TABLE i repo
// (legacy fra før migration-workflow blev sat op 2026-05-04 — tabellerne blev
// oprettet via Supabase Studio. Dokumenteret backfill-arbejde tracket separat).
const WHITELIST_PROD_ONLY_TABLES = new Set([
  "schema_migrations", // bookkeeping selv
  // Legacy Studio-oprettede tabeller (pre-2026-05-04). Backfill tracket separat.
  "achievements",
  "admin_log",
  "hall_of_fame",
  "loan_config",
  "loans",
  "manager_achievements",
  "pending_race_result_rows",
  "pending_race_results",
  "prize_tables",
  "race_classes",
  "rider_stat_history",
  "rider_uci_history",
  "rider_watchlist",
  "transfer_windows",
  "xp_log",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function walk(dir, predicate) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path, predicate)));
    else if (predicate(entry.name)) out.push(path);
  }
  return out;
}

function relPath(p) {
  return relative(REPO_ROOT, p).replaceAll("\\", "/");
}

// ---------------------------------------------------------------------------
// Detector A — write-but-no-data
// ---------------------------------------------------------------------------

async function fetchTableCounts() {
  const { data, error } = await supabase.rpc("feature_liveness_table_counts");
  if (error) {
    throw new Error(formatSupabaseAuditError(
      "feature_liveness_table_counts RPC",
      error,
      "Apply database/2026-05-10-feature-liveness-helper.sql first."
    ));
  }
  return data || [];
}

async function findBackendInsertPaths() {
  const files = await walk(BACKEND_DIR, (n) => /\.(jsx?|tsx?)$/.test(n) && !n.endsWith(".test.js"));
  // Match supabase.from("X").insert/upsert — pattern tillader optional method-chain mellem from() og insert()
  const re = /supabase\s*\.\s*from\s*\(\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*\)[\s\S]{0,400}?\.\s*(insert|upsert)\s*\(/g;
  const refs = new Map();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    let m;
    while ((m = re.exec(text)) !== null) {
      const table = m[1];
      if (!refs.has(table)) refs.set(table, new Set());
      refs.get(table).add(relPath(file));
    }
  }
  return refs;
}

async function detectorA() {
  const [counts, insertPaths] = await Promise.all([
    fetchTableCounts(),
    findBackendInsertPaths(),
  ]);
  const findings = [];
  for (const row of counts) {
    if (row.row_count > 0) continue;
    if (WHITELIST_EMPTY_TABLES.has(row.table_name)) continue;
    const paths = insertPaths.get(row.table_name);
    if (!paths || paths.size === 0) continue; // ingen backend-write — ikke vores problem
    findings.push({
      detector: "A",
      severity: "warning",
      table: row.table_name,
      reason: "Tabel har 0 rows men backend har INSERT/UPSERT-paths",
      backend_files: [...paths].sort(),
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector B — orphaned-endpoints
// ---------------------------------------------------------------------------

async function listBackendEndpoints() {
  const out = [];
  // routes/api.js — mounted under /api
  const routesText = await readFile(ROUTES_FILE, "utf8");
  const routesRe = /^\s*router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gm;
  let m;
  while ((m = routesRe.exec(routesText)) !== null) {
    const method = m[1].toUpperCase();
    const path = m[2];
    out.push({ method, path });
  }
  // server.js — direkte app.<verb> mounts (også /api-prefixed)
  const serverText = await readFile(SERVER_FILE, "utf8");
  const serverRe = /\bapp\.(get|post|put|delete|patch)\s*\(\s*['"`](\/api\/[^'"`]+)['"`]/g;
  while ((m = serverRe.exec(serverText)) !== null) {
    const method = m[1].toUpperCase();
    // Strip /api prefix så de matcher routes/api.js-paths
    const path = m[2].replace(/^\/api/, "");
    out.push({ method, path });
  }
  return out;
}

async function findFrontendApiCalls() {
  const files = await walk(FRONTEND_SRC, (n) => /\.(jsx?|tsx?)$/.test(n));
  // Match enhver template-literal med `${X}/api/...` form — fanger både inline
  // fetch() og URL-built-then-fetched-mønstret hvor URL'en konstrueres på en
  // tidligere linje. Excluder PatchNotesPage for at undgå markdown-eksempler.
  const re = /[`'"]\$\{[^}]+\}\/api\/([^`'"?\s,]+)/g;
  const calls = new Set();
  for (const file of files) {
    if (file.endsWith("PatchNotesPage.jsx")) continue;
    const text = await readFile(file, "utf8");
    let m;
    while ((m = re.exec(text)) !== null) {
      // Strip query-strings og template-expressions; behold path-segmentet
      let path = "/" + m[1].replace(/\$\{[^}]+\}/g, ":param");
      path = path.replace(/\/$/, "");
      calls.add(path);
    }
  }
  return calls;
}

// Tokenize til segmenter; placeholdere (`:foo` eller frontend `:param`) bliver til `*` (wildcard).
function tokenize(path) {
  return path.split("/").filter(Boolean).map((s) => (s.startsWith(":") ? "*" : s));
}

// Bidirektionel match med wildcard-tolerance: hvis enten frontend eller backend
// har `*` på en position, tæller positionen som match. Det fanger frontend-koder
// som `${API}/api/admin/seasons/${seasonId}/${action}` der dækker både `start` og `end`.
function endpointMatchesAny(endpoint, callTokens) {
  const epSegs = tokenize(endpoint.path);
  for (const callSegs of callTokens) {
    if (callSegs.length !== epSegs.length) continue;
    let allMatch = true;
    for (let i = 0; i < epSegs.length; i++) {
      const a = epSegs[i];
      const b = callSegs[i];
      if (a === "*" || b === "*") continue;
      if (a !== b) { allMatch = false; break; }
    }
    if (allMatch) return true;
  }
  return false;
}

async function detectorB() {
  const [endpoints, calls] = await Promise.all([
    listBackendEndpoints(),
    findFrontendApiCalls(),
  ]);
  const callTokens = [...calls].map(tokenize);
  const findings = [];
  for (const ep of endpoints) {
    const key = `${ep.method} ${ep.path}`;
    if (WHITELIST_ORPHANED_ENDPOINTS.has(key)) continue;
    if (endpointMatchesAny(ep, callTokens)) continue;
    findings.push({
      detector: "B",
      severity: "info",
      method: ep.method,
      path: ep.path,
      reason: "Backend-endpoint uden frontend-caller",
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector C — migration-drift
// ---------------------------------------------------------------------------

async function listCommittedMigrations() {
  const files = await readdir(DATABASE_DIR);
  return files
    .filter((f) => f.endsWith(".sql"))
    .map((f) => `database/${f}`)
    .sort();
}

async function listAppliedMigrations() {
  const { data, error } = await supabase.rpc("feature_liveness_applied_migrations");
  if (error) {
    throw new Error(formatSupabaseAuditError(
      "feature_liveness_applied_migrations RPC",
      error,
      "Apply database/2026-05-10-feature-liveness-helper.sql first."
    ));
  }
  return (data || []).map((r) => r.filename).sort();
}

async function detectorC() {
  const [committed, applied] = await Promise.all([
    listCommittedMigrations(),
    listAppliedMigrations(),
  ]);
  const committedSet = new Set(committed);
  const appliedSet = new Set(applied);
  const findings = [];
  for (const f of committed) {
    if (WHITELIST_NON_MIGRATION_SQL.has(f)) continue;
    if (!appliedSet.has(f)) {
      findings.push({
        detector: "C",
        severity: "warning",
        filename: f,
        reason: "Migration committed men ikke applied i prod (schema_migrations)",
      });
    }
  }
  for (const f of applied) {
    if (!committedSet.has(f)) {
      findings.push({
        detector: "C",
        severity: "warning",
        filename: f,
        reason: "Applied migration findes ikke i database/ — repo og DB driver",
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector D — schema-drift
// ---------------------------------------------------------------------------

async function listProdTables() {
  const { data, error } = await supabase.rpc("feature_liveness_prod_tables");
  if (error) {
    throw new Error(formatSupabaseAuditError(
      "feature_liveness_prod_tables RPC",
      error,
      "Apply database/2026-05-10-feature-liveness-helper.sql first."
    ));
  }
  return (data || []).map((r) => r.table_name);
}

async function listRepoTables() {
  const files = await readdir(DATABASE_DIR);
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([a-z_][a-z0-9_]*)["']?/gi;
  const tables = new Set();
  for (const f of files) {
    if (!f.endsWith(".sql")) continue;
    const text = await readFile(join(DATABASE_DIR, f), "utf8");
    let m;
    while ((m = re.exec(text)) !== null) {
      tables.add(m[1].toLowerCase());
    }
  }
  return tables;
}

async function detectorD() {
  const [prodTables, repoTables] = await Promise.all([
    listProdTables(),
    listRepoTables(),
  ]);
  const findings = [];
  for (const tbl of prodTables) {
    if (WHITELIST_PROD_ONLY_TABLES.has(tbl)) continue;
    if (repoTables.has(tbl)) continue;
    findings.push({
      detector: "D",
      severity: "warning",
      table: tbl,
      reason: "Prod-tabel uden CREATE TABLE i database/*.sql (Studio-oprettet?)",
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Detector E — zero-impression-features
// ---------------------------------------------------------------------------

async function listKnownEvents() {
  // Parse KNOWN_EVENTS-arrayet ud af logEvent.js — undgår at duplikere listen.
  // Mønster: export const KNOWN_EVENTS = Object.freeze([ ... ]) — eller bare
  // [ ... ] hvis Object.freeze fjernes senere.
  let text;
  try {
    text = await readFile(LOG_EVENT_FILE, "utf8");
  } catch {
    return [];
  }
  const match = text.match(/KNOWN_EVENTS\s*=\s*Object\.freeze\s*\(\s*\[([\s\S]*?)\]\s*\)|KNOWN_EVENTS\s*=\s*\[([\s\S]*?)\]/);
  if (!match) return [];
  const body = match[1] || match[2] || "";
  const events = [];
  const re = /["'`]([a-z_][a-z0-9_]*)["'`]/g;
  let m;
  while ((m = re.exec(body)) !== null) events.push(m[1]);
  return events;
}

async function fetchEventCounts() {
  const { data, error } = await supabase.rpc("feature_liveness_event_counts", {
    window_days: IMPRESSION_WINDOW_DAYS,
  });
  if (error) {
    // RPC eller tabel mangler endnu (PR-run før auto-migrate har kørt) — Detector E
    // skipper gracefully så det ikke blokerer den PR der LANDER selve player_events.
    if (/does not exist|relation .* does not exist|function .* does not exist/i.test(error.message)) {
      return null;
    }
    throw new Error(formatSupabaseAuditError(
      "feature_liveness_event_counts RPC",
      error,
      "Apply database/2026-05-12-player-events-audit-helper.sql first."
    ));
  }
  return data || [];
}

async function detectorE() {
  const [known, counts] = await Promise.all([
    listKnownEvents(),
    fetchEventCounts(),
  ]);
  if (known.length === 0) return [];
  if (counts === null) return []; // helper RPC/table mangler — skip uden at fejle
  const seen = new Map();
  for (const row of counts) seen.set(row.event_name, row);
  const findings = [];
  for (const eventName of known) {
    if (WHITELIST_ZERO_IMPRESSION_EVENTS.has(eventName)) continue;
    const row = seen.get(eventName);
    if (row && row.event_count > 0) continue;
    findings.push({
      detector: "E",
      severity: "warning",
      event_name: eventName,
      reason: `Event listet i KNOWN_EVENTS men 0 impressions sidste ${IMPRESSION_WINDOW_DAYS} dage`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const detectors = [
  detectorEnabled("A") ? detectorA() : Promise.resolve([]),
  detectorEnabled("B") ? detectorB() : Promise.resolve([]),
  detectorEnabled("C") ? detectorC() : Promise.resolve([]),
  detectorEnabled("D") ? detectorD() : Promise.resolve([]),
  detectorEnabled("E") ? detectorE() : Promise.resolve([]),
];
const [findingsA, findingsB, findingsC, findingsD, findingsE] = await Promise.all(detectors);
const allFindings = [...findingsA, ...findingsB, ...findingsC, ...findingsD, ...findingsE];

const summary = {
  generated_at: new Date().toISOString(),
  detectors_run: ["A", "B", "C", "D", "E"].filter(detectorEnabled),
  total_findings: allFindings.length,
  by_detector: {
    A: findingsA.length,
    B: findingsB.length,
    C: findingsC.length,
    D: findingsD.length,
    E: findingsE.length,
  },
  findings: allFindings,
};

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Feature-liveness audit — ${summary.generated_at}`);
  console.log(`Detectors: ${summary.detectors_run.join(", ")}`);
  console.log(`Total findings: ${summary.total_findings} (A=${summary.by_detector.A} B=${summary.by_detector.B} C=${summary.by_detector.C} D=${summary.by_detector.D} E=${summary.by_detector.E})\n`);

  if (findingsA.length > 0) {
    console.log(`Detector A — write-but-no-data (${findingsA.length}):`);
    for (const f of findingsA) {
      console.log(`  ${f.table}`);
      console.log(`    reason: ${f.reason}`);
      console.log(`    backend: ${f.backend_files.join(", ")}`);
    }
    console.log();
  }
  if (findingsB.length > 0) {
    console.log(`Detector B — orphaned-endpoints (${findingsB.length}):`);
    for (const f of findingsB) {
      console.log(`  ${f.method} ${f.path}`);
    }
    console.log();
  }
  if (findingsC.length > 0) {
    console.log(`Detector C — migration-drift (${findingsC.length}):`);
    for (const f of findingsC) {
      console.log(`  ${f.filename}`);
      console.log(`    ${f.reason}`);
    }
    console.log();
  }
  if (findingsD.length > 0) {
    console.log(`Detector D — schema-drift (${findingsD.length}):`);
    for (const f of findingsD) {
      console.log(`  ${f.table}`);
      console.log(`    ${f.reason}`);
    }
    console.log();
  }
  if (findingsE.length > 0) {
    console.log(`Detector E — zero-impression-features (${findingsE.length}):`);
    for (const f of findingsE) {
      console.log(`  ${f.event_name}`);
      console.log(`    ${f.reason}`);
    }
    console.log();
  }
  if (allFindings.length === 0) {
    console.log("OK — no liveness findings.\n");
  }
}

if (STRICT && allFindings.length > 0) process.exit(1);

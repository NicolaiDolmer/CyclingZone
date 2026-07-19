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
  // --- Midlertidige suppressioner (fjern entry når tabellen har rows) ---
  // 2026-07-10 (#2298): 20 stale entries fjernet — deres tabeller har nu rows i prod
  // (race_results 125k, board_satisfaction_events 36k, race_entries 17k, m.fl.),
  // så Detector A dækker dem igen. Historik i issue #2298.
  //
  // hall_of_fame: fyldes først ved sæson-transition (sæson ≥2). Fjern når rows.
  "hall_of_fame",
  // player_feedback: in-game kontakt-/feedback-knap (#2602) shippet 18/7 — 0 rows er
  // forventet indtil første spiller-indsendelse. Fjern entry når tabellen har rows.
  "player_feedback",
  // Race v3-tabeller (race_simulation_rider_scores / race_stage_roles / race_incidents)
  // fjernet fra whitelisten 13/7 efter foerste v3-loebsdag: race_engine_v3_scoring='on'
  // (flippet 12/7 aften), foerste live v2-run 13/7 11:00 CEST stemplede 168 score-rows
  // + 2 incidents. Alle tre tabeller har nu rows i prod og daekkes af Detector A igen
  // (#2224 / #2393). Detector A tjekker total row-count, saa loebsfrie dage giver ikke
  // false positives.
  // Progression L0 (#1137) skriver én row pr. (rytter, sæson) ved season-transition
  // (sæson ≥2 — sæson 1 = launch-baseline). Bevidst tom indtil første transition efter
  // launch fylder den. Skriv-path verificeret i riderProgressionEngine.js. Fjern når
  // tabellen har rows.
  "rider_development_log",
  // Akademi promotion-flow #932 (#1467, merged 18/6): academyGraduation.js skriver
  // graduation-rows (detectGraduates insert) når akademiryttere fylder 22. Tabellen
  // fyldes først når en akademirytter når graduation-alderen. Skriv-path verificeret
  // i academyGraduation.js. Fjern denne entry når tabellen har rows.
  "academy_graduation",
  // CZ Pro billing-rails (#1903, PR #1909 merged 2/7): subscriptions fyldes først når
  // Alunta-checkout/webhook går live (ejer-opsætning: plan + tokens i Infisical +
  // test_mode-verify). Skriv-path verificeret i backend/lib/aluntaWebhook.js
  // (upsert på team_id). Bevidst tom indtil go-live. Fjern denne entry når tabellen har rows.
  "subscriptions",
  // (training_week_plans (#1895) fjernet 11/7 samme aften: tabellen fik sine
  // første rækker — featuren er levende, Detector A overvåger den normalt igen.)
  // (rider_peak_plans (#2224) fjernet 16/7: tabellen fik sine første 4 rows via
  // peak_planner_enabled='beta' — featuren er levende, Detector A overvåger normalt.)
]);

// PERMANENTE tom-tabel-suppressioner (fjernes ALDRIG ved rows — tom = sund
// steady-state). Dræn-til-tom-køer / per-batch transient state; Detector A's
// "write-but-no-data" mis-fyrer på dem by design, og forward-guarden (#2299)
// skal heller ikke flage dem når de kortvarigt har rows.
const PERMANENT_EMPTY_TABLES = new Set([
  // Discord DM-retry-kø (#1115): rows enqueues KUN når en DM fejler og slettes
  // igen når den leveres (processDmOutboxDrain). Tom = alle DM'er leveret.
  // Skriv-path verificeret i discordDmOutbox.js (enqueueDm).
  "discord_dm_outbox",
  // Pending-imports er per-batch state — tomme uden for et aktivt import-run.
  "pending_race_results",
  "pending_race_result_rows",
]);

// Detector B: endpoints der er korrekt orphaned i frontend (cron, admin-curl, webhook)
// Match-form: HTTP method + path-pattern (samme som routes-listen).
const WHITELIST_ORPHANED_ENDPOINTS = new Set([
  // #2455 planner-assistent (PR #2506): HAR en frontend-kalder — usePlanner.js:96
  // kalder mutate("/dismiss-suggestions", "POST") hvor helperen prefikser
  // /peak-plans, så den statiske path-scan kan ikke matche det fulde endpoint.
  // Falsk positiv fra indirektion, ikke et orphan.
  "POST /peak-plans/dismiss-suggestions",
  // Cron / scheduled jobs (kaldes fra backend/cron.js eller eksterne hooks)
  // sync-dyn-cyclist, import-results-sheets og sync-uci fjernet 2026-06-12
  // (#1180 pkt 3-5 / #1179 / #1207) — ruterne eksisterer ikke længere.
  "POST /admin/finalize-expired-auctions",
  "POST /admin/pay-prizes-to-date",
  "POST /auctions/:id/finalize",
  // Stage-by-stage race-motor (WS1 Fase 3): drives by the cron stage-scheduler
  // (backend/cron.js → runAdminSimulateStage) one stage at a time. Also serves as
  // a requireAdmin-gated manual fallback / test-trigger. No frontend caller by
  // design — the full-race admin button (POST /admin/simulate-race) is the UI path;
  // per-stage runs are cron/admin-only. Intentional orphaned, not drift.
  "POST /admin/races/:id/simulate-stage",
  // Discord division-role sync (#2153): admin-trigger for manuel reconcile efter
  // sæson-skift; den daglige cron (backend/cron.js → runDiscordRoleSyncCron) gør
  // arbejdet. Ingen frontend-kalder by design. Intentional orphaned, ikke drift.
  "POST /admin/discord/sync-division-roles",
  // Health / probe
  "GET /health",
  // Admin-only via curl/admin-page-future-wiring (cancel-tools fra adminRouteOwnership-kontrakt #97)
  "POST /admin/transfers/offers/:id/cancel",
  "POST /admin/transfers/swaps/:id/cancel",
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
  // Login-streak: frontend-kaldet fjernet i #1139 (Living World Product Doctrine
  // 2026-06-08) — login-streak er ikke længere et power-/pres-system. Endpointet
  // + login_streak-kolonnen bevares bevidst intakt indtil world-history-erstatningen
  // (#1106/#1112/#1145) er designet, så det er intentional orphaned, ikke drift.
  "POST /login-streak",
  // PCM-resultatindberetning: frontend-UI (submit/approve-tabs + admin PCM-import)
  // fjernet i #1532 (PCM udfases). Backend-endpoints bevares bevidst indtil
  // forever-relaunch-vinduet — legacyRiderRetirement + adminRouteOwnership.test.js
  // afhænger af dem. Intentional orphaned, ikke drift; slettes i WS2-followup.
  "POST /admin/approve-results",
  "POST /admin/import-results-pcm",
  // CZ Pro billing: Alunta-webhook er EKSTERN (kaldes af Alunta efter betaling,
  // ikke af frontend). Intentional orphaned, ikke drift (#1903).
  "POST /billing/alunta-webhook",
  // Faciliteter/staff (#1441 Fase 3 A1): backend-fundament shippet FØR UI'en —
  // alt er dødt bag FACILITIES_ENABLED=false; Klub-UI'en lander i bølge A3 og
  // fjerner disse fra whitelisten. Intentional orphaned indtil da, ikke drift.
  "GET /club/facilities",
  "POST /club/facilities/upgrade",
  "GET /club/staff/candidates",
  "POST /club/staff/hire",
  "POST /club/staff/fire",
  // Race v3 S5 peak-planer (#2224, PR #2419): CRUD-API'et shippet FØR Planner-
  // cockpittet (næste slice wirer UI'et mod disse endpoints). Desuden launch-gated
  // bag peak_planner_enabled=OFF — ingen kalder dem endnu by design. Intentional
  // orphaned indtil Planner-slicen lander; fjern disse fire når UI'et wirer dem.
  "GET /peak-plans",
  "POST /peak-plans",
  "PATCH /peak-plans/:id",
  "DELETE /peak-plans/:id",
  // accept-training (#2224 Planner-slice): wiret af usePlanner via DYNAMISK URL
  // (`/api/peak-plans` + `/${planId}/accept-training`), så den statiske caller-grep
  // ikke matcher path-mønstret. Desuden launch-gated bag peak_planner_enabled.
  "POST /peak-plans/:id/accept-training",
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
  // 2026-07-10 (#2298): 14 stale entries fjernet — deres events flyder nu i
  // player_events (verificeret mod prod, 30-dages vindue). Historik i issue #2298.
  //
  // survey_banner_clicked fjernet fra whitelisten 16/7 (#2467): SurveyBanner.jsx
  // slettet + eventet fjernet fra KNOWN_EVENTS, så entry'en var stale (Detector E
  // tjekker kun events der stadig er i KNOWN_EVENTS).
  // Academy (#1669): academy_graduate fyrer først når en akademirytter når
  // graduation-alderen (samme gating som academy_graduation-tabellen i Detector A).
  // Fjern entry når eventet flyder (tjek player_events).
  "academy_graduate",
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
    // Forward-guard (#2299): en midlertidig whitelist-entry hvis tabel nu HAR
    // rows er stale — flag den, så whitelisten selv-rydder i stedet for at
    // rådne (20/28 entries var forfaldne pr. 2026-07-10, se #2298).
    if (row.row_count > 0) {
      if (WHITELIST_EMPTY_TABLES.has(row.table_name)) {
        findings.push({
          detector: "A",
          severity: "info",
          table: row.table_name,
          rows: row.row_count,
          reason: `Stale whitelist-entry: tabellen har nu ${row.row_count} rows — fjern "${row.table_name}" fra WHITELIST_EMPTY_TABLES`,
        });
      }
      continue;
    }
    if (WHITELIST_EMPTY_TABLES.has(row.table_name)) continue;
    if (PERMANENT_EMPTY_TABLES.has(row.table_name)) continue;
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
// Et segment der blot INDEHOLDER `:param` (fx `board:param` fra `.../board${qs}`,
// hvor qs er en query-string bygget som template-variabel uden separator-`/`)
// bliver også wildcard — ellers falsk-positiver Detector B på ethvert kald der
// suffixer `${qs}` direkte på path'en (#2449-mønstret ramte /races/calendar og
// /peak-plans/board 17/7).
function tokenize(path) {
  return path
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith(":") || s.includes(":param") ? "*" : s));
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
    // Transiente sikkerheds-backups (backup_<slug>_<dato>_*): oprettes FØR destruktive
    // prod-indgreb og slettes efter verifikation — aldrig skema, så de flagges ikke som drift.
    if (tbl.startsWith("backup_")) continue;
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
    const row = seen.get(eventName);
    if (WHITELIST_ZERO_IMPRESSION_EVENTS.has(eventName)) {
      // Forward-guard (#2299): whitelist-entry hvis event nu flyder er stale.
      if (row && row.event_count > 0) {
        findings.push({
          detector: "E",
          severity: "info",
          event_name: eventName,
          reason: `Stale whitelist-entry: eventet har ${row.event_count} impressions sidste ${IMPRESSION_WINDOW_DAYS} dage — fjern "${eventName}" fra WHITELIST_ZERO_IMPRESSION_EVENTS`,
        });
      }
      continue;
    }
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
      if (f.backend_files) console.log(`    backend: ${f.backend_files.join(", ")}`);
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

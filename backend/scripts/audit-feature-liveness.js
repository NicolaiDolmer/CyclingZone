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
  // loan_agreements (rytter-lejeaftaler) er søsterbord til transfer_offers/swap_offers
  // ovenfor: rytter-markeds-state der tømmes af beta-reset (RESET_DELETE_TARGETS i
  // betaResetService.js). Skriv-path verificeret: POST /api/loans (api.js) →
  // insert({status:"pending"}) med fejl surfacet (ingen stilfærdig rollback); frontend
  // når den via TransfersPage NewLoanForm + RiderStatsPage. 0 rows fordi ingen rytter-
  // leje er oprettet endnu i frisk sæson 1 (relaunch 2026-06-18) — ikke broken. Bemærk:
  // lån-bugs #45/#97 er FINANSIELLE lån (loans-tabellen), ikke denne. Fjern når rows.
  "loan_agreements",
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
  // Løbende bestyrelses-tilfredshed event-log (#1451/#1187): boardWeekendFinalization.js
  // upserter én row pr. (board, race) ved board-weekend-finalization — wired ind i begge
  // finalization-stier (raceRunner.simulateRace + pcmResultsImport.importPcmResults), "én
  // opdatering pr. finaliserings-event (typisk = én løbsweekend)". Samme milestone-gating
  // som board-tabellerne ovenfor: bevidst tom indtil første weekend-finalization med et race
  // fylder den (race-motoren er gated bag RACE_ENGINE_V2_ENABLED indtil 20/6-relaunch, #1103).
  // Skriv-path verificeret i boardWeekendFinalization.js. Fjern denne entry når tabellen har rows.
  "board_satisfaction_events",
  // Besøgs-log (#963) — bevidst tom ved oprettelse. Fyldes når PR #992-koden er
  // deployet og rigtige brugere åbner rytter-profiler; hele pointen er at BEGYNDE
  // at opsamle nu, så popularitet (#957) har historik. Skriv-path verificeret i
  // POST /api/riders/:id/view. Fjern denne whitelist-entry når tabellen har rows.
  "rider_profile_views",
  // Light race-motor (#1102) skriver run-snapshots når RACE_ENGINE_V2_ENABLED er ON;
  // flaget er seedet OFF, så tabellen er bevidst tom indtil motoren aktiveres.
  // Skriv-path verificeret i raceRunner.js. Fjern når flag tændes + tabellen har rows.
  "race_simulation_runs",
  // Progression L0 (#1137) skriver én row pr. (rytter, sæson) ved season-transition
  // (sæson ≥2 — sæson 1 = launch-baseline). Bevidst tom indtil første transition efter
  // launch fylder den. Skriv-path verificeret i riderProgressionEngine.js. Fjern når
  // tabellen har rows.
  "rider_development_log",
  // Scouting L1 (#1138) skriver én row pr. scout-handling. Bevidst tom ved oprettelse —
  // fyldes når brugere scouter ryttere (slots/sæson). Skriv-path verificeret i
  // POST /api/scouting/:riderId. Fjern denne whitelist-entry når tabellen har rows.
  "scout_actions",
  // Discord DM-retry-kø (#1115): rows enqueues KUN når en DM fejler og slettes
  // igen når den leveres (processDmOutboxDrain). Tom = sund steady-state — alle
  // DM'er leveret. Detector A's "write-but-no-data" mis-fyrer på dræn-til-tom-
  // køer; fandt den 2026-06-11 efter outboxen var drænet. Skriv-path verificeret
  // i discordDmOutbox.js (enqueueDm).
  "discord_dm_outbox",
  // Race-motor #1306/#1307: startfelt skrives af raceRunner.js (per-hold autopick, #1307) når
  // RACE_ENGINE_V2_ENABLED er ON; flaget er seedet OFF indtil 20/6-relaunch
  // (flag-flip = #1103-checklisten). Fjern når flag tændes + tabellen har rows.
  "race_entries",
  // Form/træthed #1306: raceFatigue.js skriver rytter-condition ved løbsafvikling
  // bag samme RACE_ENGINE_V2_ENABLED-flag. Bevidst tom indtil 20/6-flag-flip (#1103).
  "rider_condition",
  // Stage-kalender (WS1 Fase 3): race_stage_schedule fyldes af backfillRaceScheduledFor.js
  // (insert af ét scheduled_at pr. (race, etape)). Backfill + stage-scheduler er gated bag
  // runtime-flag stage_scheduler_enabled (fail-safe OFF indtil 20/6-relaunch, #1103), så
  // tabellen er bevidst tom indtil flaget flippes og backfillen kører. Skriv-path verificeret
  // i backend/scripts/backfillRaceScheduledFor.js. Fjern denne entry når tabellen har rows.
  "race_stage_schedule",
  // Daglig træning #1305 Fase A: dailyTrainingEngine.js skriver run-log pr.
  // træningsdag, gated af isDailyTrainingEnabled (DB-flag, seedet OFF indtil
  // 20/6-relaunch, #1103). Fjern når flag tændes + tabellen har rows.
  "training_day_runs",
  // Akademi-MVP #1308: academyIntake.js skriver intake-kuld (runAcademyIntake) gated
  // af academy_enabled (DB-flag, seedet OFF indtil 20/6-relaunch, #1103). Tabellen blev
  // oprettet ved Fase A-merge (migration anvendt), men fyldes først når flaget flippes
  // ved relaunch. Skriv-path verificeret i academyIntake.js. Fjern når flag tændes + rows.
  "academy_intake",
  // Akademi promotion-flow #932 (#1467, merged 18/6): academyGraduation.js skriver
  // graduation-rows (detectGraduates insert) når akademiryttere fylder 22, del af
  // det academy_enabled-gatede flow (DB-flag, seedet OFF indtil 20/6-relaunch, #1103).
  // Samme flag-gated mønster som academy_intake ovenfor; tabellen fyldes først ved
  // relaunch. Skriv-path verificeret i academyGraduation.js. Fjern når flag tændes + rows.
  "academy_graduation",
  // Signup-attribution (#679/#1408, genoplivet i #2069/#2079): fire-and-forget upsert
  // kører på FØRSTE team-create (signup-bootstrap) i PUT /api/teams/my, men KUN når
  // klienten sender en attribution-payload med et signal (utm_*/referrer/landing_path) —
  // direkte signups uden UTM/referrer skriver ingen row (buildAttributionRow returnerer
  // null). Tabellen var 100% tom 15/6-2/7 fordi email-confirm var slået til og KUN
  // LoginPage-bootstrappen sendte attribution (#2079's rod-årsag). Fixet 2-3/7: alle tre
  // team-create-stier (LoginPage, Layout-bootstrap, SetupWizardModal) sender nu attribution
  // med user_metadata som cross-device-fallback. De 65 historiske signups er tabt (accepteret).
  // TODO(2026-07-10): fjern denne entry når tabellen har rows (tjek efter TdF-kampagnen 4/7).
  "signup_attribution",
  // In-app NPS (#940, shippet 2026-06-25): nps_responses fyldes KUN når en bruger
  // afgiver et NPS-svar (0-10 + valgfri fritekst). Skriv-path verificeret: klienten
  // insert'er via RLS-policy nps_responses_insert_own (eget user_id, fejl surfacet —
  // ingen stilfærdig rollback); frontend når den via NpsPrompt-toasten der trigges
  // efter første løb-resultat (TeamResultsTab, eget hold). Bevidst tom indtil den
  // første bruger svarer — ikke broken. Samme "write-but-no-data indtil brugerne
  // handler"-mønster som scout_actions ovenfor. Fjern denne entry når
  // tabellen har rows.
  "nps_responses",
  // Afmeld-state (race-hub Fase 0b, #1810): raceWithdrawal.js skriver én row pr.
  // frivillig afmelding (withdraw/reinstate) bag flaget auto_entry_generator_enabled
  // (seedet OFF) — og afmeld-UI'et findes først i race-hub Fase 1. Tabellen blev oprettet
  // ved #1810-merge (migration anvendt) men er bevidst tom indtil afmeldinger sker.
  // Skriv-path verificeret i raceWithdrawal.js. Fjern denne entry når tabellen har rows.
  "race_withdrawals",
  // CZ Pro billing-rails (#1903, PR #1909 merged 2/7): subscriptions fyldes først når
  // Alunta-checkout/webhook går live (ejer-opsætning planlagt senest 6/7: plan + tokens
  // i Infisical + test_mode-verify). Skriv-path verificeret i backend/lib/aluntaWebhook.js
  // (upsert på team_id). Bevidst tom indtil go-live. Fjern denne entry når tabellen har rows.
  "subscriptions",
]);

// Detector B: endpoints der er korrekt orphaned i frontend (cron, admin-curl, webhook)
// Match-form: HTTP method + path-pattern (samme som routes-listen).
const WHITELIST_ORPHANED_ENDPOINTS = new Set([
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
  // begynder efter flag-flip — fjern disse entries når banner går live for alle.
  // Begge events fyrer reelt fra SurveyBanner.jsx (dismissed: linje 111,
  // clicked: linje 105) — survey_banner_clicked whitelistet i #1650 (var listet
  // i KNOWN_EVENTS men 0 impressions fordi banneret kun vises i admin-preview).
  "survey_banner_dismissed",
  "survey_banner_clicked",
  // Academy + training (#1669): events fyrer reelt fra useAcademy.js / useTraining.js,
  // men starter naturligt på 0 indtil de bagvedliggende motorer (academy_enabled,
  // træningsmotoren) er aktive for spillere efter relaunch. Tilføjet til KNOWN_EVENTS
  // i #1669 for canary-dækning; whitelistet her med samme mønster som funnel-events
  // i PR #1660. Fjern hver entry når dens event flyder (tjek player_events).
  "academy_sign",
  "academy_reject",
  "academy_free_agent_sign",
  "academy_graduate",
  "training_focus_set_bulk",
  "training_run_today",
  // Pillar-event (#1168) instrumenteret 2026-06-10 sammen med firing-stien
  // (useTraining.setPlan). Starter naturligt på 0 indtil spillere sætter fokus
  // — fjern entry når events flyder (tjek player_events for training_focus_set).
  "training_focus_set",
  // Aktiverings-funnel (#1583) instrumenteret 2026-06-21 sammen med firing-stierne
  // (LoginPage+DashboardPage signup, DashboardPage onboarding_completed,
  // useAuctionBidding first_bid, RiderStatsPage first_transfer). Starter naturligt
  // på 0 indtil nye signups gennemfører funnellen — fjern hver entry når dens
  // event flyder (tjek player_events).
  "signup",
  "onboarding_completed",
  "first_bid",
  "first_transfer",
  // Funnel-events instrumenteret 2026-06-25 (#940 målebølge) sammen med firing-
  // stierne (team_drafted: DashboardPage når truppen er løbsklar; first_race_
  // result_viewed: TeamResultsTab når en bruger ser sit EGET holds resultater).
  // Starter naturligt på 0 indtil nye managere passerer trinene — fjern hver
  // entry når dens event flyder (tjek player_events).
  "team_drafted",
  "first_race_result_viewed",
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

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
  // race_stage_timelines-suppressionen fjernet 18/8 ~11:10: første etape efter
  // flag-ON skrev sin tidslinje (1 row, 9 events, timeline_version 1 — #2410 S1
  // bevist end-to-end). Detector A dækker tabellen normalt igen.
  //
  // rider_ownership_events: fjernet 18/8 ~14:30 — tabellen fik sine første 18
  // rows samme eftermiddag (ejerskabs-audit-loggen #3582 er live), auditen
  // dækker tabellen normalt igen.
  // discord_race_digest_log: fjernet 7/8 — digestens første kl. 20-kørsel 6/8
  // aften skrev 32 rækker (fix #3475 verificeret), auditen dækker tabellen igen.
  // Forum v1 (#3199): alle fem entries fjernet 7/8 — spillerne tog forummet i
  // brug første døgn (posts/replies/votes/reports har alle rows). Auditen
  // dækker dem igen.
  // season_form_reset_runs: fjernet 23/8 — S2→S3-cutoveren skrev den første
  // claim-række, auditen dækker tabellen igen.
  // email_log (#2725/#2853): var her som en manuel "jeg tjekkede engang"-entry.
  // Flyttet 26/7 (#2985) til FLAG_GATED_EMPTY_TABLES — samme mekanisme som
  // academy_season_intake_runs. Se den registrering for den fulde forklaring;
  // pointen er at auditen nu selv læser app_config.email_loop_enabled ved hver
  // kørsel i stedet for at stole på en kommentar der ikke opdager en flag-flip.
  // (race_stage_passages (#2811) fjernet 27/7 efter instruktionen i entryen selv:
  // første S2-etapedag gav 757 rows, så Sub-2's passage-persistens er bevist
  // levende og Detector A overvåger tabellen normalt igen.)
  // (player_feedback (#2602) fjernet 23/7: første spillerindsendelse landede 23/7
  // 12:07 CEST — skrive-stien er bevist levende, så Detector A overvåger tabellen
  // normalt igen. NB: der findes stadig INGEN læse-flade for indsendelserne, se
  // #2842 — auditen dækker at de ANKOMMER, ikke at de bliver læst.)
  // Race v3-tabeller (race_simulation_rider_scores / race_stage_roles / race_incidents)
  // fjernet fra whitelisten 13/7 efter foerste v3-loebsdag: race_engine_v3_scoring='on'
  // (flippet 12/7 aften), foerste live v2-run 13/7 11:00 CEST stemplede 168 score-rows
  // + 2 incidents. Alle tre tabeller har nu rows i prod og daekkes af Detector A igen
  // (#2224 / #2393). Detector A tjekker total row-count, saa loebsfrie dage giver ikke
  // false positives.
  // (rider_development_log (#1137) fjernet 26/7: S1→S2-transitionen skrev 4.869
  // rows via rider_progression — featuren er levende, Detector A overvåger igen.)
  // (academy_graduation (#932/#1467) fjernet 26/7: 23 graduation-rows landede ved
  // S1→S2-transitionen — featuren er levende, Detector A overvåger igen.)
  // (subscriptions (#1903) fjernet 25/7: første checkout.completed-række landede kl.
  // 17:45 lokal (Alunta-checkout live) — featuren er levende, Detector A overvåger igen.)
  // (training_week_plans (#1895) fjernet 11/7 samme aften: tabellen fik sine
  // første rækker — featuren er levende, Detector A overvåger den normalt igen.)
  // (rider_peak_plans (#2224) fjernet 16/7: tabellen fik sine første 4 rows via
  // peak_planner_enabled='beta' — featuren er levende, Detector A overvåger normalt.)
  //
  // Niveau-korrektionens EJER-GATEDE ENGANGS-KØRSEL (#3449/#3750/#3733, PR #3449
  // merged 19/8): marketValueLevelCorrectionApply.js skriver KUN når ejeren selv
  // kører scriptet med --confirm-apply, OG søndags-gaten er GRØN. Der findes
  // bevidst ingen persisteret "ejeren har godkendt"-app_config-flag (se scriptets
  // header-kommentar) — derfor passer den selv-korrigerende FLAG_GATED_EMPTY_TABLES
  // ikke, kun den statiske whitelist. PR #3449 er desuden selv blokeret af
  // ryttertype-beslutningen i #3570 (se PR-tråden), så 0 rows er den korrekte,
  // forventede tilstand indtil ejeren aktivt fyrer korrektionen. Fjern begge
  // entries den dag scriptet er kørt og tabellerne har rows.
  // (Begge fjernet 23/8: korrektionen (c=0,811) blev fyret på ejer-GO under
  // cutoveren — apply_log og receipts har rows, auditen dækker dem igen.)
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
  // Discord KANAL-retry-kø (#3545, søstertabel til discord_dm_outbox): rows
  // enqueues KUN når en webhook-post overlever inline-retry med en retryable fejl
  // (5xx/429/netværk) og drænes igen af drain-cronen. Tom = alle kanal-poster
  // leveret. Skriv-path verificeret i discordWebhookOutbox.js.
  // Tilføjet 10/8, samme dag migrationen kørte: Detector A flagede tabellen som
  // "write-but-no-data" i det sekund den blev oprettet, hvilket gjorde `audit`
  // rød på alle PR'er — men en tom outbox er hele pointen med en outbox.
  "discord_webhook_outbox",
  // race_stage_claims (#4026/PR #4027, merged 20/8): FLYGTIG claim-tabel mod
  // dobbelt-instans-etapeticks — rækken indsættes ved tick-start og slettes
  // igen ved release, så 0 rows mellem ticks ER den sunde tilstand — og rows
  // UNDER et aktivt tick er også sundt. Flyttet hertil fra
  // WHITELIST_EMPTY_TABLES 21/8 (#4075-sessionen): stale-vagten flagede den
  // som forfalden i det øjeblik et tick tilfældigvis havde aktive claims
  // (25 rows under S2-finalens etapedag). En lækket række ryddes af
  // lease-udløbet i claim-logikken selv.
  "race_stage_claims",
  // Pending-imports er per-batch state — tomme uden for et aktivt import-run.
  "pending_race_results",
  "pending_race_result_rows",
]);

// Detector A: tabeller hvis tomhed er STYRET af et app_config-flag, ikke af en
// engangs-manuel-verifikation. I modsætning til WHITELIST_EMPTY_TABLES (statisk,
// "fjern entry når tabellen får rows" — kræver at nogen husker at rydde op) er
// denne selv-korrigerende: auditen læser flagets LIVE værdi i app_config ved
// HVER kørsel (fetchAppConfigFlags). Flag "off" (eller fraværende — fail-safe,
// spejrer featureStage.js/emailLoopFlag.js) → tom tabel er den forventede
// tilstand, intet fund. Flag IKKE "off" ("on"/"beta"/"dry_run"/true) → tom
// tabel er nu en ægte død feature, og Detector A flager den som normalt (se
// evaluateDetectorARow + isFlagOff).
//
// Byg IKKE endnu en statisk "jeg tjekkede engang"-whitelist-entry for en
// flag-gated feature — brug denne registrering i stedet, så en fremtidig
// flag-flip uden data bliver fanget automatisk næste gang auditen kører (#2985).
const FLAG_GATED_EMPTY_TABLES = new Map([
  // Sæson-optagelse til akademiet (#2911): season_academy_intake_enabled = "off"
  // (ejer-beslutning 25/7, database/2026-07-25-season-start-hooks.sql). Koden
  // (seasonAcademyIntake.js) er klar men bevidst slukket — 0 rows er forventet.
  // Flippes flaget til "on" og tabellen forbliver tom efter næste sæsonskifte,
  // er det en ægte bug, og Detector A skal flage det (bevist i
  // audit-feature-liveness.test.js).
  ["academy_season_intake_runs", { flagKey: "season_academy_intake_enabled" }],
  // Email retention-loop (#2725/#2853): email_loop_enabled findes slet ikke i
  // app_config endnu (fail-safe off, se emailLoopFlag.js). Tidligere en manuel
  // WHITELIST_EMPTY_TABLES-entry (flyttet hertil 26/7, #2985). off → "dry_run"
  // eller "on" giver rows (emailService logger til email_log i alle stadier
  // undtagen off), så en fremtidig flip fanges automatisk uden at nogen skal
  // huske at rydde whitelisten.
  ["email_log", { flagKey: "email_loop_enabled" }],
  // Dagsbaseret løntræk (#2840/PR #3256, merged 3/8 gated): wage_deduction_mode
  // er en MODE-nøgle, ikke en boolsk — "season_upfront" (default, nuværende
  // adfærd) er dens off-tilstand, "daily" tænder sweepen. offValues fortæller
  // isFlagOff hvilke værdier der tæller som off. Flippes til "daily" (tidligst
  // S3-cutover 23/8) og tabellen forbliver tom, flager Detector A som normalt.
  ["wage_daily_runs", { flagKey: "wage_deduction_mode", offValues: ["season_upfront"] }],
  // Mandat-modellen (#3514, PR #3834 merged 17/8 bevidst inert): de tre tabeller
  // SKAL være tomme indtil backfillen køres ejer-gated 23/8 (cutover-drejebogen
  // komponent 4). board_mandate_model_enabled = "off" er seedet af migrationen.
  // Flippes flaget uden at backfillen har fyldt tabellerne, er det en ægte bug,
  // og Detector A skal flage som normalt.
  ["board_relations", { flagKey: "board_mandate_model_enabled" }],
  ["board_mandates", { flagKey: "board_mandate_model_enabled" }],
  ["board_vision_milestones", { flagKey: "board_mandate_model_enabled" }],
  // Niveau-korrektionen (#3449, migration 2026-08-19-3449-level-correction-gate.sql):
  // de to log-tabeller skrives KUN af marketValueLevelCorrectionApply.js
  // --confirm-apply, og gaten står RØD ved seed (stabilitets-båndet binder).
  // youth_auction_start_rate-nøglen er NULL indtil første apply og skrives af
  // selvsamme kørsel der fylder tabellerne — så NULL (= off for isFlagOff) er
  // præcis "tomme tabeller er forventet", og en fremtidig apply uden log-rows
  // flages automatisk som ægte fund.
  ["market_value_level_correction_apply_log", { flagKey: "market_value_level_correction_youth_auction_start_rate" }],
  ["market_value_level_correction_rider_receipts", { flagKey: "market_value_level_correction_youth_auction_start_rate" }],
]);

// Detector B: endpoints der er korrekt orphaned i frontend (cron, admin-curl, webhook)
// Match-form: HTTP method + path-pattern (samme som routes-listen).
const WHITELIST_ORPHANED_ENDPOINTS = new Set([
  // Bulk-gem til saesonmatrixens kladde-model (#1146, PR #4316): API-first.
  // UI-kalderen (Save plan i SeasonMatrix.jsx) lander i matrix-PR'en paa
  // feat/1146-season-matrix-grid, der reviewes sammen med denne. Fjern entry'en
  // naar matrix-PR'en er merged — grep efter "selection/bulk" i frontend/src.
  "PUT /races/selection/bulk",
  // Season-read til saesonmatrixen (#1146): API-first, samme spor som bulk-
  // endpointet ovenfor. UI-kalderen ligger i matrix-PR'en (#4323) og testes af
  // spillere paa Vercel-preview mod prod-backenden foer UI-merge. Fjern begge
  // entries naar matrix-PR'en er merged.
  "GET /races/selection/season",
  // Mandatets Boardroom-side (#4557/#3514, PR #4570): API-first, samme moenster
  // som saesonmatrixens to entries ovenfor. UI-kalderen bygges parallelt i
  // frontend-PR #4569 mod den bindende response-kontrakt i #4557. Endpointet
  // returnerer {enabled:false} og laeser INGEN skygge-tabel naar mandat-
  // modellens kill-switch (board_mandate_model_enabled) er off, saa der er
  // ingen data-liveness-risiko ved at lade det staa uden kalder indtil #4569
  // merges. Fjern denne entry naar #4569 er merged og faktisk kalder
  // GET /board/room — grep efter "board/room" i frontend/src/.
  "GET /board/room",
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
  // Fiktiv-population-preview (#1364): read-only diagnostik der kører de 800 fiktive
  // ryttere gennem HELE værdi-kæden (baseline → typer → valuation) og returnerer
  // base_value-fordelingen. Rører intet i DB. Havde en frontend-kalder i admin's Rider
  // Explorer indtil #3558 fjernede den fladen; endpointet er bevidst bevaret som
  // curl-værktøj til værdi-/ryttertype-arbejdet (#3564, #3353, #3345) — det er netop
  // dét man vil kunne køre FØR en omklassificering for at se hvordan værdierne flytter
  // sig. Intentional orphaned, ikke drift. Se #3563.
  "GET /admin/fictional-rider-preview",
  // Health / probe
  "GET /health",
  // Sikker rytter-sletning (#3594, PR #3886): erstatter rå SQL ved hændelses-
  // oprydning — annullerer aktive auktioner m. budgiver-notifikation FØR delete.
  // Kaldes via curl/ops ved incidents; ingen frontend-kalder by design.
  "POST /admin/riders/:id/delete-with-cleanup",
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
  // F3 taktik-ordrer v1 (#4030/#3855): API-first. Taktik-kortet ER merged
  // (PR #4093, 22/8), men det kalder endnu IKKE disse endpoints: al I/O gaar
  // gennem frontend/src/lib/tacticsOrdersAdapter.js, som stadig mocker svarene
  // in-memory. Fjern foerst fra whitelisten naar adapterens krop er erstattet
  // med et rigtigt fetch — grep efter "team-orders" i frontend/src/ som proeve.
  "GET /races/:raceId/team-orders",
  "PUT /races/:raceId/team-orders/:stageNumber",
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
  // E-mail-loop (#2725): unsubscribe kaldes fra LINKS I E-MAILS (List-Unsubscribe
  // one-click POST + footer-link GET via Vercel-rewrite), aldrig fra frontend-
  // koden. Intentional orphaned, ikke drift.
  "GET /email/unsubscribe",
  "POST /email/unsubscribe",
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
  // #2180 one-click auto-udtag: backend-endpointet (+ det tilhørende 36t-
  // varsel-sweep, selectionWarningSweep.js) shippet FØR indbakke-knappen —
  // eksplicit backend-only scope for denne PR (se PR-body). En senere
  // frontend-session wirer notifikationens metadata.raceId til dette
  // endpoint fra NotificationsPage.jsx. Intentional orphaned indtil da,
  // ikke drift; fjern denne entry når knappen lander.
  "POST /races/:raceId/selection/auto",
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
  // (academy_graduate (#1669) fjernet 3/8 efter instruktionen i entryen selv:
  // eventet flyder nu — 11 impressions i 30-dages-vinduet, verificeret mod prod
  // af audit-kørslen selv ("Stale whitelist-entry"-fund) — så Detector E
  // overvåger det normalt igen.)
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
  // MIDLERTIDIG (#3367-sessionen 5/8): før-snapshot taget forud for
  // backfillRiderTypes.js, så de 4.249 type-skift kan rulles tilbage. Den er
  // bevidst IKKE en migration — den er et engangs-sikkerhedsnet, ikke skema.
  // Uden denne entry flagger detector D den som schema-drift, og `audit` blev
  // dermed rød på ENHVER PR (falsk rød, ikke-blokerende men støjende).
  // FJERN denne linje sammen med tabellen når den nye type-fordeling er set an
  // i drift — se docs/audits/night-wave-2026-08-05-aften.md for rollback-SQL.
  "riders_type_backfill_snapshot_20260805",
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

// Live app_config-snapshot til FLAG_GATED_EMPTY_TABLES — læses fra samme
// key/value-tabel featureStage.js/emailLoopFlag.js selv læser runtime-flags fra,
// så auditen ser PRÆCIS den værdi backend-koden ville evaluere.
async function fetchAppConfigFlags() {
  const { data, error } = await supabase.from("app_config").select("key, value");
  if (error) {
    throw new Error(formatSupabaseAuditError(
      "app_config select (Detector A flag-gate)",
      error,
      "Verificér at app_config-tabellen findes og at service-role-nøglen har select-adgang."
    ));
  }
  const flags = new Map();
  for (const row of data || []) flags.set(row.key, row.value);
  return flags;
}

// Fail-safe: manglende/ukendt/false/"off" = off. Alt andet ("on", true, "beta",
// "dry_run", eller enhver anden streng) = IKKE off. Bevidst løsere end
// featureStage.js's evaluateFlagStage (som kun kender off/beta/on) fordi
// Detector A skal virke for BEGGE flag-familier der forekommer i kodebasen:
// tre-tilstand off/beta/on (featureStage.js) OG off/dry_run/on (emailLoopFlag.js).
export function isFlagOff(value, offValues = []) {
  return value === undefined || value === null || value === false || value === "off"
    || offValues.includes(value);
}

// Ren beslutningsfunktion for ÉN Detector A-tabelrække — ingen supabase/fs,
// kun allerede-hentet data. Gør flag-bevidstheden testbar uden mocks (se
// audit-feature-liveness.test.js).
export function evaluateDetectorARow(row, { insertPaths, flags }) {
  // Forward-guard (#2299): en midlertidig whitelist-entry hvis tabel nu HAR
  // rows er stale — flag den, så whitelisten selv-rydder i stedet for at
  // rådne (20/28 entries var forfaldne pr. 2026-07-10, se #2298).
  if (row.row_count > 0) {
    if (WHITELIST_EMPTY_TABLES.has(row.table_name)) {
      return {
        detector: "A",
        severity: "info",
        table: row.table_name,
        rows: row.row_count,
        reason: `Stale whitelist-entry: tabellen har nu ${row.row_count} rows — fjern "${row.table_name}" fra WHITELIST_EMPTY_TABLES`,
      };
    }
    return null;
  }
  if (WHITELIST_EMPTY_TABLES.has(row.table_name)) return null;
  if (PERMANENT_EMPTY_TABLES.has(row.table_name)) return null;

  // Flag-bevidst gate: tom tabel er den FORVENTEDE tilstand mens flaget er off
  // (intet fund) — men IKKE længere når flaget er sat til beta/dry_run/on, hvor
  // en fortsat tom tabel er en ægte død feature og skal flages som normalt.
  const flagGate = FLAG_GATED_EMPTY_TABLES.get(row.table_name);
  const flagValue = flagGate ? flags.get(flagGate.flagKey) : undefined;
  if (flagGate && isFlagOff(flagValue, flagGate.offValues ?? [])) return null;

  const paths = insertPaths.get(row.table_name);
  if (!paths || paths.size === 0) return null; // ingen backend-write — ikke vores problem

  return {
    detector: "A",
    severity: "warning",
    table: row.table_name,
    reason: flagGate
      ? `Tabel har 0 rows, backend har INSERT/UPSERT-paths, OG flag "${flagGate.flagKey}"=${JSON.stringify(flagValue ?? null)} er IKKE off — featuren burde skrive rows`
      : "Tabel har 0 rows men backend har INSERT/UPSERT-paths",
    backend_files: [...paths].sort(),
  };
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
  const [counts, insertPaths, flags] = await Promise.all([
    fetchTableCounts(),
    findBackendInsertPaths(),
    fetchAppConfigFlags(),
  ]);
  const findings = [];
  for (const row of counts) {
    const finding = evaluateDetectorARow(row, { insertPaths, flags });
    if (finding) findings.push(finding);
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
    // Transiente sikkerheds-backups: oprettes FØR destruktive prod-indgreb og slettes
    // efter verifikation — aldrig skema, så de flagges ikke som drift.
    // To konventioner er i brug, og BEGGE skal fanges: præfiks `backup_<slug>_<dato>_*`
    // og suffiks `<kilde>_<slug>_backup_<dato>` (#3570-reparationen 11/8 brugte den
    // sidste, og detektoren så kun den første — 2 falske D-fund på PR #3630).
    if (tbl.startsWith("backup_") || /_backup_\d{8}$/.test(tbl)) continue;
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

// ---------------------------------------------------------------------------
// CLI entry — kun når scriptet køres direkte (ikke ved import i tests).
// Spejler samme isMain-mønster som audit-league-size-invariant.js, så
// evaluateDetectorARow/isFlagOff kan importeres og unit-testes uden at det
// udløser hele auditten (netværkskald + evt. process.exit) som en side-effekt
// af importet (#2985).
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
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
}

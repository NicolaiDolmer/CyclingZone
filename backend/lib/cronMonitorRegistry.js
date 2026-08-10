/**
 * Cycling Zone Manager — Cron-monitor-registry (#2892)
 * ======================================================
 * Checked-in SSOT for hvilke periodiske cron-jobs der SKAL have et Sentry
 * cron-monitor (ALL_CRON_MONITORS) og hvilke der bevidst er undtaget
 * (UNMONITORED_CRON_TICKS), med begrundelse pr. entry.
 *
 * Udtrukket fra backend/cron.js (#2892) så registret kan importeres direkte
 * — af cron.js selv OG af backend/cron.monitorCoverage.test.js — i stedet
 * for at leve som en uexporteret const midt i en 1500-linjers fil. Formålet
 * er at gøre "et nyt cron-job mangler et monitor" til en compile-time/
 * test-time fejl i stedet for noget der først opdages i produktion (se
 * #2892: 26 af 27 Sentry-monitorer var disabled i tre uger, uopdaget).
 *
 * VIGTIGT for bidragydere: tilføjer du et nyt periodisk job i cron.js'
 * startCron() (et nyt setInterval(trackedTick(...), ...)-kald), skal du
 * ENTEN
 *   (a) wrappe kaldet i monitorCron("dit-slug", fn, CRON_MONITOR_*) OG
 *       tilføje ["dit-slug", CRON_MONITOR_*] til ALL_CRON_MONITORS herunder,
 *   ELLER
 *   (b) eksplicit tilføje trackedTick-labellen til UNMONITORED_CRON_TICKS
 *       med en kommentar der forklarer hvorfor jobbet ikke skal heartbeate.
 * Glemmer du begge dele, fejler backend/cron.monitorCoverage.test.js.
 */

// #2077 — Sentry cron-monitor-configs. Udebliver et tick (proces død/deploy-hang)
// fyrer Sentry en MISSED-alarm ud fra schedulen; hænger et tick over maxRuntime
// regnes det TIMEOUT. #2389/B5: udvidet fra kun auto-prize/stage-scheduler til ALLE
// periodiske jobs — en cron der tavst holder op med at ticke var ellers usynlig
// indtil en spiller opdagede symptomet. Margins er rundhåndede: en Railway-deploy
// genstarter processen og nulstiller alle setInterval-timere.
//
// #2395 — failureIssueThreshold=2 på sub-døgn-jobs: en Railway-deploy tager
// processen ned længe nok til at et 5-min-tick misser sit check-in, og med Sentrys
// default-tærskel (1) blev HVER deploy til en byge af "missed check-in"-outage-issues
// på tværs af alle korte crons (12/7: 2 deploys → 20 falske issues). En ægte død cron
// misser check-in FLERE gange i træk → 2 fanger den stadig (10-20 min forsinkelse),
// mens en enkelt deploy-afbrydelse ties. Påvirker KUN monitor-heartbeat-issuet;
// ægte exceptions fra cron-logikken captures uændret via trackedTick/captureException.
export const CRON_MONITOR_1MIN = {
  schedule: { type: "interval", value: 1, unit: "minute" },
  checkinMargin: 3,
  maxRuntime: 10,
  failureIssueThreshold: 2,
  timezone: "Etc/UTC",
};
// #2440: checkinMargin 5→10. #2395 (threshold=2) dæmpede ÉN redeploy, men en
// deploy-KLYNGE (6 genstarter på 30 min, 12/7+13/7) ramte ~12 forskellige jobs på
// denne cadence samtidigt — hver genstart alene nåede stadig at bekræfte 1 miss
// (slot ved +interval+margin=10min var for stramt relativt til gentagne
// genstarter tættere end det), og NÆSTE genstart nåede at bekræfte miss #2 FØR
// boot-primingen (se primeCronMonitorCheckIns i cron.js) nåede at nulstille
// streaken → alarm. Margin=10 (slot bekræftes først ved +15min) giver rigelig
// buffer til at boot-primingen altid når at resette streaken FØRST ved typiske
// Railway-genstarts-gaps (~5-10 min i en klynge), mens en ægte død cron stadig
// alarmerer inden for 2×5+10=20 min (dokumenteret+testet i cron.deployGrace.test.js).
export const CRON_MONITOR_5MIN = {
  schedule: { type: "interval", value: 5, unit: "minute" },
  checkinMargin: 10,
  maxRuntime: 15, // min før et in_progress-tick regnes TIMEOUT
  failureIssueThreshold: 2, // #2395: én deploy-miss alarmerer ikke; 2 i træk = ægte fejl
  timezone: "Etc/UTC",
};
export const CRON_MONITOR_10MIN = {
  schedule: { type: "interval", value: 10, unit: "minute" },
  checkinMargin: 10,
  maxRuntime: 20,
  failureIssueThreshold: 2,
  timezone: "Etc/UTC",
};
export const CRON_MONITOR_30MIN = {
  schedule: { type: "interval", value: 30, unit: "minute" },
  checkinMargin: 15,
  maxRuntime: 30,
  failureIssueThreshold: 2,
  timezone: "Etc/UTC",
};
export const CRON_MONITOR_60MIN = {
  schedule: { type: "interval", value: 60, unit: "minute" },
  checkinMargin: 30,
  maxRuntime: 60,
  failureIssueThreshold: 2,
  timezone: "Etc/UTC",
};
// 24h-ticks: margin 3 timer — setInterval-baseret døgn-rytme drifter med deploys,
// og en deploy-genstart + immediate-run checker ind længe før marginen rammes.
export const CRON_MONITOR_24H = {
  schedule: { type: "interval", value: 1, unit: "day" },
  checkinMargin: 180,
  maxRuntime: 60,
  timezone: "Etc/UTC",
};

// ─── ALL_CRON_MONITORS ─────────────────────────────────────────────────────
// Deploy-grace: boot-priming af cron-monitors (#2440). Rod-årsag: hver Railway-
// redeploy genstarter processen midt i en cron-cyklus. Ved en deploy-KLYNGE
// (flere redeploys på kort tid — 6 på 30 min 12/7, gentaget 13/7) ramte hver
// genstart ALLE periodiske monitors samtidig, og #2395's
// failureIssueThreshold=2 dæmpede kun ÉN isoleret redeploy — to redeploys tæt
// nok på hinanden nåede stadig at bekræfte 2 misses i træk for de ~12 jobs på
// CRON_MONITOR_5MIN, før den næste genstart nåede at gøre noget.
//
// Fix: send et eksplicit "ok" check-in til Sentry for ALLE monitor-configs
// med det samme processen booter — FØR nogen setInterval er sat op (se
// primeCronMonitorCheckIns i cron.js). Det nulstiller Sentrys
// consecutive-miss-streak for hver monitor til 0 ved HVER genstart, så en
// deploy-klynge aldrig ophober nok sammenhængende misses til at nå threshold,
// uanset hvor mange genstarter der sker. En REELT død cron (processen kører
// videre, men jobbet holder op med at ticke) rammes ikke af dette — der sker
// ingen ny boot/priming, så det normale schedule (interval + checkinMargin ×
// threshold) gælder uændret. Matematisk verificeret i cron.deployGrace.test.js.
//
// #2892: dette array er nu den ENESTE plads et periodisk job kan registrere et
// monitor-slug. Hvert slug her SKAL matche et monitorCron("slug", ...)-kald i
// cron.js — backend/cron.monitorCoverage.test.js fejler i begge retninger
// (manglende entry ELLER dødt entry uden opkald).
export const ALL_CRON_MONITORS = [
  ["auctions", CRON_MONITOR_1MIN],
  ["deadline-day", CRON_MONITOR_5MIN],
  ["squad-enforcement", CRON_MONITOR_5MIN],
  ["selection-warning", CRON_MONITOR_5MIN],
  ["debt-warnings", CRON_MONITOR_24H],
  ["board-auto-accept", CRON_MONITOR_30MIN],
  ["board-mid-season", CRON_MONITOR_30MIN],
  ["daily-season-count-check", CRON_MONITOR_24H],
  ["discord-bot-token-check", CRON_MONITOR_24H],
  ["discord-role-sync", CRON_MONITOR_24H],
  ["discord-dm-outbox-drain", CRON_MONITOR_5MIN],
  ["discord-webhook-outbox-drain", CRON_MONITOR_5MIN],
  ["training-sweep", CRON_MONITOR_5MIN],
  ["ai-recovery-sweep", CRON_MONITOR_5MIN],
  ["graduation-sweep", CRON_MONITOR_5MIN],
  ["scout-sweep", CRON_MONITOR_5MIN],
  ["wage-deduction-sweep", CRON_MONITOR_5MIN],
  ["starter-squad-heal", CRON_MONITOR_5MIN],
  ["academy-heal", CRON_MONITOR_5MIN],
  ["rider-derive-heal", CRON_MONITOR_5MIN],
  ["ai-trim-heal", CRON_MONITOR_5MIN],
  ["deferred-transfer-heal", CRON_MONITOR_5MIN],
  ["auto-prize", CRON_MONITOR_5MIN],
  ["stage-scheduler", CRON_MONITOR_5MIN],
  ["ranking-matview-refresh", CRON_MONITOR_10MIN],
  ["global-rank-weekly-snapshot", CRON_MONITOR_24H],
  ["stall-watchdog", CRON_MONITOR_30MIN],
  ["traffic-retention", CRON_MONITOR_24H],
  ["identity-events-retention", CRON_MONITOR_24H],
  ["balance-drift-watch", CRON_MONITOR_24H],
  ["growth-snapshot", CRON_MONITOR_24H],
  ["entry-generator", CRON_MONITOR_60MIN],
  ["ownership-invariant-watch", CRON_MONITOR_24H],
  ["rider-double-booking-watch", CRON_MONITOR_24H],
  ["intake-offer-expiry", CRON_MONITOR_24H],
  ["email-welcome", CRON_MONITOR_5MIN],
  ["email-day1", CRON_MONITOR_60MIN],
  ["email-race-digest", CRON_MONITOR_60MIN],
  ["discord-race-digest", CRON_MONITOR_60MIN],
  ["alunta-subscription-reconcile", CRON_MONITOR_24H],
  // #3402: sæsondokumentar-sweep — polleren der fylder season_documentaries op
  // for de seneste completed sæsoner (60 min-kadence, samme som entry-generator/
  // discord-race-digest). Idempotent no-op når intet mangler.
  ["season-documentary", CRON_MONITOR_60MIN],
  ["fairplay-scoring", CRON_MONITOR_24H],
];

// ─── UNMONITORED_CRON_TICKS ────────────────────────────────────────────────
// Periodiske setInterval(trackedTick("label", ...), ...)-registreringer i
// cron.js's startCron() der BEVIDST ikke er monitorCron-wrappet. Labellen her
// SKAL matche trackedTick's første argument præcist.
// backend/cron.monitorCoverage.test.js kræver at ethvert periodisk job enten
// er monitorCron-wrappet eller står i denne liste — så en fremtidig
// udvikler der glemmer BEGGE dele får en rød test i stedet for et tavst hul.
export const UNMONITORED_CRON_TICKS = [
  // Sæson-auto-transition er DEAKTIVERET (SEASON_AUTO_TRANSITION_ENABLED=false
  // i economyConstants.js — manuelt sæson-skift, ejer-beslutning 2026-06-08).
  // Koden kører aldrig i praksis under flaget; et Sentry-heartbeat på et job
  // der pr. design ikke ticker ville kun støje. Tilføj monitorCron(...) +
  // en ALL_CRON_MONITORS-entry SAMTIDIG med at flaget flippes til true.
  "season auto-transition",
  // Sunday-intake-drip er bevidst søndags-gated + claim-idempotent (#2064 S0)
  // — modulet selv no-op'er alle ugens øvrige dage. Et fast interval-schedule
  // (CRON_MONITOR_60MIN) forventer succes hver time; det ville false-positive
  // alarmere resten af ugen. Se runSundayIntakeTick.js for gate-logikken.
  "sunday-intake-drip",
];

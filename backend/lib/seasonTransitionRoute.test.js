import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

// ============================================================
// #1166 — season-transition-endpoints skal kunne resume fra
// completed sæson (korrekt rækkefølge: season-end → transition).
// ------------------------------------------------------------
// Rod-årsag: både preview- og udfør-endpointet fandt kildesæsonen
// via et rent `status='active'`-lookup. Efter season-end findes
// ingen 'active' sæson (den er 'completed', næste er 'upcoming'),
// så endpointet 404'ede og admin-knappen "Udfør sæsonskifte" var
// ubrugelig — sæson 1→2 måtte køres via script (#1155). Engine'ns
// resume-sti (#578) accepterer en completed fromSeason når næste
// sæson eksisterer; endpoints skal nå den via
// resolveTransitionSourceSeason (active → fallback seneste completed).
// ============================================================

function isolatePreviewHandler() {
  const match = apiSource.match(
    /router\.get\(\s*"\/admin\/season-transition\/preview"[\s\S]*?\n\}\);/,
  );
  assert.ok(match, "Kunne ikke isolere GET /admin/season-transition/preview-handler");
  return match[0];
}

function isolateExecuteHandler() {
  const match = apiSource.match(
    /router\.post\(\s*"\/admin\/season-transition"[\s\S]*?\n\}\);/,
  );
  assert.ok(match, "Kunne ikke isolere POST /admin/season-transition-handler");
  return match[0];
}

function isolateSeasonEndHandler() {
  const match = apiSource.match(
    /router\.post\(\s*"\/admin\/seasons\/:id\/end"[\s\S]*?\n\}\);/,
  );
  assert.ok(match, "Kunne ikke isolere POST /admin/seasons/:id/end-handler");
  return match[0];
}

test("routes/api.js importerer resolveTransitionSourceSeason fra seasonTransition.js", () => {
  assert.match(
    apiSource,
    /import\s*\{[^}]*resolveTransitionSourceSeason[^}]*\}\s*from\s*"\.\.\/lib\/seasonTransition\.js"/,
    "resolveTransitionSourceSeason skal importeres fra ../lib/seasonTransition.js",
  );
});

test("GET /admin/season-transition/preview er requireAdmin-gated", () => {
  assert.match(
    apiSource,
    /router\.get\(\s*"\/admin\/season-transition\/preview"\s*,\s*requireAdmin/,
  );
});

test("preview-handler resolver kildesæson via resolveTransitionSourceSeason (resume-sti #1166)", () => {
  const block = isolatePreviewHandler();
  assert.match(
    block,
    /resolveTransitionSourceSeason\(\s*\{\s*supabase\s*\}\s*\)/,
    "preview skal bruge resolveTransitionSourceSeason så completed sæson (post season-end) accepteres",
  );
  assert.doesNotMatch(
    block,
    /\.eq\(\s*"status"\s*,\s*"active"\s*\)/,
    "preview må IKKE længere lave et rent status='active'-lookup — det 404'er efter season-end",
  );
});

test("POST /admin/season-transition er requireAdmin + adminWriteLimiter-gated", () => {
  assert.match(
    apiSource,
    /router\.post\(\s*"\/admin\/season-transition"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/,
  );
});

test("udfør-handler falder tilbage til resolveTransitionSourceSeason når fromSeasonId mangler (#1166)", () => {
  const block = isolateExecuteHandler();
  assert.match(
    block,
    /resolveTransitionSourceSeason\(\s*\{\s*supabase\s*\}\s*\)/,
    "udfør-endpointet skal bruge samme resolver som preview når body ikke angiver fromSeasonId",
  );
  assert.doesNotMatch(
    block,
    /\.eq\(\s*"status"\s*,\s*"active"\s*\)/,
    "udfør må IKKE længere lave et rent status='active'-lookup — det 404'er efter season-end",
  );
  assert.match(
    block,
    /bodyFromSeasonId/,
    "eksplicit fromSeasonId i body skal stadig respekteres (bypass af resolveren)",
  );
});

// ============================================================
// #1346 — server-side readiness-gate på manuel transition.
// Endpointet må ikke kunne lukke en aktiv sæson med åbent
// vindue/uafviklede løb ved et fejlklik. Force-override er
// eksplicit og logges i admin_log (MANUAL_OVERRIDE, ikke
// SEASON_TRANSITION som dailySeasonCountCheck tæller på).
// ============================================================

test("routes/api.js importerer assessTransitionReadiness fra seasonTransitionReadiness.js (#1346)", () => {
  assert.match(
    apiSource,
    /import\s*\{[^}]*assessTransitionReadiness[^}]*\}\s*from\s*"\.\.\/lib\/seasonTransitionReadiness\.js"/,
  );
});

test("udfør-handler kører readiness-gate FØR transitionToNextSeason og kan svare 409 (#1346)", () => {
  const block = isolateExecuteHandler();
  assert.match(block, /assessTransitionReadiness\(/, "POST skal beregne readiness");
  assert.match(block, /status\(409\)/, "rød gate uden force skal afvises med 409");
  assert.match(block, /force/, "force-flag fra body skal respekteres");
  assert.ok(
    block.indexOf("assessTransitionReadiness") < block.indexOf("transitionToNextSeason("),
    "gaten skal stå FØR transition-kaldet, ellers er writes allerede sket",
  );
});

test("udfør-handler logger force-override i admin_log med MANUAL_OVERRIDE (#1346)", () => {
  const block = isolateExecuteHandler();
  assert.match(block, /ADMIN_ACTION_TYPE\.MANUAL_OVERRIDE/, "force skal logges som manual_override");
  assert.doesNotMatch(
    block,
    /action_type:\s*ADMIN_ACTION_TYPE\.SEASON_TRANSITION/,
    "force-loggen må IKKE bruge season_transition (dobbelt-tælling i dailySeasonCountCheck)",
  );
});

test("preview-handler returnerer readiness sammen med planen (#1346)", () => {
  const block = isolatePreviewHandler();
  assert.match(block, /assessTransitionReadiness\(/, "preview skal beregne samme readiness som udfør");
  assert.match(block, /readiness/, "preview-response skal indeholde readiness");
});

test("udfør-handler gater ikke dryRun og sender readiness med i 409-svaret (#1346)", () => {
  const block = isolateExecuteHandler();
  assert.match(block, /if\s*\(!dryRun\)/, "gaten skal kun køre for rigtige writes, ikke dry-runs");
  assert.match(block, /status\(409\)\.json\(\{[\s\S]*?readiness/, "409-svaret skal bære readiness-payloaden til UI'et");
});

// ============================================================
// #2745 — season_ended in-app-notifikation var en "død hook":
// frontend havde fuld rendering for typen (NotificationsPage
// TYPE_CONFIG + notif.seasonEnded-i18n), men ingen backend-kode
// indsatte nogensinde en row (prod 23/7: 0 rækker nogensinde).
// Rod-årsag: season-slut sker i POST /admin/seasons/:id/end, IKKE
// i seasonTransition.js's transitionToNextSeason (som håndterer
// season-*start*) — det manglende modstykke blev bygget/lagt i
// forkert fil ved #1357 og aldrig opdaget siden.
// ============================================================

test("routes/api.js importerer emitSeasonEndedNotifications fra seasonTransition.js (#2745)", () => {
  assert.match(
    apiSource,
    /import\s*\{[^}]*emitSeasonEndedNotifications[^}]*\}\s*from\s*"\.\.\/lib\/seasonTransition\.js"/,
    "emitSeasonEndedNotifications skal importeres fra ../lib/seasonTransition.js",
  );
});

test("POST /admin/seasons/:id/end kalder emitSeasonEndedNotifications EFTER sæsonen er markeret completed (#2745)", () => {
  const block = isolateSeasonEndHandler();
  assert.match(
    block,
    /emitSeasonEndedNotifications\(/,
    "season-end-handleren skal indsætte in-app season_ended-notifikationer til menneske-managers",
  );
  assert.ok(
    block.indexOf('status: "completed"') < block.indexOf("emitSeasonEndedNotifications("),
    "notifikationerne skal sendes EFTER seasons.status er sat til 'completed', ikke før",
  );
  // Additiv + isoleret: en fejl i notifikations-emit må ALDRIG vælte selve
  // sæson-afslutningen (samme disciplin som Discord-broadcast + de øvrige
  // notif-faser i seasonTransition.js). En try/catch omkring kaldet er den
  // enkleste garanti for det i denne route-fil (ingen phase-log her).
  assert.match(
    block,
    /try\s*\{[\s\S]*?emitSeasonEndedNotifications\([\s\S]*?\}\s*catch/,
    "kaldet skal være try/catch-isoleret så en notifikations-fejl ikke fejler hele endpointet",
  );
});

// ============================================================
// #2805 — POST /admin/seasons/:id/end skal spærre mod uafviklede
// løb FØR processSeasonEnd. pending_race_results-checket fanger
// kun resultater der venter på behandling — et aldrig-startet løb
// har ingen række der. Op/nedrykning på ufuldstændig slutstilling
// er irreversibel, så spærren skal ligge før enhver write.
// ============================================================

test("routes/api.js importerer assessSeasonEndBlockers fra seasonTransitionReadiness.js", () => {
  assert.match(
    apiSource,
    /import\s*\{[^}]*assessSeasonEndBlockers[^}]*\}\s*from\s*"\.\.\/lib\/seasonTransitionReadiness\.js"/,
    "assessSeasonEndBlockers skal importeres fra ../lib/seasonTransitionReadiness.js",
  );
});

test("POST /admin/seasons/:id/end kalder assessSeasonEndBlockers FØR processSeasonEnd (#2805)", () => {
  const block = isolateSeasonEndHandler();
  const blockerIdx = block.indexOf("assessSeasonEndBlockers");
  const processIdx = block.indexOf("processSeasonEnd");
  assert.ok(blockerIdx !== -1, "handleren skal kalde assessSeasonEndBlockers");
  assert.ok(processIdx !== -1, "handleren skal kalde processSeasonEnd");
  assert.ok(
    blockerIdx < processIdx,
    "spærren skal evalueres FØR processSeasonEnd — ellers er skaden sket",
  );
  assert.match(
    block,
    /seasonEndBlockers\.blocked[\s\S]{0,200}status\(400\)/,
    "blocked-resultatet skal afvises med 400",
  );
});

test("POST /admin/seasons/:id/end har INGEN force-bypass af uafviklede-løb-spærren (#2805)", () => {
  const block = isolateSeasonEndHandler();
  // Handleren læser i dag INGEN body-input. En fremtidig force-parameter ville
  // kræve req.body — den må ikke indføres uden bevidst at genbesøge #2805
  // (spærren er absolut: transition-force må heller ikke slå den fra).
  assert.doesNotMatch(
    block,
    /req\.body/,
    "season-end-handleren må ikke læse body-parametre — #2805-spærren er bevidst uden force-bypass",
  );
});

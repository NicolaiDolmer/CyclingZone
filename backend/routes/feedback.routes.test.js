// #2602 — in-game feedback/bug-report-knap. api.js er ikke unit-testbar direkte
// (kræver live Supabase-client) — dette mønster (kildetekst-scan) spejler
// scoutAssignments.routes.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "./api.js"), "utf8");

test("POST /api/feedback er registreret + kræver auth + rate-limites", () => {
  const idx = apiSource.indexOf('router.post("/feedback"');
  assert.ok(idx !== -1, "POST /feedback skal findes");
  const block = apiSource.slice(idx, idx + 200);
  assert.match(block, /requireAuth/, "skal kræve auth");
  assert.match(block, /feedbackLimiter/, "skal rate-limites (feedback-specifik limiter)");
});

test("POST /api/feedback validerer category + non-empty + maks-længde FØR insert", () => {
  const idx = apiSource.indexOf('router.post("/feedback"');
  const block = apiSource.slice(idx, idx + 2500);
  assert.match(block, /FEEDBACK_CATEGORIES\.includes\(category\)/, "skal validere category mod whitelist");
  assert.match(block, /trimmed\.length > FEEDBACK_MESSAGE_MAX_LENGTH/, "skal håndhæve maks-længde i backend (ikke kun DB-CHECK)");
  assert.match(block, /!trimmed/, "skal afvise tom/whitespace-only besked");
});

test("POST /api/feedback udleder user_id/team_id fra req.user/req.team, ALDRIG fra req.body", () => {
  const idx = apiSource.indexOf('router.post("/feedback"');
  const block = apiSource.slice(idx, idx + 2500);
  assert.match(block, /user_id:\s*req\.user\.id/, "user_id skal komme fra auth, ikke klienten");
  assert.match(block, /team_id:\s*req\.team\?\.id/, "team_id skal komme fra auth-resolved req.team, ikke klienten");
  // #2602: klienten sender KUN category/message/page_path/viewport — intet id-felt
  // må destruktureres fra req.body ind i insert-payloaden.
  const destructured = block.match(/const \{ category, message, page_path: pagePath, viewport \} = req\.body/);
  assert.ok(destructured, "req.body skal kun destrukturere de spiller-leverede felter, ingen id'er");
});

test("POST /api/feedback insert bruger service-role supabase-klienten (samme som resten af api.js)", () => {
  const idx = apiSource.indexOf('router.post("/feedback"');
  const block = apiSource.slice(idx, idx + 2500);
  assert.match(block, /supabase\.from\("player_feedback"\)\.insert/, "skal insertes via den delte service-role supabase-klient");
});

test("POST /api/feedback mirrorer til Discord best-effort (fejler ikke indsendelsen)", () => {
  const idx = apiSource.indexOf('router.post("/feedback"');
  const block = apiSource.slice(idx, idx + 2500);
  assert.match(block, /notifyPlayerFeedback\(/, "skal kalde notifyPlayerFeedback-mirroret");
  assert.match(block, /notifyPlayerFeedback\(\{[\s\S]*?\}\)\.catch\(/, "Discord-mirror skal være .catch'et — må aldrig kaste ind i request-handleren");
});

test("contract: api.js importerer feedbackLimiter + notifyPlayerFeedback", () => {
  assert.match(apiSource, /feedbackLimiter/);
  assert.match(apiSource, /notifyPlayerFeedback/);
});

// #2842 — en fejlende insert loggede tidligere KUN til konsollen. Discord-
// mirroret kører først efter insert, så en fejl på skrive-stien forsvandt
// fuldstændig: spilleren fik "kunne ikke sende", ingen så hvorfor.
test("POST /api/feedback rapporterer insert-fejl til Sentry, ikke kun konsollen", () => {
  const idx = apiSource.indexOf('router.post("/feedback"');
  const block = apiSource.slice(idx, idx + 2500);
  assert.match(block, /captureException\(error\)/, "insert-fejlstien skal captureException'e");
});

// ── Admin-indbakke (#2842) ──────────────────────────────────────────────────

test("admin-indbakkens tre ruter er registreret og ALLE gated af requireAdmin", () => {
  // player_feedback er fritekst fra spillere og kan indeholde personoplysninger.
  // requireAuth alene ville lade enhver indlogget spiller læse alles feedback.
  for (const [verb, path] of [
    ["get", "/admin/feedback"],
    ["patch", "/admin/feedback/:id/status"],
    ["post", "/admin/feedback/:id/reply"],
  ]) {
    const needle = `router.${verb}("${path}"`;
    const idx = apiSource.indexOf(needle);
    assert.ok(idx !== -1, `${verb.toUpperCase()} ${path} skal findes`);
    const header = apiSource.slice(idx, idx + 160);
    assert.match(header, /requireAdmin/, `${verb.toUpperCase()} ${path} skal kræve admin`);
  }
});

test("admin-indbakkens skrive-ruter er rate-limited", () => {
  for (const needle of [
    'router.patch("/admin/feedback/:id/status"',
    'router.post("/admin/feedback/:id/reply"',
  ]) {
    const idx = apiSource.indexOf(needle);
    const header = apiSource.slice(idx, idx + 160);
    assert.match(header, /adminWriteLimiter/, `${needle} skal bruge adminWriteLimiter`);
  }
});

test("admin-indbakken delegerer til feedbackInbox-handlerne (ikke inline logik i api.js)", () => {
  assert.match(apiSource, /from "\.\.\/lib\/feedbackInbox\.js"/, "handlerne skal importeres fra lib");
  for (const fn of ["listFeedbackInbox", "getFeedbackCounts", "setFeedbackStatus", "replyToFeedback"]) {
    assert.match(apiSource, new RegExp(`${fn}\\(`), `${fn} skal kaldes fra routen`);
  }
});

test("admin-indbakken sender ALDRIG et klient-leveret user_id videre", () => {
  const idx = apiSource.indexOf('router.post("/admin/feedback/:id/reply"');
  const block = apiSource.slice(idx, idx + 700);
  assert.match(block, /adminUserId:\s*req\.user\.id/, "afsenderen af svaret er den autentificerede admin, ikke noget i req.body");
});

// ── Handel-rapport (#4346) — POST /api/transfers/:type/:id/report ──────────

test("POST /api/transfers/:type/:id/report er registreret + kræver auth + rate-limites", () => {
  const idx = apiSource.indexOf('router.post("/transfers/:type/:id/report"');
  assert.ok(idx !== -1, "POST /transfers/:type/:id/report skal findes");
  const block = apiSource.slice(idx, idx + 200);
  assert.match(block, /requireAuth/, "skal kræve auth");
  assert.match(block, /feedbackLimiter/, "skal rate-limites");
});

test("POST /api/transfers/:type/:id/report validerer type + UUID FØR den kalder submitTradeReport", () => {
  const idx = apiSource.indexOf('router.post("/transfers/:type/:id/report"');
  const block = apiSource.slice(idx, idx + 1200);
  assert.match(block, /TRADE_REPORT_TYPES\.includes\(req\.params\.type\)/, "skal validere :type mod whitelisten");
  assert.match(block, /UUID_RE\.test\(req\.params\.id\)/, "skal UUID-validere :id");
});

test("POST /api/transfers/:type/:id/report udleder team_id/user_id fra req.team/req.user, ALDRIG fra req.body", () => {
  const idx = apiSource.indexOf('router.post("/transfers/:type/:id/report"');
  const block = apiSource.slice(idx, idx + 1200);
  assert.match(block, /teamId:\s*req\.team\?\.id/, "teamId skal komme fra auth-resolved req.team");
  assert.match(block, /userId:\s*req\.user\.id/, "userId skal komme fra auth");
  assert.match(block, /transferType:\s*req\.params\.type/);
  assert.match(block, /transferId:\s*req\.params\.id/);
});

test("POST /api/transfers/:type/:id/report delegerer til submitTradeReport (ikke inline logik i api.js)", () => {
  assert.match(apiSource, /submitTradeReport\(/, "skal kalde submitTradeReport fra lib");
  const idx = apiSource.indexOf('router.post("/transfers/:type/:id/report"');
  const block = apiSource.slice(idx, idx + 1200);
  assert.match(block, /submitTradeReport\(/, "routen selv skal delegere");
});

test("POST /api/transfers/:type/:id/report mirrorer til Discord kun når rapporten faktisk er NY (ikke ved dedupe)", () => {
  const idx = apiSource.indexOf('router.post("/transfers/:type/:id/report"');
  const block = apiSource.slice(idx, idx + 1600);
  assert.match(block, /notifyPlayerFeedback\(/, "skal kalde notifyPlayerFeedback-mirroret");
  assert.match(block, /!body\.alreadyReported/, "må ikke re-mirrore en dedupe-hit");
  assert.match(block, /notifyPlayerFeedback\(\{[\s\S]*?\}\)\.catch\(/, "Discord-mirror skal være .catch'et — må aldrig kaste ind i request-handleren");
});

test("contract: api.js importerer submitTradeReport + TRADE_REPORT_TYPES fra feedbackInbox.js", () => {
  const idx = apiSource.indexOf('from "../lib/feedbackInbox.js"');
  assert.ok(idx !== -1, "import-blokken skal findes");
  const importBlock = apiSource.slice(Math.max(0, idx - 300), idx);
  assert.match(importBlock, /submitTradeReport/, "skal importeres sammen med de øvrige feedbackInbox-handlere");
  assert.match(importBlock, /TRADE_REPORT_TYPES/, "skal importeres sammen med de øvrige feedbackInbox-handlere");
});

test("FEEDBACK_CATEGORIES i api.js inkluderer fairplay (kontaktformularens dropdown, #4346)", () => {
  const idx = apiSource.indexOf("const FEEDBACK_CATEGORIES");
  const line = apiSource.slice(idx, apiSource.indexOf("\n", idx));
  assert.match(line, /"fairplay"/, "FEEDBACK_CATEGORIES skal matche player_feedback_category_check + frontend/src/lib/feedbackForm.js");
});

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

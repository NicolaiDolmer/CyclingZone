// Talentspejder Fase 3 (#2244) — B4: routes forward-guard/contract-tests.
// api.js er ikke unit-testbar direkte (kræver live Supabase-client) — dette
// mønster (kildetekst-scan) spejler potentialeHiding.routes.test.js +
// auctionSchemaContract.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "./api.js"), "utf8");

test("GET /api/scouting/central er registreret + kræver auth + bruger getScoutState", () => {
  const idx = apiSource.indexOf('router.get("/scouting/central"');
  assert.ok(idx !== -1, "GET /scouting/central skal findes");
  const block = apiSource.slice(idx, idx + 600);
  assert.match(block, /requireAuth/, "skal kræve auth");
  assert.match(block, /getScoutState\(/, "skal bruge scoutAssignmentService.getScoutState");
});

test("POST /api/scouting/assignments er registreret + kræver auth + marketWriteLimiter", () => {
  const idx = apiSource.indexOf('router.post("/scouting/assignments"');
  assert.ok(idx !== -1, "POST /scouting/assignments skal findes");
  const block = apiSource.slice(idx, idx + 200);
  assert.match(block, /requireAuth/, "skal kræve auth");
  assert.match(block, /marketWriteLimiter/, "skal rate-limites (markets-write)");
});

test("POST /api/scouting/assignments dispatcher rammer startTargetAssignment/startMission", () => {
  const idx = apiSource.indexOf('router.post("/scouting/assignments"');
  const block = apiSource.slice(idx, idx + 2000);
  assert.match(block, /startTargetAssignment\(/, "target-kind skal ramme startTargetAssignment");
  assert.match(block, /startMission\(/, "mission-kind skal ramme startMission");
});

test("POST /api/scouting/assignments er registreret FØR POST /scouting/:riderId (parameter-kollision)", () => {
  // Samme fælde som estimates-routen (#1162): begge er POST, så
  // /scouting/:riderId ville ellers fange "assignments" som riderId.
  const assignmentsIdx = apiSource.indexOf('router.post("/scouting/assignments"');
  const paramIdx = apiSource.indexOf('router.post("/scouting/:riderId"');
  assert.ok(assignmentsIdx !== -1 && paramIdx !== -1);
  assert.ok(assignmentsIdx < paramIdx, "assignments-routen skal registreres før :riderId-routen");
});

test("POST /api/scouting/assignments/:id/cancel er registreret + kræver auth + bruger cancelAssignment", () => {
  const idx = apiSource.indexOf('router.post("/scouting/assignments/:id/cancel"');
  assert.ok(idx !== -1, "cancel-routen skal findes");
  const block = apiSource.slice(idx, idx + 600);
  assert.match(block, /requireAuth/, "skal kræve auth");
  assert.match(block, /marketWriteLimiter/, "skal rate-limites");
  assert.match(block, /cancelAssignment\(/, "skal bruge scoutAssignmentService.cancelAssignment");
});

test("scout_system_enabled læses via readFlagStage/evaluateFlagStage (kill-switch, ikke beta-gate)", () => {
  assert.match(apiSource, /readFlagStage\(supabase, "scout_system_enabled"\)/);
  assert.match(apiSource, /evaluateFlagStage\(stage\)/);
});

test("GET /api/scouting/me rapporterer scoutSystemEnabled + jobModel-state når flaget er tændt", () => {
  const idx = apiSource.indexOf('router.get("/scouting/me"');
  assert.ok(idx !== -1, "GET /scouting/me skal findes");
  const block = apiSource.slice(idx, idx + 900);
  assert.match(block, /scoutSystemEnabled/, "skal rapportere flag-state");
  assert.match(block, /jobModel/, "skal rapportere job-model-state når flaget er tændt");
  assert.match(block, /getScoutState\(/, "job-model-state skal komme fra getScoutState");
});

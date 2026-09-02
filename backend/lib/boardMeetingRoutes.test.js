import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #4557 S-M2c · Route-hærdning for GET/POST /board/meeting, /board/meeting/focus
// og /board/meeting/sign. Business-logikken (buildBoardMeetingPayload,
// regenerateMandateFocus, signMandate, finalizeMandateGoals's budget-error)
// er fuldt unit-testet i boardMandateMeeting.test.js + boardMandate.test.js —
// denne fil scanner kildeteksten (samme mønster som boardBankGuard.routes.test.js)
// for de invarianter der kun findes i selve route-laget: auth/team-guard,
// kill-switch-tjek FØR nogen skygge-læsning, og korrekt flag-off-svar.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(method, path) {
  const marker = `router.${method}("${path}"`;
  const start = apiSource.indexOf(marker);
  assert.ok(start !== -1, `${marker} skal findes i routes/api.js`);
  const end = apiSource.indexOf("\n});", start);
  return apiSource.slice(start, end === -1 ? start + 3000 : end);
}

test("GET /board/meeting: kræver requireAuth + afviser is_ai/is_bank/is_frozen", () => {
  const block = routeBlock("get", "/board/meeting");
  assert.match(block, /requireAuth/);
  assert.match(block, /is_ai.*is_bank.*is_frozen|is_ai[\s\S]*is_bank[\s\S]*is_frozen/);
});

test("GET /board/meeting: kill-switch tjekkes FØR buildBoardMeetingPayload kaldes, flag off → { available: false }", () => {
  const block = routeBlock("get", "/board/meeting");
  const flagCheckIndex = block.indexOf("isBoardMandateModelEnabled");
  const payloadCallIndex = block.indexOf("buildBoardMeetingPayload");
  assert.ok(flagCheckIndex !== -1 && payloadCallIndex !== -1);
  assert.ok(flagCheckIndex < payloadCallIndex, "flag-tjekket skal ske FØR skygge-læsningen");
  assert.match(block, /available:\s*false/);
});

test("POST /board/meeting/focus: valid focus + flag off → 404 med available:false", () => {
  const block = routeBlock("post", "/board/meeting/focus");
  assert.match(block, /requireAuth/);
  assert.match(block, /isValidBoardFocus/);
  assert.match(block, /isBoardMandateModelEnabled/);
  assert.match(block, /res\.status\(404\)[\s\S]{0,80}available:\s*false/);
});

test("POST /board/meeting/sign: valideres (mandateId, focus, request_type) FØR signMandate kaldes", () => {
  const block = routeBlock("post", "/board/meeting/sign");
  assert.match(block, /requireAuth/);
  assert.match(block, /mandateId is required|mandate_id_required/);
  assert.match(block, /isValidBoardFocus/);
  assert.match(block, /isValidBoardRequestType/);
  const validationIndex = block.indexOf("mandate_id_required");
  const signCallIndex = block.indexOf("signMandate(");
  assert.ok(validationIndex !== -1 && signCallIndex !== -1 && validationIndex < signCallIndex);
});

test("POST /board/meeting/sign: mapper MandateAdjustmentBudgetError → 409 og MandateSignConflictError → sin egen status", () => {
  const block = routeBlock("post", "/board/meeting/sign");
  assert.match(block, /MandateAdjustmentBudgetError/);
  assert.match(block, /res\.status\(409\)/);
  assert.match(block, /MandateSignConflictError/);
});

test("de tre imports (buildBoardMeetingPayload, regenerateMandateFocus, signMandate, MandateSignConflictError) kommer fra boardMandateMeeting.js", () => {
  assert.match(apiSource, /import\s*\{[\s\S]{0,200}buildBoardMeetingPayload[\s\S]{0,200}\}\s*from\s*"\.\.\/lib\/boardMandateMeeting\.js"/);
});

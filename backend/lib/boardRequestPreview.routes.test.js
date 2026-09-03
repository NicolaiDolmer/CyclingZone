// #4519 · POST /board/request/preview skal ALDRIG skrive noget — den er hele
// pointen med issuet (thelamba 31/8: et board-request blev anvendt uden
// bekræftelse, og at fortryde krævede en genforhandling af hele planen).
//
// Kildeteksts-scan (samme mønster som boardBankGuard.routes.test.js og
// boardEvalContext.test.js's forward-guards): beviser at preview-routens
// handler-blok hverken opdaterer board_profiles, indsætter i
// board_request_log, eller sender en notifikation — uden at kræve en live
// DB/supertest-harness.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeHandlerBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start !== -1, `${marker} skal findes`);
  // Handleren er den næste balancerede "});" der lukker router.post(...) —
  // findes ved at lede efter den næste linje der starter en NY router.-
  // registrering (samme "næste marker afgrænser blokken"-mønster som de
  // andre kildeteksts-scan-tests i denne fil-familie).
  const nextRouteIdx = source.indexOf("\nrouter.", start + marker.length);
  return source.slice(start, nextRouteIdx === -1 ? source.length : nextRouteIdx);
}

test("POST /board/request/preview skriver ALDRIG til board_profiles", () => {
  const block = routeHandlerBlock(apiSource, 'router.post("/board/request/preview"');
  assert.doesNotMatch(
    block,
    /\.from\("board_profiles"\)\s*\.update\(/,
    "preview-routen skal aldrig kalde board_profiles.update",
  );
});

test("POST /board/request/preview skriver ALDRIG til board_request_log", () => {
  const block = routeHandlerBlock(apiSource, 'router.post("/board/request/preview"');
  assert.doesNotMatch(
    block,
    /\.from\("board_request_log"\)\s*\.insert\(/,
    "preview-routen skal aldrig kalde board_request_log.insert",
  );
});

test("POST /board/request/preview sender ALDRIG en notifikation", () => {
  const block = routeHandlerBlock(apiSource, 'router.post("/board/request/preview"');
  assert.doesNotMatch(
    block,
    /notifyTeamOwner\(/,
    "preview-routen skal aldrig sende en board_update-notifikation",
  );
});

test("POST /board/request (det skrivende endpoint) er UÆNDRET bag bekræftelsen: skriver stadig begge tabeller", () => {
  const block = routeHandlerBlock(apiSource, 'router.post("/board/request", requireAuth');
  assert.match(block, /\.from\("board_profiles"\)\s*\.update\(/);
  assert.match(block, /\.from\("board_request_log"\)\s*\.insert\(/);
  assert.match(block, /notifyTeamOwner\(/);
});

test("POST /board/request/preview og POST /board/request deler samme beregning (computeBoardRequestOutcome)", () => {
  const previewBlock = routeHandlerBlock(apiSource, 'router.post("/board/request/preview"');
  const writeBlock = routeHandlerBlock(apiSource, 'router.post("/board/request", requireAuth');
  assert.match(previewBlock, /computeBoardRequestOutcome\(req\)/);
  assert.match(writeBlock, /computeBoardRequestOutcome\(req\)/);
});

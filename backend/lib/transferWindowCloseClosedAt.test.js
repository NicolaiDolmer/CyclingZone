import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

// ============================================================
// #544 — POST /admin/transfer-window/close: SKAL sætte closed_at.
// ------------------------------------------------------------
// Forsvar-i-dybden mod sæson-loop-bug 2026-05-21. Et "racing-window"
// (status='closed' + closed_at=null) får cron'erne deadlineDay /
// squadEnforcement / seasonAutoTransition til at filtrere det fra via
// `.not("closed_at","is",null)`. Den fulde forsvar-kæde er 3-lags:
//   1. KODE-FILTER : cron'erne springer closed_at=null over.
//   2. DB CHECK    : 2026-05-22-transfer-window-racing-guard.sql gør det
//                    STRUKTURELT umuligt at sætte final_whistle_sent_at /
//                    squad_enforcement_completed_at uden closed_at.
//   3. LOOP-GUARD  : seasonAutoTransition-cron'en re-fyrer aldrig på et
//                    window født med closed_at=null.
//
// Dette lag (#544) lukker hullet ved KILDEN: manuelt admin-close må aldrig
// FØDE et racing-window. Endpoint'et skal sætte closed_at samtidig med
// status='closed' — præcis som de kanoniske close-paths
// (deadlineDayReport.fireAutoCloseIfDue + seasonTransition.closePrevTransferWindow).
//
// Test-type: statisk kilde-assertion (samme mønster som
// transferWindowOpenPagination.test.js). Backend-test-infra er rene
// unit-tests med mockede Supabase-klienter (dummy SUPABASE_URL=example.supabase.co)
// — der findes INGEN integrations-test-infra mod en rigtig/preview-DB. En ægte
// DB-CHECK-test (UPDATE ... SET closed_at=NULL afvises) ville kræve sådan en
// infrastruktur og kan derfor ikke skrives her. DB-laget verificeres i stedet
// strukturelt af selve CHECK-constrainten.
// ============================================================

function isolateCloseHandler() {
  const match = apiSource.match(
    /router\.post\(\s*"\/admin\/transfer-window\/close"[\s\S]*?\n\}\);/,
  );
  assert.ok(match, "Kunne ikke isolere POST /admin/transfer-window/close-handler-block");
  return match[0];
}

test("close-handler sætter status='closed' OG closed_at i samme update (#544)", () => {
  const block = isolateCloseHandler();
  // Isolér selve update-payloaden og kræv begge felter i den.
  const updateMatch = block.match(/\.update\(\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(updateMatch, "Kunne ikke finde .update({...}) i close-handleren");
  const payload = updateMatch[0];
  assert.match(
    payload,
    /status:\s*"closed"/,
    "close-handleren skal sætte status: \"closed\"",
  );
  assert.match(
    payload,
    /closed_at:/,
    "close-handleren skal sætte closed_at sammen med status (ellers fødes et racing-window) (#544)",
  );
});

test("close-handleren stempler closed_at med en frisk ISO-timestamp (new Date().toISOString())", () => {
  const block = isolateCloseHandler();
  assert.match(
    block,
    /closed_at:\s*new Date\(\)\.toISOString\(\)/,
    "closed_at skal sættes til new Date().toISOString() — matcher de kanoniske close-paths",
  );
});

test("close-handleren efterlader ALDRIG en bar status='closed'-update uden closed_at (regression-guard)", () => {
  const block = isolateCloseHandler();
  // Det gamle, sårbare mønster: `.update({ status: "closed" })` uden closed_at.
  // Et bart status-only update fødte hybrid-tilstanden #544 advarer mod.
  assert.doesNotMatch(
    block,
    /\.update\(\s*\{\s*status:\s*"closed"\s*\}\s*\)/,
    "close-handleren må ikke bruge et bart `.update({ status: \"closed\" })` uden closed_at (#544)",
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ADMIN_ACTION_TYPE } from "./economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

// ============================================================
// #515 — admin race edit: route-ownership + audit-log contract
// ------------------------------------------------------------
// Rod-årsag: AdminPage.jsx skrev tidligere direkte til supabase.from("races")
// .update() — blev silent-blokeret af RLS (kun SELECT-policy findes på races).
// Edition_year og andre race-edits blev aldrig gemt selvom UI viste success.
// Backend PUT-endpoint erstatter den direkte supabase-skrivning.
// ============================================================

function isolatePutHandler() {
  const match = apiSource.match(
    /router\.put\(\s*"\/admin\/races\/:raceId"[\s\S]*?\n\}\);/,
  );
  assert.ok(match, "Kunne ikke isolere PUT /admin/races/:raceId-handler-block");
  return match[0];
}

test("PUT /admin/races/:raceId er auth-gated + rate-limited", () => {
  assert.match(
    apiSource,
    /router\.put\(\s*"\/admin\/races\/:raceId"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/,
    "PUT /admin/races/:raceId skal være auth-gated via requireAdmin + adminWriteLimiter",
  );
});

test("PUT /admin/races/:raceId logger til admin_log med RACE_EDITED", () => {
  const block = isolatePutHandler();
  assert.match(
    block,
    /admin_log[\s\S]*?ADMIN_ACTION_TYPE\.RACE_EDITED/,
    "PUT-handler skal insert'e til admin_log med RACE_EDITED action_type",
  );
  assert.match(block, /\bbefore\b/, "meta.before skal logge før-værdier");
  assert.match(block, /\bafter\b/, "meta.after skal logge efter-værdier");
});

test("PUT /admin/races/:raceId validerer edition_year mellem 2000 og 2099", () => {
  const block = isolatePutHandler();
  assert.match(
    block,
    /edition_year[\s\S]*?\b2000\b[\s\S]*?\b2099\b/,
    "PUT-handler skal validere edition_year mod 2000-2099 range",
  );
});

test("PUT /admin/races/:raceId validerer race_type mod ['single','stage_race']", () => {
  const block = isolatePutHandler();
  assert.match(
    block,
    /\["single",\s*"stage_race"\]/,
    "PUT-handler skal validere race_type mod single/stage_race enum",
  );
});

test("PUT /admin/races/:raceId invaliderer races cache-namespace", () => {
  const block = isolatePutHandler();
  assert.match(
    block,
    /invalidateNamespace\(\s*["']races["']\s*\)/,
    "PUT-handler skal invalidate 'races' cache så GET /api/races ser ændringen",
  );
});

test("ADMIN_ACTION_TYPE.RACE_EDITED eksisterer + matcher snake_case", () => {
  assert.equal(ADMIN_ACTION_TYPE.RACE_EDITED, "race_edited");
});

test("AdminPage.jsx bruger backend PUT-endpoint, ikke direkte supabase.update på races", () => {
  const adminPageSource = readFileSync(
    join(__dirname, "../../frontend/src/pages/AdminPage.jsx"),
    "utf8",
  );
  // Find saveRaceEdit-funktionen
  const fnMatch = adminPageSource.match(
    /async function saveRaceEdit\(\)\s*\{[\s\S]*?\n\s{2}\}/,
  );
  assert.ok(fnMatch, "Kunne ikke isolere saveRaceEdit i AdminPage.jsx");
  const body = fnMatch[0];
  assert.doesNotMatch(
    body,
    /supabase\.from\(\s*"races"\s*\)\.update/,
    "saveRaceEdit må IKKE bruge direkte supabase.from('races').update() — RLS blokerer silently",
  );
  assert.match(
    body,
    /\/api\/admin\/races\//,
    "saveRaceEdit skal kalde backend PUT /api/admin/races/:raceId",
  );
});

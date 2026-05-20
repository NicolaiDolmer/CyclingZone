import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ADMIN_ACTION_TYPE } from "./economyConstants.js";
import { buildUciMenRacePointRows, UCI_MEN_RACE_CLASSES, UCI_MEN_RESULT_TYPES } from "./uciRacePointDefaults.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

// ============================================================
// #505 — race_points editor: route-ownership + audit-log contract
// ============================================================

test("GET /admin/race-points er auth-gated via requireAdmin", () => {
  assert.match(
    apiSource,
    /router\.get\(\s*"\/admin\/race-points"\s*,\s*requireAdmin/,
    "GET /admin/race-points skal være auth-gated via requireAdmin",
  );
});

test("GET /admin/race-points/baseline er auth-gated via requireAdmin", () => {
  assert.match(
    apiSource,
    /router\.get\(\s*"\/admin\/race-points\/baseline"\s*,\s*requireAdmin/,
    "GET /admin/race-points/baseline skal være auth-gated via requireAdmin",
  );
});

test("PUT /admin/race-points/:id er auth-gated + rate-limited", () => {
  assert.match(
    apiSource,
    /router\.put\(\s*"\/admin\/race-points\/:id"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/,
    "PUT /admin/race-points/:id skal være auth-gated + rate-limited",
  );
});

test("PUT /admin/race-points/:id logger til admin_log med RACE_POINTS_EDITED", () => {
  const putBlockMatch = apiSource.match(
    /router\.put\(\s*"\/admin\/race-points\/:id"[\s\S]*?\n\}\);/,
  );
  assert.ok(putBlockMatch, "Kunne ikke isolere PUT-handler-block");
  const block = putBlockMatch[0];
  assert.match(
    block,
    /admin_log[\s\S]*?ADMIN_ACTION_TYPE\.RACE_POINTS_EDITED/,
    "PUT-handler skal insert'e til admin_log med RACE_POINTS_EDITED action_type",
  );
  assert.match(block, /\bbefore:\s*existing\.points\b/, "meta.before skal logge før-værdi");
  assert.match(block, /\bafter:\s*points\b/, "meta.after skal logge efter-værdi");
});

test("ADMIN_ACTION_TYPE.RACE_POINTS_EDITED eksisterer + matcher snake_case", () => {
  assert.equal(ADMIN_ACTION_TYPE.RACE_POINTS_EDITED, "race_points_edited");
});

test("buildUciMenRacePointRows() returnerer rows for alle 9 race_classes", () => {
  const rows = buildUciMenRacePointRows();
  const classes = new Set(rows.map((r) => r.race_class));
  for (const { key } of UCI_MEN_RACE_CLASSES) {
    assert.ok(classes.has(key), `Baseline mangler race_class ${key}`);
  }
});

test("UCI_MEN_RESULT_TYPES inkluderer alle 12 result_types (incl. Dag-varianter fra #503)", () => {
  const keys = UCI_MEN_RESULT_TYPES.map((r) => r.key);
  for (const expected of [
    "Etapeplacering", "Klassement", "Klassiker",
    "Pointtroje", "Bjergtroje", "Ungdomstroje", "Forertroje",
    "BjergtrojeDag", "PointtrojeDag", "UngdomstrojeDag",
    "EtapelobHold", "KlassikerHold",
  ]) {
    assert.ok(keys.includes(expected), `UCI_MEN_RESULT_TYPES mangler ${expected}`);
  }
});

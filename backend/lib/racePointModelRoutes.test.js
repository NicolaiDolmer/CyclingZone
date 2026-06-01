import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ADMIN_ACTION_TYPE } from "./economyConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

// ============================================================
// #894 (epic #893) — race-point-model: route-ownership + audit-log + RPC contract
// ============================================================

test("GET /admin/race-point-model er auth-gated via requireAdmin", () => {
  assert.match(
    apiSource,
    /router\.get\(\s*"\/admin\/race-point-model"\s*,\s*requireAdmin/,
    "GET /admin/race-point-model skal være auth-gated",
  );
});

test("PUT master-anker er auth-gated + rate-limited + logger model-edit", () => {
  assert.match(
    apiSource,
    /router\.put\(\s*"\/admin\/race-point-model\/master\/:result_type"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/,
    "PUT master skal være auth-gated + rate-limited",
  );
  const block = apiSource.match(
    /router\.put\(\s*"\/admin\/race-point-model\/master\/:result_type"[\s\S]*?\n\}\);/,
  );
  assert.ok(block, "Kunne ikke isolere master-PUT-block");
  assert.match(block[0], /ADMIN_ACTION_TYPE\.RACE_POINT_MODEL_EDITED/, "master-PUT logger RACE_POINT_MODEL_EDITED");
});

test("PUT kaskade-faktor er auth-gated + rate-limited + logger model-edit", () => {
  assert.match(
    apiSource,
    /router\.put\(\s*"\/admin\/race-point-model\/factor\/:race_class\/:result_type"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/,
    "PUT factor skal være auth-gated + rate-limited",
  );
  const block = apiSource.match(
    /router\.put\(\s*"\/admin\/race-point-model\/factor\/:race_class\/:result_type"[\s\S]*?\n\}\);/,
  );
  assert.ok(block, "Kunne ikke isolere factor-PUT-block");
  assert.match(block[0], /ADMIN_ACTION_TYPE\.RACE_POINT_MODEL_EDITED/, "factor-PUT logger RACE_POINT_MODEL_EDITED");
});

test("POST generate kalder regenerate_race_points RPC + logger regenerering", () => {
  assert.match(
    apiSource,
    /router\.post\(\s*"\/admin\/race-point-model\/generate"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/,
    "POST generate skal være auth-gated + rate-limited",
  );
  const block = apiSource.match(
    /router\.post\(\s*"\/admin\/race-point-model\/generate"[\s\S]*?\n\}\);/,
  );
  assert.ok(block, "Kunne ikke isolere generate-block");
  assert.match(block[0], /supabase\.rpc\(\s*"regenerate_race_points"\s*\)/, "generate kalder regenerate_race_points RPC");
  assert.match(block[0], /ADMIN_ACTION_TYPE\.RACE_POINTS_REGENERATED/, "generate logger RACE_POINTS_REGENERATED");
});

test("nye ADMIN_ACTION_TYPE-værdier eksisterer + matcher snake_case", () => {
  assert.equal(ADMIN_ACTION_TYPE.RACE_POINT_MODEL_EDITED, "race_point_model_edited");
  assert.equal(ADMIN_ACTION_TYPE.RACE_POINTS_REGENERATED, "race_points_regenerated");
});

test("migration definerer regenerate_race_points() + 3 model-tabeller", () => {
  const sql = readFileSync(join(__dirname, "../../database/2026-06-01-race-point-model.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.race_point_template/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.race_point_master/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.race_point_cascade/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.regenerate_race_points/);
});

test("admin_log CHECK-migration inkluderer de nye action-typer", () => {
  const sql = readFileSync(join(__dirname, "../../database/2026-06-01-race-point-model-admin-actions.sql"), "utf8");
  assert.match(sql, /'race_point_model_edited'/);
  assert.match(sql, /'race_points_regenerated'/);
});

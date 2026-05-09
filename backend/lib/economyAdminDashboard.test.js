import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { computeDebtRatio, computeSustainabilityTier } from "./economyAdminDashboard.js";

test("sustainability tier — green when no debt", () => {
  assert.equal(computeSustainabilityTier(0, 1200000), "green");
  assert.equal(computeSustainabilityTier(599999, 1200000), "green");
});

test("sustainability tier — yellow at 50% threshold", () => {
  assert.equal(computeSustainabilityTier(600000, 1200000), "yellow");
  assert.equal(computeSustainabilityTier(959999, 1200000), "yellow");
});

test("sustainability tier — red at 80% threshold", () => {
  assert.equal(computeSustainabilityTier(960000, 1200000), "red");
  assert.equal(computeSustainabilityTier(1500000, 1200000), "red");
});

test("sustainability tier — falls back to green when ceiling is missing", () => {
  assert.equal(computeSustainabilityTier(50000, 0), "green");
  assert.equal(computeSustainabilityTier(50000, null), "green");
  assert.equal(computeSustainabilityTier(50000, undefined), "green");
});

test("debt ratio — rounds to 3 decimals", () => {
  assert.equal(computeDebtRatio(0, 1200000), 0);
  assert.equal(computeDebtRatio(600000, 1200000), 0.5);
  assert.equal(computeDebtRatio(800000, 1200000), 0.667);
});

test("debt ratio — returns 0 when ceiling missing", () => {
  assert.equal(computeDebtRatio(100000, 0), 0);
  assert.equal(computeDebtRatio(100000, null), 0);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

test("07e admin endpoints — three GET routes exist behind requireAdmin", () => {
  assert.match(
    apiSource,
    /router\.get\(\s*"\/admin\/economy-overview"\s*,\s*requireAdmin/,
    "GET /admin/economy-overview must be admin-protected",
  );
  assert.match(
    apiSource,
    /router\.get\(\s*"\/admin\/finance-transactions"\s*,\s*requireAdmin/,
    "GET /admin/finance-transactions must be admin-protected",
  );
  assert.match(
    apiSource,
    /router\.get\(\s*"\/admin\/economy-health"\s*,\s*requireAdmin/,
    "GET /admin/economy-health must be admin-protected",
  );
});

test("07e finance-transactions endpoint clamps limit to a sane max", () => {
  assert.match(apiSource, /FINANCE_TX_MAX_LIMIT\s*=\s*200/);
  assert.match(apiSource, /FINANCE_TX_DEFAULT_LIMIT\s*=\s*50/);
});

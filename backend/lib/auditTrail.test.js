import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ACTION_TYPE,
  FINANCE_ACTOR_TYPE,
  FINANCE_RELATED_ENTITY,
  FINANCE_REASON,
} from "./economyConstants.js";

// CHECK-constraint listen i database/2026-05-09-audit-log-foundation.sql.
// Hvis denne liste og DB-constraint divergerer fejler INSERT på prod højlydt.
const MIGRATION_ADMIN_ACTION_TYPES = new Set([
  "auction_cancel",
  "transfer_offer_admin_cancel",
  "swap_offer_admin_cancel",
  "loan_agreement_admin_cancel",
  "auction_config_update",
  "market_pause",
  "market_resume",
  "balance_adjustment",
  "user_deleted",
  "role_changed",
  "race_deleted",
  "race_results_imported",
  "race_results_approved",
  "beta_reset",
  "prize_force_paid",
  "season_repaired",
  "season_started",
  "season_ended",
  "discord_webhook_added",
  "discord_webhook_removed",
  "manual_override",
  "economy_export",
  "team_data_edited",
  "rider_data_edited",
]);

const MIGRATION_ACTOR_TYPES = new Set(["cron", "api", "admin", "system", "migration"]);
const MIGRATION_RELATED_ENTITIES = new Set([
  "auction", "loan", "transfer", "swap", "race", "season", "manual",
]);

test("ADMIN_ACTION_TYPE values matcher CHECK-constraint i migration", () => {
  for (const value of Object.values(ADMIN_ACTION_TYPE)) {
    assert.ok(
      MIGRATION_ADMIN_ACTION_TYPES.has(value),
      `ADMIN_ACTION_TYPE.${value} mangler i migration CHECK constraint — INSERT vil fejle på prod`
    );
  }
});

test("Migration CHECK constraint dækker alle ADMIN_ACTION_TYPE enum-values", () => {
  const enumValues = new Set(Object.values(ADMIN_ACTION_TYPE));
  for (const dbValue of MIGRATION_ADMIN_ACTION_TYPES) {
    assert.ok(
      enumValues.has(dbValue),
      `Migration tillader '${dbValue}' men ingen enum-key matcher — risiko for ad-hoc strings i kode`
    );
  }
});

test("FINANCE_ACTOR_TYPE values matcher CHECK-constraint", () => {
  for (const value of Object.values(FINANCE_ACTOR_TYPE)) {
    assert.ok(
      MIGRATION_ACTOR_TYPES.has(value),
      `FINANCE_ACTOR_TYPE.${value} mangler i CHECK constraint`
    );
  }
});

test("FINANCE_RELATED_ENTITY values matcher CHECK-constraint", () => {
  for (const value of Object.values(FINANCE_RELATED_ENTITY)) {
    assert.ok(
      MIGRATION_RELATED_ENTITIES.has(value),
      `FINANCE_RELATED_ENTITY.${value} mangler i CHECK constraint`
    );
  }
});

test("Ingen dublerede string-values inden for hvert enum (forhindrer typo-fald-igennem)", () => {
  for (const [name, frozen] of Object.entries({
    ADMIN_ACTION_TYPE, FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY, FINANCE_REASON,
  })) {
    const values = Object.values(frozen);
    const unique = new Set(values);
    assert.equal(
      values.length, unique.size,
      `${name} har duplikerede string-values: ${values.length - unique.size} duplets`
    );
  }
});

test("Alle enum-values er snake_case lowercase strings (DB-konvention)", () => {
  const snakeCase = /^[a-z][a-z0-9_]*$/;
  for (const [enumName, frozen] of Object.entries({
    ADMIN_ACTION_TYPE, FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY, FINANCE_REASON,
  })) {
    for (const [key, value] of Object.entries(frozen)) {
      assert.match(
        value, snakeCase,
        `${enumName}.${key} = "${value}" overholder ikke snake_case (lowercase, _ separator)`
      );
    }
  }
});

test("Enum-objekter er Object.freeze'd (forhindrer runtime-mutation)", () => {
  for (const [name, frozen] of Object.entries({
    ADMIN_ACTION_TYPE, FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY, FINANCE_REASON,
  })) {
    assert.ok(Object.isFrozen(frozen), `${name} er ikke frozen — kan muteres ved en fejl`);
  }
});

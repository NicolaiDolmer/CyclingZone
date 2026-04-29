import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const schema = readFileSync(resolve(repoRoot, "database/schema.sql"), "utf8");

const RUNTIME_FINANCE_TYPES = [
  "admin_adjustment",
  "emergency_loan",
  "interest",
  "loan_interest",
  "loan_received",
  "loan_repayment",
  "prize",
  "salary",
  "sponsor",
  "transfer_in",
  "transfer_out",
];

const RUNTIME_NOTIFICATION_TYPES = [
  "auction_lost",
  "auction_outbid",
  "auction_won",
  "board_update",
  "emergency_loan",
  "loan_created",
  "loan_paid_off",
  "season_ended",
  "season_started",
  "transfer_counter",
  "transfer_interest",
  "transfer_offer_accepted",
  "transfer_offer_received",
  "transfer_offer_rejected",
  "transfer_offer_withdrawn",
  "watchlist_rider_listed",
];

function extractAllowedValues(table, column) {
  const tableStart = schema.indexOf(`CREATE TABLE ${table}`);
  assert.notEqual(tableStart, -1, `${table} table exists in schema`);

  const tableEnd = schema.indexOf(");", tableStart);
  const tableDefinition = schema.slice(tableStart, tableEnd);
  const columnStart = tableDefinition.indexOf(`${column} TEXT NOT NULL CHECK`);
  assert.notEqual(columnStart, -1, `${table}.${column} has a check constraint`);

  const constraint = tableDefinition.slice(columnStart);
  return new Set([...constraint.matchAll(/'([^']+)'/g)].map(match => match[1]));
}

test("runtime finance transaction types are allowed by the schema contract", () => {
  const allowed = extractAllowedValues("finance_transactions", "type");
  const missing = RUNTIME_FINANCE_TYPES.filter(type => !allowed.has(type));
  assert.deepEqual(missing, []);
});

test("runtime notification types are allowed by the schema contract", () => {
  const allowed = extractAllowedValues("notifications", "type");
  const missing = RUNTIME_NOTIFICATION_TYPES.filter(type => !allowed.has(type));
  assert.deepEqual(missing, []);
});

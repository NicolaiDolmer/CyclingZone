import test from "node:test";
import assert from "node:assert/strict";

import {
  BLOCKING_DELETE_ACTIONS,
  classifyResetFkFindings,
  fkKey,
} from "./resetFkAudit.js";
import { RESET_DELETE_TARGETS, BLOCKING_FK_BASELINE } from "./betaResetService.js";

// Minimal RPC-row factory (matcher audit_foreign_keys() output).
function fk(child_table, child_column, parent_table, delete_action) {
  return { constraint_name: `${child_table}_${child_column}_fkey`, child_table, child_column, parent_table, delete_action };
}

test("BLOCKING_DELETE_ACTIONS dækker netop NO ACTION + RESTRICT", () => {
  assert.deepEqual([...BLOCKING_DELETE_ACTIONS].sort(), ["NO ACTION", "RESTRICT"]);
});

test("fkKey er stabil og retningsbestemt child.column -> parent", () => {
  assert.equal(fkKey("finance_transactions", "related_loan_id", "loans"), "finance_transactions.related_loan_id -> loans");
});

test("en blocking FK i baseline er IKKE kritisk", () => {
  const fkRows = [fk("finance_transactions", "related_loan_id", "loans", "NO ACTION")];
  const result = classifyResetFkFindings({
    fkRows,
    deleteTargets: ["loans"],
    baseline: [{ child: "finance_transactions", column: "related_loan_id", parent: "loans", strategy: "null-before-delete" }],
  });
  assert.equal(result.blocking.length, 1);
  assert.equal(result.critical.length, 0);
});

test("en blocking FK der MANGLER i baseline er kritisk (den nye-FK-klasse vi vogter mod)", () => {
  const fkRows = [fk("some_new_table", "season_id", "seasons", "NO ACTION")];
  const result = classifyResetFkFindings({
    fkRows,
    deleteTargets: ["seasons"],
    baseline: [],
  });
  assert.equal(result.critical.length, 1);
  assert.equal(result.critical[0].child_table, "some_new_table");
  assert.match(result.critical[0].reason, /baseline/i);
});

test("RESTRICT blokerer også → kritisk hvis ikke i baseline", () => {
  const fkRows = [fk("widget", "race_id", "races", "RESTRICT")];
  const result = classifyResetFkFindings({ fkRows, deleteTargets: ["races"], baseline: [] });
  assert.equal(result.critical.length, 1);
});

test("CASCADE/SET NULL på en reset-target er IKKE blocking (Postgres rydder selv op)", () => {
  const fkRows = [
    fk("auction_bids", "auction_id", "auctions", "CASCADE"),
    fk("season_standings", "race_id", "races", "SET NULL"),
  ];
  const result = classifyResetFkFindings({ fkRows, deleteTargets: ["auctions", "races"], baseline: [] });
  assert.equal(result.blocking.length, 0);
  assert.equal(result.critical.length, 0);
});

test("NO ACTION FK mod en tabel reset IKKE sletter fra er irrelevant", () => {
  const fkRows = [fk("riders", "team_id", "teams", "NO ACTION")];
  const result = classifyResetFkFindings({ fkRows, deleteTargets: ["loans", "races", "seasons"], baseline: [] });
  assert.equal(result.blocking.length, 0);
  assert.equal(result.critical.length, 0);
});

test("baseline-entry uden tilsvarende live-FK markeres som stale (prune-kandidat, ikke kritisk)", () => {
  const result = classifyResetFkFindings({
    fkRows: [],
    deleteTargets: ["seasons"],
    baseline: [{ child: "gone_table", column: "season_id", parent: "seasons", strategy: "delete-child-first" }],
  });
  assert.equal(result.critical.length, 0);
  assert.equal(result.stale.length, 1);
  assert.equal(result.stale[0].child, "gone_table");
});

test("baseline-entry markeret unhandled:true er kritisk selvom FK'en er kendt (kendt-gap-guard)", () => {
  const fkRows = [fk("legacy", "season_id", "seasons", "NO ACTION")];
  const result = classifyResetFkFindings({
    fkRows,
    deleteTargets: ["seasons"],
    baseline: [{ child: "legacy", column: "season_id", parent: "seasons", unhandled: true }],
  });
  assert.equal(result.critical.length, 1);
  assert.match(result.critical[0].reason, /unhandled|uhåndteret/i);
});

// Integrationskobling: den faktiske checked-in baseline skal være intern konsistent —
// hver entry peger på en RESET_DELETE_TARGET (ellers er den meningsløs).
test("BLOCKING_FK_BASELINE: hver entry peger på en RESET_DELETE_TARGET-parent", () => {
  const targets = new Set(RESET_DELETE_TARGETS);
  for (const entry of BLOCKING_FK_BASELINE) {
    assert.ok(targets.has(entry.parent), `baseline-entry ${fkKey(entry.child, entry.column, entry.parent)} peger på ikke-target ${entry.parent}`);
    assert.ok(entry.strategy || entry.unhandled, `baseline-entry ${fkKey(entry.child, entry.column, entry.parent)} mangler strategy/unhandled`);
  }
});

// De fire FK'er FK-auditen fandt 18/6 SKAL være i baseline (regression mod at nogen fjerner dem).
test("BLOCKING_FK_BASELINE indeholder alle fire 18/6-FK'er", () => {
  const keys = new Set(BLOCKING_FK_BASELINE.map((e) => fkKey(e.child, e.column, e.parent)));
  for (const k of [
    "finance_transactions.related_loan_id -> loans",
    "finance_transactions.race_id -> races",
    "board_profiles.season_start_anchor_season_id -> seasons",
    "academy_graduation.season_id -> seasons",
  ]) {
    assert.ok(keys.has(k), `mangler 18/6-FK i baseline: ${k}`);
  }
});

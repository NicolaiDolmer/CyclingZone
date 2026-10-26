import test from "node:test";
import assert from "node:assert/strict";

import { summarizeTransitionReadiness, TRANSITION_CHECK_LABELS } from "./seasonTransitionGate.js";

function readinessWith(overrides = {}) {
  const okCheck = { ok: true, critical: true, detail: null };
  return {
    ready: false,
    checks: {
      season_end_completed: { ...okCheck },
      no_deferred_transfers: { ...okCheck },
      squad_enforcement_completed: { ...okCheck },
      no_active_auctions: { ...okCheck },
      all_races_completed: { ...okCheck },
      ...overrides,
    },
  };
}

test("summarizeTransitionReadiness — null/manglende readiness er known=false og blokerer ikke", () => {
  // Graceful degradation: gammel backend-deploy uden readiness i preview må
  // ikke fryse UI'et — server-gaten er den egentlige guard.
  for (const input of [null, undefined, {}, { checks: null }]) {
    const gate = summarizeTransitionReadiness(input);
    assert.equal(gate.known, false);
    assert.equal(gate.blocked, false);
    assert.deepEqual(gate.rows, []);
    assert.deepEqual(gate.failed, []);
  }
});

test("summarizeTransitionReadiness — alle checks ok giver blocked=false og 5 rækker", () => {
  const gate = summarizeTransitionReadiness(readinessWith());
  assert.equal(gate.known, true);
  assert.equal(gate.blocked, false);
  assert.equal(gate.rows.length, 5);
  assert.deepEqual(gate.failed, []);
});

test("summarizeTransitionReadiness — kritisk fail blokerer og bærer dansk label + detail", () => {
  const gate = summarizeTransitionReadiness(readinessWith({
    no_deferred_transfers: { ok: false, critical: true, detail: "2 gennemførte transfers venter" },
  }));
  assert.equal(gate.blocked, true);
  assert.equal(gate.failed.length, 1);
  assert.equal(gate.failed[0].key, "no_deferred_transfers");
  assert.equal(gate.failed[0].label, TRANSITION_CHECK_LABELS.no_deferred_transfers);
  assert.equal(gate.failed[0].detail, "2 gennemførte transfers venter");
});

test("summarizeTransitionReadiness — ukendt check-key falder tilbage til key som label", () => {
  const gate = summarizeTransitionReadiness(readinessWith({
    future_check: { ok: false, critical: true, detail: null },
  }));
  const row = gate.rows.find((r) => r.key === "future_check");
  assert.equal(row.label, "future_check");
  assert.equal(gate.blocked, true);
});

test("summarizeTransitionReadiness — ikke-kritisk fail blokerer ikke men vises", () => {
  const gate = summarizeTransitionReadiness(readinessWith({
    all_races_completed: { ok: false, critical: false, detail: "1 løb mangler" },
  }));
  assert.equal(gate.blocked, false);
  const row = gate.rows.find((r) => r.key === "all_races_completed");
  assert.equal(row.ok, false);
  assert.deepEqual(gate.failed, []);
});

test("#7282: advarsler vises som gul linje og blokerer ikke", () => {
  const gate = summarizeTransitionReadiness({
    checks: { all_races_completed: { ok: true, critical: true, detail: null } },
    warnings: [{ key: "season_break", detail: "2 dag(e) uden løb" }],
  });
  assert.equal(gate.blocked, false);
  const row = gate.rows.find((r) => r.key === "season_break");
  assert.equal(row.ok, false);
  assert.equal(row.critical, false);
  assert.equal(row.label, "Ingen dage uden løb før næste sæson");
});

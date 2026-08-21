// backend/lib/engine/v4/ai/teamOrderContract.test.ts
// M14 (#4030, #2478): kontrakt-tests for den frosne TeamOrder-form.
// SSOT: docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md.

import assert from "node:assert/strict";
import { test } from "node:test";
import { neutralTeamOrder, validateTeamOrder } from "./teamOrderContract.ts";

function validOrder() {
  return {
    team_id: "team-1",
    breakaway_stance: "chase" as const,
    riders: [
      { rider_id: "r1", effort: "protect" as const, try_break: false },
      { rider_id: "r2", effort: "normal" as const, try_break: true },
    ],
  };
}

test("validateTeamOrder: accepterer en korrekt formet ordre", () => {
  const result = validateTeamOrder(validOrder());
  assert.deepEqual(result, { ok: true });
});

test("validateTeamOrder: afviser ukendt top-felt (ingen side-kanaler)", () => {
  const order = { ...validOrder(), confidence: 0.8 };
  const result = validateTeamOrder(order);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(";"), /ukendt felt.*confidence/);
});

test("validateTeamOrder: afviser ukendt rytter-felt (ingen AI-only-felter)", () => {
  const order = validOrder();
  const withExtra = { ...order, riders: [{ ...order.riders[0], reason: "fordi AI'en syntes det" }, order.riders[1]] };
  const result = validateTeamOrder(withExtra);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(";"), /ukendt felt.*reason/);
});

test("validateTeamOrder: afviser ugyldig breakaway_stance-literal", () => {
  const order = { ...validOrder(), breakaway_stance: "attack" };
  const result = validateTeamOrder(order);
  assert.equal(result.ok, false);
});

test("validateTeamOrder: afviser ugyldig effort-literal", () => {
  const order = validOrder();
  order.riders[0] = { ...order.riders[0], effort: "all-out" as never };
  const result = validateTeamOrder(order);
  assert.equal(result.ok, false);
});

test("validateTeamOrder: afviser try_break som ikke er boolean", () => {
  const order = validOrder();
  order.riders[0] = { ...order.riders[0], try_break: "yes" as never };
  const result = validateTeamOrder(order);
  assert.equal(result.ok, false);
});

test("validateTeamOrder: afviser dublet rider_id", () => {
  const order = validOrder();
  order.riders[1] = { ...order.riders[1], rider_id: "r1" };
  const result = validateTeamOrder(order);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(";"), /dublet/);
});

test("validateTeamOrder: afviser tom team_id og manglende riders-array", () => {
  assert.equal(validateTeamOrder({ team_id: "", breakaway_stance: "neutral", riders: [] }).ok, false);
  assert.equal(validateTeamOrder({ team_id: "t1", breakaway_stance: "neutral", riders: "nope" }).ok, false);
});

test("validateTeamOrder: afviser non-objekt input", () => {
  assert.equal(validateTeamOrder(null).ok, false);
  assert.equal(validateTeamOrder("order").ok, false);
  assert.equal(validateTeamOrder([1, 2]).ok, false);
});

test("neutralTeamOrder: T4-defaults (neutral/normal/ingen break-flag), validerer", () => {
  const order = neutralTeamOrder("team-9", ["r1", "r2", "r3"]);
  assert.equal(order.breakaway_stance, "neutral");
  assert.equal(order.riders.length, 3);
  for (const r of order.riders) {
    assert.equal(r.effort, "normal");
    assert.equal(r.try_break, false);
  }
  assert.equal(validateTeamOrder(order).ok, true);
});

// backend/lib/engine/v4/ai/teamOrderContract.test.ts
// M14 (#4030, #2478): kontrakt-tests for den frosne TeamOrder-form.
// SSOT: docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyStageOverlayToOrder,
  defaultOrderForRole,
  defaultTeamOrderForRoster,
  neutralTeamOrder,
  validateTeamOrder,
} from "./teamOrderContract.ts";

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

// ── #4246 (ejer 27/8 + 2/9): rollen ER standardordren ────────────────────────

test("#4246: race_role afvises som felt paa en rytter-ordre (rollen bor i holdudtagelsen)", () => {
  const order = validOrder();
  const withRole = { ...order, riders: [{ ...order.riders[0], race_role: "captain" }, order.riders[1]] };
  const result = validateTeamOrder(withRole);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(";"), /ukendt felt.*race_role/);
});

test("#4246: leadout er et gyldigt, VALGFRIT felt (bagudkompatibelt med gemte ordrer)", () => {
  const order = validOrder();
  assert.equal(validateTeamOrder(order).ok, true, "uden feltet");
  const withTrain = { ...order, riders: [{ ...order.riders[0], leadout: true }, order.riders[1]] };
  assert.equal(validateTeamOrder(withTrain).ok, true, "med feltet");
  const wrongType = { ...order, riders: [{ ...order.riders[0], leadout: "ja" }, order.riders[1]] };
  assert.equal(validateTeamOrder(wrongType).ok, false, "forkert type");
});

test("#4246: defaultOrderForRole — hver af de fem roller har PRAECIS én standardordre", () => {
  const cases = [
    ["hunter", { try_break: true, leadout: false }],
    ["captain", { try_break: false, leadout: false }],
    ["sprint_captain", { try_break: false, leadout: false }],
    ["free_role", { try_break: false, leadout: false }],
    ["helper", { try_break: false, leadout: true }],
  ] as const;
  for (const [role, expected] of cases) {
    const o = defaultOrderForRole("r1", role, { teamHasSprintCaptain: true });
    assert.equal(o.try_break, expected.try_break, `${role}.try_break`);
    assert.equal(o.leadout, expected.leadout, `${role}.leadout`);
    assert.equal(o.effort, "normal", `${role}.effort skal vaere rollens standard`);
  }
});

test("#4246: en hjaelper har kun et tog at koere i naar holdet har en spurt-kaptajn", () => {
  assert.equal(defaultOrderForRole("r1", "helper", { teamHasSprintCaptain: false }).leadout, false);
  assert.equal(defaultOrderForRole("r1", "helper").leadout, false);
});

test("#4246: defaultTeamOrderForRoster giver en ordre der bestaar kontrakten", () => {
  const order = defaultTeamOrderForRoster("t1", [
    { rider_id: "cap", role: "captain" },
    { rider_id: "spr", role: "sprint_captain" },
    { rider_id: "hun", role: "hunter" },
    { rider_id: "hlp", role: "helper" },
  ]);
  assert.equal(order.breakaway_stance, "neutral");
  assert.deepEqual(validateTeamOrder(order), { ok: true });
  assert.deepEqual(order.riders.map((r) => r.rider_id), ["cap", "spr", "hun", "hlp"]);
});

test("#4246: overlayet aendrer kun det der er valgt — resten er rollens standard", () => {
  const base = defaultTeamOrderForRoster("t1", [
    { rider_id: "hun", role: "hunter" },
    { rider_id: "hlp", role: "helper" },
  ]);
  const merged = applyStageOverlayToOrder(base, {
    breakaway_stance: "chase",
    riders: [{ rider_id: "hun", try_break: false }],
  });
  assert.equal(merged.breakaway_stance, "chase");
  assert.equal(merged.riders[0].try_break, false, "dagens valg vinder");
  assert.equal(merged.riders[0].effort, "normal", "urort felt = rollens standard");
  assert.equal(merged.riders[1].leadout, false, "urort rytter er uaendret");
  // Uden overlay er ordren identisk med standardordren.
  assert.deepEqual(applyStageOverlayToOrder(base, null), base);
});

test("#4246: overlayet kan ikke tilfoeje ryttere til holdet", () => {
  const base = defaultTeamOrderForRoster("t1", [{ rider_id: "hlp", role: "helper" }]);
  const merged = applyStageOverlayToOrder(base, { riders: [{ rider_id: "smuglet-ind", try_break: true }] });
  assert.deepEqual(merged.riders.map((r) => r.rider_id), ["hlp"]);
});

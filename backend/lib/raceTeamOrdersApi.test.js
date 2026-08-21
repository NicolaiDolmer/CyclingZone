// Tests for F3 taktik-ordrer v1 (#4030/#3855) — rene funktioner i raceTeamOrdersApi.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateTeamOrder,
  isStageLocked,
  neutralTeamOrder,
  normalizeTeamOrder,
  VALID_BREAKAWAY_STANCES,
} from "./raceTeamOrdersApi.js";

const NOW = new Date("2026-08-25T10:00:00Z");
const TEAM_RIDERS = new Set(["r1", "r2", "r3"]);

const baseArgs = {
  raceCompleted: false,
  stageNumber: 2,
  stageCount: 5,
  stagesCompleted: 1,
  scheduledAt: "2026-08-25T12:00:00Z", // etape 2 starter om 2 timer
  teamRiderIds: TEAM_RIDERS,
  now: NOW,
};
const validOrder = {
  breakaway_stance: "chase",
  riders: [
    { rider_id: "r1", race_role: "captain", effort: "protect", try_break: false },
    { rider_id: "r2", race_role: "helper", effort: "normal", try_break: true },
  ],
};

test("gyldig ordre passerer", () => {
  const r = validateTeamOrder({ ...baseArgs, order: validOrder });
  assert.deepEqual(r, { ok: true, errors: [] });
});

test("T2: koert etape er laast uanset schedule", () => {
  assert.equal(isStageLocked({ stageNumber: 1, stagesCompleted: 1, scheduledAt: null, now: NOW }), true);
  const r = validateTeamOrder({ ...baseArgs, stageNumber: 1, order: validOrder });
  assert.equal(r.errors[0], "team_orders_stage_locked");
});

test("T2: etapestart passeret = laast; foer start = aaben; manglende schedule = aaben", () => {
  assert.equal(isStageLocked({ stageNumber: 2, stagesCompleted: 1, scheduledAt: "2026-08-25T09:00:00Z", now: NOW }), true);
  assert.equal(isStageLocked({ stageNumber: 2, stagesCompleted: 1, scheduledAt: "2026-08-25T12:00:00Z", now: NOW }), false);
  assert.equal(isStageLocked({ stageNumber: 2, stagesCompleted: 1, scheduledAt: null, now: NOW }), false);
});

test("completed loeb afviser alt", () => {
  const r = validateTeamOrder({ ...baseArgs, raceCompleted: true, order: validOrder });
  assert.equal(r.errors[0], "team_orders_race_completed");
});

test("ugyldigt etapenummer afvises", () => {
  for (const sn of [0, 6, 1.5, NaN]) {
    const r = validateTeamOrder({ ...baseArgs, stageNumber: sn, order: validOrder });
    assert.equal(r.errors[0], "team_orders_invalid_stage", `stage ${sn}`);
  }
});

test("fremmed rytter, ugyldig rolle/effort/stance og dubletter afvises", () => {
  const bad = (order) => validateTeamOrder({ ...baseArgs, order }).errors;
  assert.ok(bad({ riders: [{ rider_id: "fremmed", race_role: "helper", effort: "normal" }] })
    .includes("team_orders_rider_not_entered"));
  assert.ok(bad({ riders: [{ rider_id: "r1", race_role: "chef", effort: "normal" }] })
    .includes("team_orders_invalid_role"));
  assert.ok(bad({ riders: [{ rider_id: "r1", race_role: "helper", effort: "turbo" }] })
    .includes("team_orders_invalid_effort"));
  assert.ok(bad({ breakaway_stance: "attack", riders: [] })
    .includes("team_orders_invalid_stance"));
  assert.ok(bad({ riders: [
    { rider_id: "r1", race_role: "helper", effort: "normal" },
    { rider_id: "r1", race_role: "hunter", effort: "normal" },
  ] }).includes("team_orders_duplicate_rider"));
});

test("hoejst en captain og en sprint_captain", () => {
  const r = validateTeamOrder({ ...baseArgs, order: { riders: [
    { rider_id: "r1", race_role: "captain", effort: "normal" },
    { rider_id: "r2", race_role: "captain", effort: "normal" },
  ] } });
  assert.ok(r.errors.includes("team_orders_role_overlap"));
});

test("T4: neutral default og stance-liste er spec-formen", () => {
  assert.deepEqual(neutralTeamOrder(), { breakaway_stance: "neutral", riders: [] });
  assert.deepEqual(VALID_BREAKAWAY_STANCES, ["chase", "neutral", "let_go"]);
});

test("normalizeTeamOrder: stance-default, try_break tvinges til boolean, kun kontraktfelter", () => {
  const n = normalizeTeamOrder({ riders: [
    { rider_id: "r1", race_role: "helper", effort: "save", try_break: "ja", ekstra: 42 },
  ] });
  assert.equal(n.breakaway_stance, "neutral");
  assert.deepEqual(n.riders, [{ rider_id: "r1", race_role: "helper", effort: "save", try_break: false }]);
});

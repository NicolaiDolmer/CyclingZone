// Tests for F3 taktik-ordrer v1 (#4030/#3855/#4246) — rene funktioner i raceTeamOrdersApi.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateTeamOrder,
  isStageLocked,
  neutralTeamOrder,
  normalizeTeamOrder,
  VALID_BREAKAWAY_STANCES,
  VALID_RIDER_ORDER_FIELDS,
  REJECTED_RIDER_ORDER_FIELDS,
} from "./raceTeamOrdersApi.js";
import { VALID_EFFORTS_FIVE_STEP } from "./raceRoles.js";
import {
  validateTeamOrder as validateAgainstEngineContract,
  BREAKAWAY_STANCE_VALUES,
  EFFORT_LEVEL_VALUES,
  TEAM_ORDER_RIDER_FIELDS,
} from "./engine/v4/ai/teamOrderContract.ts";

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
    { rider_id: "r1", effort: "protect", try_break: false },
    { rider_id: "r2", effort: "normal", try_break: true, leadout: true },
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

test("fremmed rytter, ugyldig effort/stance og dubletter afvises", () => {
  const bad = (order) => validateTeamOrder({ ...baseArgs, order }).errors;
  assert.ok(bad({ riders: [{ rider_id: "fremmed", effort: "normal" }] })
    .includes("team_orders_rider_not_entered"));
  assert.ok(bad({ riders: [{ rider_id: "r1", effort: "turbo" }] })
    .includes("team_orders_invalid_effort"));
  assert.ok(bad({ breakaway_stance: "attack", riders: [] })
    .includes("team_orders_invalid_stance"));
  assert.ok(bad({ riders: [
    { rider_id: "r1", effort: "normal" },
    { rider_id: "r1", effort: "normal" },
  ] }).includes("team_orders_duplicate_rider"));
});

// ── #4246 (ejer 27/8): rollen maa ALDRIG kunne saettes af taktik-kortet ───────

test("#4246: race_role i ordren afvises med 400-kode (ikke tavst ignoreret)", () => {
  const r = validateTeamOrder({ ...baseArgs, order: { riders: [
    { rider_id: "r1", race_role: "captain", effort: "normal", try_break: false },
  ] } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("team_orders_role_not_allowed"));
  // Ingen rolle-validering tilbage: koden findes slet ikke laengere.
  assert.ok(!r.errors.includes("team_orders_invalid_role"));
});

test("#4246: race_role afvises ogsaa naar vaerdien i sig selv er gyldig", () => {
  for (const role of ["captain", "sprint_captain", "helper", "hunter", "free_role"]) {
    const r = validateTeamOrder({ ...baseArgs, order: { riders: [
      { rider_id: "r1", race_role: role, effort: "normal", try_break: false },
    ] } });
    assert.equal(r.errors[0] === "team_orders_role_not_allowed" || r.errors.includes("team_orders_role_not_allowed"), true, role);
  }
});

test("ukendt felt paa en rytter-ordre afvises (ingen side-kanaler)", () => {
  const r = validateTeamOrder({ ...baseArgs, order: { riders: [
    { rider_id: "r1", effort: "normal", try_break: false, leadout_for: "r2" },
  ] } });
  assert.ok(r.errors.includes("team_orders_unknown_field"));
});

// ── #4246 (b): sprint-toget som spiller-kanal ────────────────────────────────

test("#4246: leadout er valgfrit, men skal vaere boolean naar det er sat", () => {
  assert.equal(validateTeamOrder({ ...baseArgs, order: { riders: [
    { rider_id: "r1", effort: "normal", try_break: false },
  ] } }).ok, true, "fravaerende leadout er gyldigt");
  assert.equal(validateTeamOrder({ ...baseArgs, order: { riders: [
    { rider_id: "r1", effort: "normal", try_break: false, leadout: true },
  ] } }).ok, true);
  const r = validateTeamOrder({ ...baseArgs, order: { riders: [
    { rider_id: "r1", effort: "normal", try_break: false, leadout: "ja" },
  ] } });
  assert.ok(r.errors.includes("team_orders_invalid_leadout"));
});

test("T4: neutral default og stance-liste er spec-formen", () => {
  assert.deepEqual(neutralTeamOrder(), { breakaway_stance: "neutral", riders: [] });
  assert.deepEqual(VALID_BREAKAWAY_STANCES, ["chase", "neutral", "let_go"]);
});

test("normalizeTeamOrder: stance-default, boolean-tvang, PRAECIS kontraktens felter (ingen race_role)", () => {
  const n = normalizeTeamOrder({ riders: [
    { rider_id: "r1", race_role: "helper", effort: "save", try_break: "ja", leadout: 1, ekstra: 42 },
  ] });
  assert.equal(n.breakaway_stance, "neutral");
  assert.deepEqual(n.riders, [{ rider_id: "r1", effort: "save", try_break: false, leadout: false }]);
  assert.ok(!("race_role" in n.riders[0]), "race_role skrives aldrig til raekken");
});

// ── ÉN kontrakt: API, adapter og AI kan ikke diverge ─────────────────────────

test("#4246: API'ets vokabular ER motorkontraktens (ingen fjerde kopi)", () => {
  assert.deepEqual(VALID_BREAKAWAY_STANCES, [...BREAKAWAY_STANCE_VALUES]);
  assert.deepEqual(VALID_RIDER_ORDER_FIELDS, [...TEAM_ORDER_RIDER_FIELDS]);
  assert.deepEqual(REJECTED_RIDER_ORDER_FIELDS, ["race_role"]);
  // Femtrins-intentionen (#4632) er ET vokabular paa tvaers af v3 og v4.
  assert.deepEqual([...EFFORT_LEVEL_VALUES].sort(), [...VALID_EFFORTS_FIVE_STEP].sort());
});

test("#4246: en gemt raekke fra spiller-stien ACCEPTERES af motorens kontrakt (round-trip)", () => {
  // Auditens fund 5/9: adapterens/API'ets output blev afvist af AI-kontrakten,
  // fordi spiller-stien bar race_role. Denne test er den laas.
  const saved = normalizeTeamOrder(validOrder);
  const result = validateAgainstEngineContract({ team_id: "t1", ...saved });
  assert.deepEqual(result, { ok: true }, JSON.stringify(result));
});

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  workCost,
  effortFatigueMultiplier,
  teamRaceWeightV3,
  RACE_V3_TUNING,
  GC_RELEVANT_PROFILES,
  FLAT_LEADOUT_PROFILES,
  VALID_RACE_ROLES,
} from "./raceRoles.js";

// ── work_cost(rolle, etapeprofil, effort) — spec §6 ───────────────────────────

test("helper på GC-relevant profil koster WORK_COST_HELPER_GC", () => {
  for (const p of GC_RELEVANT_PROFILES) {
    assert.equal(workCost("helper", p), RACE_V3_TUNING.WORK_COST_HELPER_GC, p);
  }
});

test("helper på flad koster WORK_COST_HELPER_FLAT (leadout)", () => {
  assert.equal(workCost("helper", "flat"), RACE_V3_TUNING.WORK_COST_HELPER_FLAT);
});

test("helper på profil uden defineret domestique-mekanik (itt/ttt/cobbles) koster 0", () => {
  for (const p of ["itt", "ttt", "cobbles", "unknown_profile"]) {
    assert.equal(workCost("helper", p), 0, p);
  }
});

test("hunter koster WORK_COST_HUNTER uanset profil (profil-uafhængig)", () => {
  for (const p of ["flat", "mountain", "itt", "cobbles", "high_mountain"]) {
    assert.equal(workCost("hunter", p), RACE_V3_TUNING.WORK_COST_HUNTER, p);
  }
});

test("captain/sprint_captain betaler 0 uanset profil", () => {
  for (const role of ["captain", "sprint_captain"]) {
    for (const p of ["flat", "mountain", "hilly"]) {
      assert.equal(workCost(role, p), 0, `${role}/${p}`);
    }
  }
});

test("free_role koster 0 uanset profil (kør dit eget løb)", () => {
  for (const p of ["flat", "mountain", "hilly", "itt"]) {
    assert.equal(workCost("free_role", p), 0, p);
  }
});

test("ukendt/manglende rolle koster 0 (defensivt, som v1)", () => {
  assert.equal(workCost(undefined, "mountain"), 0);
  assert.equal(workCost(null, "mountain"), 0);
  assert.equal(workCost("nonsense", "mountain"), 0);
});

// ── effort-skalering (spec §8, S3-seam) ───────────────────────────────────────

test("effort='save' halverer work-cost; 'normal'/'protect' = fuld pris", () => {
  const full = workCost("helper", "mountain", "normal");
  assert.equal(workCost("helper", "mountain", "protect"), full, "protect = fuld pris");
  assert.equal(workCost("helper", "mountain"), full, "default = 'normal' = fuld pris");
  assert.equal(workCost("helper", "mountain", "save"), full * 0.5, "save = halv pris");
});

test("free_role/captain forbliver 0 uanset effort (0 × alt = 0)", () => {
  for (const effort of ["protect", "normal", "save"]) {
    assert.equal(workCost("free_role", "mountain", effort), 0);
    assert.equal(workCost("captain", "mountain", effort), 0);
  }
});

// ── Trætheds-kobling (dormant seam, spec §6 kobling til stageEnteringFatigues) ─

test("effortFatigueMultiplier: protect +20%, save -30%, normal/default uændret", () => {
  assert.equal(effortFatigueMultiplier("protect"), 1.2);
  assert.equal(effortFatigueMultiplier("save"), 0.7);
  assert.equal(effortFatigueMultiplier("normal"), 1.0);
  assert.equal(effortFatigueMultiplier(), 1.0, "default = 'normal'");
  assert.equal(effortFatigueMultiplier(undefined), 1.0);
});

// ── #6079: save's træthed pr. etapeprofil, KUN under orders_gc_v1 ─────────────

const ALL_PROFILES_6079 = ["flat", "rolling", "hilly", "classic", "cobbles", "mountain", "high_mountain", "itt", "ttt", "unknown", null, undefined];
const ALL_EFFORTS_6079 = ["grupetto", "save", "normal", "protect", "all_out"];

test("#6079 legacy (og manglende revision) er uændret for alle profiler og trin", () => {
  for (const profileType of ALL_PROFILES_6079) {
    for (const effort of ALL_EFFORTS_6079) {
      const base = effortFatigueMultiplier(effort);
      assert.equal(effortFatigueMultiplier(effort, { profileType, rulesRevision: "legacy" }), base, `${effort}/${profileType}`);
      assert.equal(effortFatigueMultiplier(effort, { profileType }), base, `${effort}/${profileType}`);
    }
  }
});

test("#6079 orders_gc_v1: save sparer mere i bjergene og mindre på flad", () => {
  const m = (profileType) => effortFatigueMultiplier("save", { profileType, rulesRevision: "orders_gc_v1" });
  assert.ok(m("flat") > m("rolling"));
  assert.ok(m("rolling") > m("hilly"));
  assert.ok(m("hilly") > m("mountain"));
  assert.equal(m("mountain"), m("high_mountain"));
  assert.equal(m("hilly"), RACE_V3_TUNING.FATIGUE_MULTIPLIER_SAVE, "kuperet = legacy-tallet");
  assert.equal(m("itt"), RACE_V3_TUNING.FATIGUE_MULTIPLIER_SAVE, "ukendt for tabellen = legacy");
  assert.equal(m("unknown"), RACE_V3_TUNING.FATIGUE_MULTIPLIER_SAVE);
});

test("#6079 orders_gc_v1: kun save ændres, og trappen vender aldrig (grupetto <= save < normal)", () => {
  for (const profileType of ALL_PROFILES_6079) {
    const ctx = { profileType, rulesRevision: "orders_gc_v1" };
    for (const effort of ["grupetto", "normal", "protect", "all_out"]) {
      assert.equal(effortFatigueMultiplier(effort, ctx), effortFatigueMultiplier(effort), `${effort}/${profileType}`);
    }
    const save = effortFatigueMultiplier("save", ctx);
    assert.ok(effortFatigueMultiplier("grupetto", ctx) <= save, `grupetto > save paa ${profileType}`);
    assert.ok(save < effortFatigueMultiplier("normal", ctx), `save >= normal paa ${profileType}`);
  }
});

test("#6084 orders_gc_v2 arver orders_gc_v1's save-træthed for alle profiler og trin", () => {
  for (const profileType of ALL_PROFILES_6079) {
    for (const effort of ALL_EFFORTS_6079) {
      assert.equal(
        effortFatigueMultiplier(effort, { profileType, rulesRevision: "orders_gc_v2" }),
        effortFatigueMultiplier(effort, { profileType, rulesRevision: "orders_gc_v1" }),
        `${effort}/${profileType}`,
      );
    }
  }
  assert.ok(effortFatigueMultiplier("save", { profileType: "mountain", rulesRevision: "orders_gc_v2" }) < RACE_V3_TUNING.FATIGUE_MULTIPLIER_SAVE);
});

// ── Team-vægt v1 → v3 ──────────────────────────────────────────────────────────

test("teamRaceWeightV3() returnerer det kalibrerede v3-tal (> v1's 0.024)", () => {
  assert.equal(teamRaceWeightV3(), RACE_V3_TUNING.TEAM_RACE_WEIGHT_V3);
  assert.ok(teamRaceWeightV3() > 0.024, "v3-vægten skal være markant højere end v1 (spec §16.2: A — MARKANT)");
});

// ── Tunings-flade-invarianter ──────────────────────────────────────────────────

test("alle work-cost-konstanter er negative eller 0 (aldrig en bonus)", () => {
  for (const [key, v] of Object.entries(RACE_V3_TUNING)) {
    if (key.startsWith("WORK_COST_")) assert.ok(v <= 0, `${key} skal være ≤0, var ${v}`);
  }
});

test("WORK_COST_HELPER_GC er i spec-intervallet -0.03..-0.06", () => {
  assert.ok(
    RACE_V3_TUNING.WORK_COST_HELPER_GC <= -0.03 && RACE_V3_TUNING.WORK_COST_HELPER_GC >= -0.06,
    `${RACE_V3_TUNING.WORK_COST_HELPER_GC} udenfor -0.03..-0.06`
  );
});

test("GC_RELEVANT_PROFILES og FLAT_LEADOUT_PROFILES er disjunkte", () => {
  for (const p of GC_RELEVANT_PROFILES) assert.ok(!FLAT_LEADOUT_PROFILES.has(p), p);
});

// ── Rolle-vokabular forward-guard (#4246, docs/RACE_ENGINE_RULES.md §1) ───────
// SSOT: "Fem værdier. De er defineret i den frosne kontrakt —
// backend/lib/engine/v4/types.ts:35" og skrevet 100k+ gange i race_entries/
// race_stage_roles. Denne test låser PRÆCIS de fem — et sjette ord på en ny
// flade skal fejle her, ikke opdages i prod (modsigelse 3, nu løst).

test("VALID_RACE_ROLES er præcis de fem kanoniske værdier fra RACE_ENGINE_RULES.md §1", () => {
  assert.deepEqual(
    [...VALID_RACE_ROLES].sort(),
    ["captain", "free_role", "helper", "hunter", "sprint_captain"]
  );
});

test("VALID_RACE_ROLES afviser et sjette/ukendt ord", () => {
  for (const bogus of ["breakaway_leader", "gc_leader", "", "Captain", "hunter "]) {
    assert.ok(!VALID_RACE_ROLES.includes(bogus), bogus);
  }
});

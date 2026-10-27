import { readFileSync } from "node:fs";
import { createInstance } from "i18next";
import test from "node:test";
import assert from "node:assert/strict";
import {
  roleHint,
  hunterBreakawayStrength,
  stageHasBreakaway,
  ROLE_KEYS,
  ROLE_KEYS_V3,
} from "./roleHint.js";
import { TERRAIN_BUCKETS } from "./stageTerrain.js";

// ── roleHint: alle 4 roller × alle 5 buckets giver gyldige i18n-nøgler ──────────
test("roleHint: 4 roller × 5 buckets → {titleKey, descKey} under racehub.roleCard.*", () => {
  for (const role of ROLE_KEYS) {
    for (const bucket of TERRAIN_BUCKETS) {
      const hint = roleHint(role, bucket);
      assert.ok(hint, `hint for ${role}/${bucket} should exist`);
      assert.equal(typeof hint.titleKey, "string");
      assert.equal(typeof hint.descKey, "string");
      // titleKey er rolle-bestemt; descKey er rolle+terræn-bestemt.
      assert.equal(hint.titleKey, `racehub.roleCard.${role}.title`);
      assert.equal(hint.descKey, `racehub.roleCard.${role}.hint.${bucket}`);
    }
  }
});

test("roleHint: ukendt rolle → null", () => {
  assert.equal(roleHint("nonsense", "flat"), null);
  assert.equal(roleHint(null, "flat"), null);
  assert.equal(roleHint(undefined, "mountain"), null);
});

test("roleHint: ukendt/null bucket → falder tilbage til flat-hint (defensiv)", () => {
  const hint = roleHint("captain", "nonsense");
  assert.equal(hint.titleKey, "racehub.roleCard.captain.title");
  assert.equal(hint.descKey, "racehub.roleCard.captain.hint.flat");
  assert.equal(roleHint("captain", null).descKey, "racehub.roleCard.captain.hint.flat");
});

test("ROLE_KEYS: præcis de fire taktik-roller i stabil rækkefølge", () => {
  assert.deepEqual(ROLE_KEYS, ["captain", "sprint_captain", "hunter", "rider"]);
});

// #2376: v3-listen tilføjer free_role (v3-gated i UI'et, ikke i denne rene helper).
test("ROLE_KEYS_V3: de fem v3-roller (+ free_role) i stabil rækkefølge", () => {
  assert.deepEqual(ROLE_KEYS_V3, ["captain", "sprint_captain", "hunter", "free_role", "rider"]);
});

test("roleHint: free_role × alle 5 buckets → gyldige i18n-nøgler", () => {
  for (const bucket of TERRAIN_BUCKETS) {
    const hint = roleHint("free_role", bucket);
    assert.ok(hint, `hint for free_role/${bucket} should exist`);
    assert.equal(hint.titleKey, "racehub.roleCard.free_role.title");
    assert.equal(hint.descKey, `racehub.roleCard.free_role.hint.${bucket}`);
  }
});

// ── stageHasBreakaway (#6912): morgenudbrud på alle linjeløb, aldrig på tidskørsler ──
test("stageHasBreakaway: alle linjeløbsprofiler → true (også classic og high_mountain)", () => {
  for (const p of ["flat", "rolling", "hilly", "medium_mountain", "mountain", "high_mountain", "cobbles", "gravel", "classic"]) {
    assert.equal(stageHasBreakaway(p), true, p);
  }
});

test("stageHasBreakaway: enkeltstart/holdtidskørsel/ukendt/manglende → false", () => {
  for (const p of ["itt", "itt_hilly", "ttt", "nonsense", null, undefined]) {
    assert.equal(stageHasBreakaway(p), false, String(p));
  }
});

// #6912: overgangs-shim for RaceSelectionPanel; giver aldrig en fast styrke længere.
test("hunterBreakawayStrength: returnerer aldrig en fast udbrudschance", () => {
  assert.equal(hunterBreakawayStrength("high_mountain", "long_climb"), null);
  assert.equal(hunterBreakawayStrength("flat", "bunch_sprint"), null);
});

// #5289: real resources, with fallback disabled so EN cannot hide a DA gap.
for (const language of ["en", "da"]) {
  test("all roles resolve across planning, selection and tactics: " + language, async () => {
    const races = JSON.parse(readFileSync(new URL("../../public/locales/" + language + "/races.json", import.meta.url), "utf8"));
    const i18n = createInstance();
    await i18n.init({ lng: language, fallbackLng: false, defaultNS: "races", resources: { [language]: { races } } });
    const keys = ["selection.captain", "selection.sprintCaptain", "selection.hunter", "selection.freeRole", "racehub.hunterExplainer.pickTitle"];
    for (const role of ROLE_KEYS_V3) {
      keys.push("tacticsOrders.roleLabel." + (role === "rider" ? "helper" : role));
      for (const bucket of TERRAIN_BUCKETS) {
        const hint = roleHint(role, bucket);
        keys.push(hint.titleKey, hint.descKey);
      }
    }
    for (const key of new Set(keys)) {
      assert.ok(i18n.exists(key), language + ":" + key);
      assert.notEqual(i18n.t(key), key);
      assert.ok(i18n.t(key).trim());
    }
  });
}

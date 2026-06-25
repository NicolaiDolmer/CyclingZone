import test from "node:test";
import assert from "node:assert/strict";
import {
  roleHint,
  hunterBreakawayStrength,
  strengthFromBonus,
  BREAKAWAY_STRENGTH,
  ROLE_KEYS,
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

// ── strengthFromBonus: tærskel-mapping (spejler BREAKAWAY_BONUS-skalaen) ────────
test("strengthFromBonus: tærskler >=0.30 high · >=0.15 medium · >0 low · 0 none", () => {
  assert.equal(strengthFromBonus(0.50), "high");
  assert.equal(strengthFromBonus(0.30), "high");
  assert.equal(strengthFromBonus(0.29), "medium");
  assert.equal(strengthFromBonus(0.15), "medium");
  assert.equal(strengthFromBonus(0.14), "low");
  assert.equal(strengthFromBonus(0.06), "low");
  assert.equal(strengthFromBonus(0.0001), "low");
  assert.equal(strengthFromBonus(0), "none");
});

test("strengthFromBonus: ikke-endelig/negativ → none", () => {
  assert.equal(strengthFromBonus(null), "none");
  assert.equal(strengthFromBonus(undefined), "none");
  assert.equal(strengthFromBonus(NaN), "none");
  assert.equal(strengthFromBonus(-0.2), "none");
});

// ── BREAKAWAY_STRENGTH: alle (profil, finale)-kombinationer mappet korrekt ──────
// Tabellen SPEJLER backend/lib/raceSimulator.js BREAKAWAY_BONUS. Drift-guard: hvis
// nogen ændrer backend-værdierne uden at opdatere denne frontend-konstant, fanger
// disse asserts det (samme mønster som stageTerrain.test.js terrainBucket-mirror).
test("BREAKAWAY_STRENGTH: spejler raceSimulator BREAKAWAY_BONUS-tærskler eksakt", () => {
  // flat: alle 0.30 → high
  assert.equal(BREAKAWAY_STRENGTH.flat.bunch_sprint, "high");
  assert.equal(BREAKAWAY_STRENGTH.flat.reduced_sprint, "high");
  assert.equal(BREAKAWAY_STRENGTH.flat._default, "high");
  // rolling: 0.20 breakaway → medium, 0.17 reduced_sprint → medium, 0.15 bunch_sprint → medium
  assert.equal(BREAKAWAY_STRENGTH.rolling.breakaway, "medium");
  assert.equal(BREAKAWAY_STRENGTH.rolling.reduced_sprint, "medium");
  assert.equal(BREAKAWAY_STRENGTH.rolling.bunch_sprint, "medium");
  assert.equal(BREAKAWAY_STRENGTH.rolling._default, "medium");
  // hilly: 0.42/0.40/0.46 → high
  assert.equal(BREAKAWAY_STRENGTH.hilly.punch, "high");
  assert.equal(BREAKAWAY_STRENGTH.hilly.reduced_sprint, "high");
  assert.equal(BREAKAWAY_STRENGTH.hilly.breakaway, "high");
  assert.equal(BREAKAWAY_STRENGTH.hilly._default, "high");
  // mountain: descent/breakaway 0.50 → high, long_climb 0.06 → low, _default 0.45 → high
  assert.equal(BREAKAWAY_STRENGTH.mountain.descent, "high");
  assert.equal(BREAKAWAY_STRENGTH.mountain.breakaway, "high");
  assert.equal(BREAKAWAY_STRENGTH.mountain.long_climb, "low");
  assert.equal(BREAKAWAY_STRENGTH.mountain._default, "high");
  // high_mountain: descent 0.42 → high, long_climb 0.05 → low, _default 0.08 → low
  assert.equal(BREAKAWAY_STRENGTH.high_mountain.descent, "high");
  assert.equal(BREAKAWAY_STRENGTH.high_mountain.long_climb, "low");
  assert.equal(BREAKAWAY_STRENGTH.high_mountain._default, "low");
  // cobbles: 0.30 reduced_sprint → high, 0.36 breakaway → high, _default 0.28 → medium
  assert.equal(BREAKAWAY_STRENGTH.cobbles.reduced_sprint, "high");
  assert.equal(BREAKAWAY_STRENGTH.cobbles.breakaway, "high");
  assert.equal(BREAKAWAY_STRENGTH.cobbles._default, "medium");
});

// ── hunterBreakawayStrength(profileType, finaleType) ────────────────────────────
test("hunterBreakawayStrength: profil+finale → high/medium/low/none", () => {
  assert.equal(hunterBreakawayStrength("flat", "bunch_sprint"), "high");
  assert.equal(hunterBreakawayStrength("rolling", "bunch_sprint"), "medium");
  assert.equal(hunterBreakawayStrength("mountain", "long_climb"), "low");
  assert.equal(hunterBreakawayStrength("high_mountain", "long_climb"), "low");
  assert.equal(hunterBreakawayStrength("high_mountain", null), "low"); // _default 0.08
  assert.equal(hunterBreakawayStrength("hilly", "breakaway"), "high");
});

test("hunterBreakawayStrength: manglende finale → profilens _default", () => {
  assert.equal(hunterBreakawayStrength("flat", null), "high");
  assert.equal(hunterBreakawayStrength("flat", "unknown_finale"), "high");
  assert.equal(hunterBreakawayStrength("rolling", undefined), "medium");
  assert.equal(hunterBreakawayStrength("cobbles", null), "medium");
});

test("hunterBreakawayStrength: itt/ttt/classic + ukendt profil → none (intet udbrud)", () => {
  assert.equal(hunterBreakawayStrength("itt", "solo_tt"), "none");
  assert.equal(hunterBreakawayStrength("ttt", null), "none");
  assert.equal(hunterBreakawayStrength("classic", "breakaway"), "none");
  assert.equal(hunterBreakawayStrength("nonsense", null), "none");
  assert.equal(hunterBreakawayStrength(null, null), "none");
  assert.equal(hunterBreakawayStrength(undefined, undefined), "none");
});

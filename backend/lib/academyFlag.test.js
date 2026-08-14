import test from "node:test";
import assert from "node:assert/strict";
import { ACADEMY, isAcademyEnabled, youthMultiplier, isAcademyAge, academySeasonFracForAge } from "./academyFlag.js";

test("ACADEMY-konstanter", () => {
  assert.equal(ACADEMY.SLOTS, 8);
  assert.equal(ACADEMY.MIN_AGE, 16);
  assert.equal(ACADEMY.MAX_AGE, 21);
  assert.equal(ACADEMY.FLAG_KEY, "academy_enabled");
  assert.ok(ACADEMY.YOUTH_MULT > 1, "ungdoms-multiplikator > 1 (akademi-træning føles givende)");
});

test("isAcademyAge: 16-21 inklusiv", () => {
  assert.equal(isAcademyAge(15), false);
  assert.equal(isAcademyAge(16), true);
  assert.equal(isAcademyAge(21), true);
  assert.equal(isAcademyAge(22), false);
});

test("youthMultiplier: aftager mod 1.0 når alderen nærmer sig 22", () => {
  assert.ok(youthMultiplier(16) >= youthMultiplier(21), "yngst = størst boost");
  assert.equal(youthMultiplier(22), 1.0, "uden for akademi-alder = ingen boost");
});

// ── #2082/#1938: aftagende akademi-sæson-rate (ejer-godkendt 5/7) ────────────
test("academySeasonFracForAge: aftager i trin 0.16 → 0.11 → 0.08", () => {
  assert.equal(academySeasonFracForAge(16), 0.16);
  assert.equal(academySeasonFracForAge(17), 0.16);
  assert.equal(academySeasonFracForAge(18), 0.11);
  assert.equal(academySeasonFracForAge(19), 0.11);
  assert.equal(academySeasonFracForAge(20), 0.08);
  assert.equal(academySeasonFracForAge(21), 0.08);
});

test("academySeasonFracForAge: uden for akademi-alder er ligegyldig (bruges aldrig der), men kaster ikke", () => {
  assert.ok(Number.isFinite(academySeasonFracForAge(30)));
});

test("#3709 trin 5: HARD_DAILY_CAP og INTERIM_RATE_MULT er FJERNET (beslutning 13)", () => {
  // De var 1 evne-point/dag og 1/3-daempning for akademi-alder. Begge fandtes kun
  // for at bremse en model der maettede; trin 4 fjerner maetningen ved roden via
  // rolle-raten. Testen er vendt om med vilje: den vogter nu at knapperne IKKE
  // sniger sig tilbage, for genindfoeres de oven paa trin 4, falder
  // rating-medianen fra 28 til 22 — under dagens 27, for alle.
  assert.equal(ACADEMY.HARD_DAILY_CAP, undefined);
  assert.equal(ACADEMY.INTERIM_RATE_MULT, undefined);
  // Akademiet adskiller sig herefter KUN ved youthMultiplier.
  assert.equal(youthMultiplier(16), ACADEMY.YOUTH_MULT);
  assert.equal(youthMultiplier(22), 1.0);
});

test("isAcademyEnabled: fail-safe false ved fejl/fravær", async () => {
  assert.equal(await isAcademyEnabled(null), false);
  const errClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) };
  assert.equal(await isAcademyEnabled(errClient), false);
  const onClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: true }, error: null }) }) }) }) };
  assert.equal(await isAcademyEnabled(onClient), true);
});

test("isAcademyEnabled: beta-stage kun for beta-testere", async () => {
  const betaClient = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: "beta" }, error: null }) }) }) }) };
  assert.equal(await isAcademyEnabled(betaClient, { isBetaTester: true }), true);
  assert.equal(await isAcademyEnabled(betaClient, { isBetaTester: false }), false);
  assert.equal(await isAcademyEnabled(betaClient), false);
});

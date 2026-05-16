import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseUtm,
  isValidEmail,
  isValidDiscordHandle,
  validateForm,
  isHoneypotTripped,
  mapInsertError,
  buildInsertPayload,
  INITIAL_STATE,
} from "./waitlistForm.js";

// ---------- parseUtm ----------
test("parseUtm — tom/null returnerer alle null", () => {
  assert.deepEqual(parseUtm(""), { source: null, campaign: null, medium: null });
  assert.deepEqual(parseUtm(null), { source: null, campaign: null, medium: null });
  assert.deepEqual(parseUtm(undefined), { source: null, campaign: null, medium: null });
});

test("parseUtm — fuld query-string med leading ?", () => {
  assert.deepEqual(
    parseUtm("?utm_source=discord&utm_campaign=launch_29dkk&utm_medium=organic"),
    { source: "discord", campaign: "launch_29dkk", medium: "organic" }
  );
});

test("parseUtm — uden leading ?", () => {
  assert.deepEqual(
    parseUtm("utm_source=reddit&utm_medium=social"),
    { source: "reddit", campaign: null, medium: "social" }
  );
});

test("parseUtm — andre query-params ignoreres", () => {
  assert.deepEqual(
    parseUtm("?foo=bar&utm_source=email&baz=qux"),
    { source: "email", campaign: null, medium: null }
  );
});

test("parseUtm — capper værdier til 100 tegn", () => {
  const long = "x".repeat(200);
  const result = parseUtm(`?utm_source=${long}`);
  assert.equal(result.source.length, 100);
});

// ---------- isValidEmail ----------
test("isValidEmail — gyldige", () => {
  assert.equal(isValidEmail("test@example.dk"), true);
  assert.equal(isValidEmail("foo.bar+tag@sub.example.com"), true);
});

test("isValidEmail — ugyldige", () => {
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("noat"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail("a b@c.dk"), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
  assert.equal(isValidEmail(123), false);
});

// ---------- isValidDiscordHandle ----------
test("isValidDiscordHandle — moderne format (lowercase)", () => {
  assert.equal(isValidDiscordHandle("nicolai.dolmer"), true);
  assert.equal(isValidDiscordHandle("bobby_2106"), true);
  assert.equal(isValidDiscordHandle("a1"), true); // 2-char lower bound
});

test("isValidDiscordHandle — legacy format med discriminator", () => {
  assert.equal(isValidDiscordHandle("Nicolai#1234"), true);
  assert.equal(isValidDiscordHandle("Some Name#9999"), true);
});

test("isValidDiscordHandle — afvisninger", () => {
  assert.equal(isValidDiscordHandle(""), false);
  assert.equal(isValidDiscordHandle("a"), false); // <2 tegn
  assert.equal(isValidDiscordHandle("x".repeat(40)), false); // for langt
  assert.equal(isValidDiscordHandle(null), false);
});

// ---------- validateForm ----------
test("validateForm — gyldig minimal state med email", () => {
  const state = {
    ...INITIAL_STATE,
    email: "test@example.dk",
    interest_level: "very",
    preferred_tier: "supporter_monthly",
    gdpr_consent: true,
  };
  const result = validateForm(state);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, {});
});

test("validateForm — gyldig med kun Discord (uden email)", () => {
  const state = {
    ...INITIAL_STATE,
    discord_handle: "nicolai.dolmer",
    interest_level: "maybe",
    preferred_tier: "free_only",
    gdpr_consent: true,
  };
  const result = validateForm(state);
  assert.equal(result.ok, true);
});

test("validateForm — mangler både email og discord", () => {
  const state = {
    ...INITIAL_STATE,
    interest_level: "very",
    preferred_tier: "supporter_monthly",
    gdpr_consent: true,
  };
  const result = validateForm(state);
  assert.equal(result.ok, false);
  assert.ok(result.errors._contact);
});

test("validateForm — ugyldig email vises selv hvis Discord også sat", () => {
  const state = {
    ...INITIAL_STATE,
    email: "ikke-en-email",
    discord_handle: "nicolai.dolmer",
    interest_level: "very",
    preferred_tier: "supporter_monthly",
    gdpr_consent: true,
  };
  const result = validateForm(state);
  assert.equal(result.ok, false);
  assert.ok(result.errors.email);
  assert.equal(result.errors._contact, undefined); // contact requirement opfyldt via discord
});

test("validateForm — manglende GDPR-consent blokerer", () => {
  const state = {
    ...INITIAL_STATE,
    email: "test@example.dk",
    interest_level: "very",
    preferred_tier: "supporter_monthly",
    gdpr_consent: false,
  };
  const result = validateForm(state);
  assert.equal(result.ok, false);
  assert.ok(result.errors.gdpr_consent);
});

test("validateForm — manglende interest/tier", () => {
  const state = {
    ...INITIAL_STATE,
    email: "test@example.dk",
    gdpr_consent: true,
  };
  const result = validateForm(state);
  assert.equal(result.ok, false);
  assert.ok(result.errors.interest_level);
  assert.ok(result.errors.preferred_tier);
});

test("validateForm — ugyldig tier eller interest", () => {
  const result = validateForm({
    ...INITIAL_STATE,
    email: "test@example.dk",
    interest_level: "bogus",
    preferred_tier: "patron_monthly", // ikke i enum
    gdpr_consent: true,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.interest_level);
  assert.ok(result.errors.preferred_tier);
});

test("validateForm — ugyldigt country", () => {
  const result = validateForm({
    ...INITIAL_STATE,
    email: "test@example.dk",
    interest_level: "very",
    preferred_tier: "supporter_monthly",
    country: "XX",
    gdpr_consent: true,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.country);
});

test("validateForm — invalid benefit-værdi", () => {
  const result = validateForm({
    ...INITIAL_STATE,
    email: "test@example.dk",
    interest_level: "very",
    preferred_tier: "supporter_monthly",
    valued_benefits: ["founder_badge", "bogus_benefit"],
    gdpr_consent: true,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.valued_benefits);
});

// ---------- isHoneypotTripped ----------
test("isHoneypotTripped — tom string er OK", () => {
  assert.equal(isHoneypotTripped(""), false);
  assert.equal(isHoneypotTripped(null), false);
  assert.equal(isHoneypotTripped(undefined), false);
});

test("isHoneypotTripped — non-empty triggers", () => {
  assert.equal(isHoneypotTripped("bot-filled"), true);
  assert.equal(isHoneypotTripped(" "), true);
});

// ---------- mapInsertError ----------
test("mapInsertError — null returnerer null", () => {
  assert.equal(mapInsertError(null), null);
  assert.equal(mapInsertError(undefined), null);
});

test("mapInsertError — 23505 duplicate", () => {
  const r = mapInsertError({ code: "23505", message: "duplicate key value violates unique constraint" });
  assert.equal(r.kind, "duplicate");
  assert.ok(r.message.includes("står allerede på listen"));
});

test("mapInsertError — duplicate detektion via message hvis code mangler", () => {
  const r = mapInsertError({ message: "Duplicate entry" });
  assert.equal(r.kind, "duplicate");
});

test("mapInsertError — RLS violation", () => {
  const r = mapInsertError({ code: "42501", message: "new row violates row-level security policy" });
  assert.equal(r.kind, "rls");
});

test("mapInsertError — network fejl", () => {
  const r = mapInsertError({ message: "Failed to fetch" });
  assert.equal(r.kind, "network");
});

test("mapInsertError — ukendt fejl falder tilbage", () => {
  const r = mapInsertError({ message: "Something weird" });
  assert.equal(r.kind, "unknown");
  assert.equal(r.message, "Something weird");
});

// ---------- buildInsertPayload ----------
test("buildInsertPayload — fuld state + UTM mapped korrekt", () => {
  const state = {
    email: "  test@example.dk  ",
    discord_handle: "",
    interest_level: "very",
    preferred_tier: "pro_analyst_monthly",
    main_reason: "Spændende koncept",
    valued_benefits: ["founder_badge", "tactical_analysis"],
    fairness_red_line: "Ikke pay-to-win",
    follow_up_consent: true,
    country: "DK",
    gdpr_consent: true,
  };
  const utm = { source: "discord", campaign: "launch_49dkk", medium: "organic" };
  const payload = buildInsertPayload(state, utm, "2026-05-16T12:00:00.000Z");

  assert.equal(payload.email, "test@example.dk"); // trimmed
  assert.equal(payload.discord_handle, null);     // empty → null
  assert.equal(payload.contact_type, "email");
  assert.equal(payload.interest_level, "very");
  assert.equal(payload.preferred_tier, "pro_analyst_monthly");
  assert.equal(payload.main_reason, "Spændende koncept");
  assert.deepEqual(payload.valued_benefits, ["founder_badge", "tactical_analysis"]);
  assert.equal(payload.fairness_red_line, "Ikke pay-to-win");
  assert.equal(payload.follow_up_consent, true);
  assert.equal(payload.country, "DK");
  assert.equal(payload.source, "discord");
  assert.equal(payload.utm_campaign, "launch_49dkk");
  assert.equal(payload.utm_medium, "organic");
  assert.equal(payload.consent_given_at, "2026-05-16T12:00:00.000Z");
});

test("buildInsertPayload — Discord-only setter contact_type=discord", () => {
  const payload = buildInsertPayload(
    { ...INITIAL_STATE, discord_handle: "nicolai.dolmer", interest_level: "very", preferred_tier: "supporter_monthly" },
    { source: null, campaign: null, medium: null },
    "2026-05-16T12:00:00.000Z"
  );
  assert.equal(payload.email, null);
  assert.equal(payload.discord_handle, "nicolai.dolmer");
  assert.equal(payload.contact_type, "discord");
});

test("buildInsertPayload — country OTHER bliver null", () => {
  const payload = buildInsertPayload(
    { ...INITIAL_STATE, email: "test@example.dk", country: "OTHER", interest_level: "very", preferred_tier: "free_only" },
    {},
    "2026-05-16T12:00:00.000Z"
  );
  assert.equal(payload.country, null);
});

test("buildInsertPayload — tomme valued_benefits bliver null", () => {
  const payload = buildInsertPayload(
    { ...INITIAL_STATE, email: "test@example.dk", interest_level: "very", preferred_tier: "free_only", valued_benefits: [] },
    {},
    "2026-05-16T12:00:00.000Z"
  );
  assert.equal(payload.valued_benefits, null);
});

test("buildInsertPayload — uden UTM bliver alle utm-felter null", () => {
  const payload = buildInsertPayload(
    { ...INITIAL_STATE, email: "test@example.dk", interest_level: "very", preferred_tier: "free_only" },
    null,
    "2026-05-16T12:00:00.000Z"
  );
  assert.equal(payload.source, null);
  assert.equal(payload.utm_campaign, null);
  assert.equal(payload.utm_medium, null);
});

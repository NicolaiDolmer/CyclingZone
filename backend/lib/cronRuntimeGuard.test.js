// #drift-3-9 — dækning for lib/cronRuntimeGuard.js. Se selve filen for
// hændelsen (191 x 401 "permission denied for table riders" fra en lokal
// proces mod prod, 2/9-3/9) og hvorfor vagten findes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSupabaseKeyRole, evaluateCronRuntimeGuard } from "./cronRuntimeGuard.js";

function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

// ── decodeSupabaseKeyRole ────────────────────────────────────────────────────

test("decodeSupabaseKeyRole — klassisk JWT med role=service_role", () => {
  assert.equal(decodeSupabaseKeyRole(fakeJwt({ role: "service_role" })), "service_role");
});

test("decodeSupabaseKeyRole — klassisk JWT med role=anon", () => {
  assert.equal(decodeSupabaseKeyRole(fakeJwt({ role: "anon" })), "anon");
});

test("decodeSupabaseKeyRole — nyt sb_secret_-format er altid service_role", () => {
  assert.equal(decodeSupabaseKeyRole("sb_secret_abc123"), "service_role");
});

test("decodeSupabaseKeyRole — nyt sb_publishable_-format er altid anon", () => {
  assert.equal(decodeSupabaseKeyRole("sb_publishable_abc123"), "anon");
});

test("decodeSupabaseKeyRole — mangler nøgle giver null", () => {
  assert.equal(decodeSupabaseKeyRole(undefined), null);
  assert.equal(decodeSupabaseKeyRole(""), null);
  assert.equal(decodeSupabaseKeyRole("   "), null);
});

test("decodeSupabaseKeyRole — ugyldig/tilfældig streng giver null (ikke throw)", () => {
  assert.equal(decodeSupabaseKeyRole("ikke-en-noegle"), null);
  assert.equal(decodeSupabaseKeyRole("a.b.c"), null);
});

// ── evaluateCronRuntimeGuard ─────────────────────────────────────────────────

test("evaluateCronRuntimeGuard — tillader kun service_role + Railway production", () => {
  const result = evaluateCronRuntimeGuard({
    serviceKey: fakeJwt({ role: "service_role" }),
    railwayEnvironmentName: "production",
    forceLocal: undefined,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.forced, false);
});

test("evaluateCronRuntimeGuard — blokerer lokal proces med gyldig service_role-nøgle (ingen Railway-env)", () => {
  const result = evaluateCronRuntimeGuard({
    serviceKey: fakeJwt({ role: "service_role" }),
    railwayEnvironmentName: undefined,
    forceLocal: undefined,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /RAILWAY_ENVIRONMENT_NAME/);
});

test("evaluateCronRuntimeGuard — reproducerer hændelsen: anon-nøgle på Railway blokeres (ikke service_role)", () => {
  const result = evaluateCronRuntimeGuard({
    serviceKey: fakeJwt({ role: "anon" }),
    railwayEnvironmentName: "production",
    forceLocal: undefined,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /anon/);
});

test("evaluateCronRuntimeGuard — mangler nøgle helt blokeres", () => {
  const result = evaluateCronRuntimeGuard({
    serviceKey: undefined,
    railwayEnvironmentName: "production",
    forceLocal: undefined,
  });
  assert.equal(result.allowed, false);
});

test("evaluateCronRuntimeGuard — ikke-production Railway-miljø blokeres selv med service_role", () => {
  const result = evaluateCronRuntimeGuard({
    serviceKey: fakeJwt({ role: "service_role" }),
    railwayEnvironmentName: "staging",
    forceLocal: undefined,
  });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /staging/);
});

test("evaluateCronRuntimeGuard — CRON_FORCE_LOCAL=1 tillader eksplicit, og markerer forced", () => {
  const result = evaluateCronRuntimeGuard({
    serviceKey: undefined,
    railwayEnvironmentName: undefined,
    forceLocal: "1",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.forced, true);
  assert.match(result.reason, /SUPABASE_SERVICE_KEY|RAILWAY_ENVIRONMENT_NAME/);
});

test("evaluateCronRuntimeGuard — CRON_FORCE_LOCAL=false (vilkårlig anden værdi) tvinger IKKE", () => {
  const result = evaluateCronRuntimeGuard({
    serviceKey: undefined,
    railwayEnvironmentName: undefined,
    forceLocal: "0",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.forced, false);
});

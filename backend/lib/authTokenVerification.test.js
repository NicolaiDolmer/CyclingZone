/**
 * #4369 — de to grene bag requireAuth's afvisning skal kunne skelnes.
 *
 * Før svarede både "tokenet er afvist" og "kunne ikke nå Supabase" 401. Siden
 * #4350 handler frontenden på en 401 (rydder sessionen og sender spilleren til
 * login), så sammenblandingen betød at et Supabase-udfald ville logge raske
 * spillere ud. Testene her pinner begge grene og den asymmetriske tvivlsregel:
 * ved usikkerhed svarer vi "unavailable", fordi kun den modsatte fejl er
 * destruktiv.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import {
  AUTH_FAILURE_RESPONSES,
  AUTH_UNAVAILABLE_ERROR,
  authFailureReason,
  classifyAuthFailure,
  userFromClaims,
  verifyBearerToken,
  verifyBearerTokenLocally,
} from "./authTokenVerification.js";

// supabase-js's egne fejlformer, gengivet så testene ikke afhænger af
// bibliotekets interne klasser.
function authApiError({ status = 401, code = "bad_jwt", message = "invalid claim" } = {}) {
  const e = new Error(message);
  e.name = "AuthApiError";
  e.status = status;
  e.code = code;
  return e;
}

function retryableFetchError({ message = "Failed to fetch" } = {}) {
  const e = new Error(message);
  e.name = "AuthRetryableFetchError";
  e.status = 0; // supabase-js bruger 0 ved rent netværksudfald
  return e;
}

// ── classifyAuthFailure: den afviste gren (401) ──────────────────────────────

test("#4369 ægte auth-afvisning (AuthApiError 401) er 'rejected'", () => {
  const verdict = classifyAuthFailure({ user: null, error: authApiError() });
  assert.equal(verdict.outcome, "rejected");
  assert.equal(verdict.reason, "bad_jwt");
});

test("#4369 enhver 4xx fra Supabase er en afvisning, ikke et udfald", () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    const verdict = classifyAuthFailure({ user: null, error: authApiError({ status, code: `s${status}` }) });
    assert.equal(verdict.outcome, "rejected", `status ${status} er et svar fra Supabase, ikke tavshed`);
  }
});

test("#4369 svar uden fejl og uden bruger er entydigt - Supabase svarede 'ingen bruger'", () => {
  const verdict = classifyAuthFailure({ user: null, error: null });
  assert.equal(verdict.outcome, "rejected");
  assert.equal(verdict.reason, "no_user");
});

// ── classifyAuthFailure: den utilgængelige gren (503) ────────────────────────

test("#4369 AuthRetryableFetchError er et udfald, ikke en afvisning", () => {
  const verdict = classifyAuthFailure({ user: null, error: retryableFetchError() });
  assert.equal(verdict.outcome, "unavailable");
  assert.equal(verdict.reason, "AuthRetryableFetchError");
});

test("#4369 5xx fra Supabase er et udfald", () => {
  for (const status of [500, 502, 503, 504]) {
    const verdict = classifyAuthFailure({ user: null, error: authApiError({ status, code: null }) });
    assert.equal(verdict.outcome, "unavailable", `status ${status} siger intet om tokenet`);
  }
});

test("#4369 fetch-lagets kastede fejl (undici) er et udfald", () => {
  for (const name of ["TypeError", "FetchError", "AbortError", "TimeoutError", "ConnectTimeoutError"]) {
    const e = new Error("fetch failed");
    e.name = name;
    assert.equal(classifyAuthFailure({ user: null, error: e }).outcome, "unavailable", name);
  }
});

// Selve asymmetrien fixet hviler på. En ukendt fejl kan være hvad som helst;
// at kalde den en afvisning ville smide raske spillere ud, og det er den eneste
// af de to fejl der er destruktiv.
test("#4369 en ukendt fejl uden status er 'ved ikke' - og 'ved ikke' logger ikke nogen ud", () => {
  const verdict = classifyAuthFailure({ user: null, error: new Error("noget uventet") });
  assert.equal(verdict.outcome, "unavailable");
  assert.equal(verdict.reason, "Error");
});

// ── classifyAuthFailure: den grønne gren ─────────────────────────────────────

test("#4369 bruger uden fejl er authenticated", () => {
  const verdict = classifyAuthFailure({ user: { id: "u1" }, error: null });
  assert.equal(verdict.outcome, "authenticated");
});

test("#4369 en fejl vejer tungere end en bruger i svaret", () => {
  const verdict = classifyAuthFailure({ user: { id: "u1" }, error: authApiError() });
  assert.equal(verdict.outcome, "rejected", "samme regel som før: error ELLER manglende bruger = ingen adgang");
});

// ── authFailureReason: log-sikker grund ──────────────────────────────────────

test("#4369 fejlgrunden er kode > navn > no_user, og aldrig andet end det", () => {
  assert.equal(authFailureReason({ code: "bad_jwt", name: "AuthApiError" }), "bad_jwt");
  assert.equal(authFailureReason({ name: "AuthRetryableFetchError" }), "AuthRetryableFetchError");
  assert.equal(authFailureReason(null), "no_user");
  assert.equal(authFailureReason(undefined), "no_user");
});

// ── verifyBearerToken: hele kæden mod en fake klient ─────────────────────────

function fakeClient(impl) {
  return { auth: { getUser: impl } };
}

test("#4369 verifyBearerToken giver brugeren videre ved gyldigt token", async () => {
  const client = fakeClient(async () => ({ data: { user: { id: "u1" } }, error: null }));
  const verdict = await verifyBearerToken(client, "t");
  assert.equal(verdict.outcome, "authenticated");
  assert.equal(verdict.user?.id, "u1");
});

test("#4369 verifyBearerToken: afvist token -> rejected uden bruger", async () => {
  const client = fakeClient(async () => ({ data: { user: null }, error: authApiError() }));
  const verdict = await verifyBearerToken(client, "t");
  assert.equal(verdict.outcome, "rejected");
  assert.equal(verdict.user, null);
});

test("#4369 verifyBearerToken: netværksudfald -> unavailable uden bruger", async () => {
  const client = fakeClient(async () => ({ data: { user: null }, error: retryableFetchError() }));
  const verdict = await verifyBearerToken(client, "t");
  assert.equal(verdict.outcome, "unavailable");
  assert.equal(verdict.user, null);
});

// Kastede fejl må ikke slippe ud som en 500 der ligner en bug i vores egen kode.
test("#4369 verifyBearerToken fanger en kastet fejl og kalder den et udfald", async () => {
  const client = fakeClient(async () => {
    const e = new TypeError("fetch failed");
    throw e;
  });
  const verdict = await verifyBearerToken(client, "t");
  assert.equal(verdict.outcome, "unavailable");
  assert.equal(verdict.user, null);
});

test("#4369 verifyBearerToken tåler et svar uden data-felt", async () => {
  const client = fakeClient(async () => ({}));
  const verdict = await verifyBearerToken(client, "t");
  assert.equal(verdict.outcome, "rejected", "tomt svar uden fejl = Supabase svarede 'ingen bruger'");
});

// ── Kontrakten klienten aflæser ──────────────────────────────────────────────

test("#4369 401-kontrakten er uændret, og 503 bærer en distinkt kode", () => {
  assert.deepEqual(AUTH_FAILURE_RESPONSES.rejected, { status: 401, body: { error: "Invalid token" } });
  assert.deepEqual(AUTH_FAILURE_RESPONSES.unavailable, { status: 503, body: { error: "auth_unavailable" } });
  assert.equal(AUTH_UNAVAILABLE_ERROR, "auth_unavailable");
  assert.notEqual(
    AUTH_FAILURE_RESPONSES.unavailable.status,
    AUTH_FAILURE_RESPONSES.rejected.status,
    "hele pointen er at klienten kan skelne på status alene",
  );
});

// ── #7663: lokalt login-tjek (JWT) ───────────────────────────────────────────
//
// Testene kører den ÆGTE supabase-js-klient (getClaims) med rigtig ES256-krypto.
// Kun netværket er falsk: en fetch der udleverer et test-nøglesæt (JWKS) og
// tæller hvert kald til /auth/v1/user. Nøglerne genereres her i testen og
// findes ingen andre steder.

const PROJECT_URL = "https://unit-test-project.supabase.co";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function makeSigningKey(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig", key_ops: ["verify"] };
  return { privateKey, jwk, kid };
}

function signJwt(key, claims, { kid = key.kid } = {}) {
  const header = base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const payload = base64url(JSON.stringify(claims));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: key.privateKey, dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${base64url(signature)}`;
}

// AGENTS.md regel 16: testene læser aldrig vægur-tiden. supabase-js sammenligner
// `exp` med sit eget ur, som ikke kan injiceres, så tokenernes tider er faste
// og ligger årtier fra enhver realistisk (også forskudt) testmaskine-dato.
const FIXED_ISSUED_AT = Date.UTC(2020, 0, 1) / 1000;
const FIXED_VALID_UNTIL = Date.UTC(2099, 0, 1) / 1000; // gyldigt token
const FIXED_EXPIRED_AT = Date.UTC(2000, 0, 1) / 1000; // udløbet token

function userClaims(overrides = {}) {
  return {
    sub: "00000000-0000-4000-8000-000000000001",
    email: "player@example.test",
    role: "authenticated",
    aud: "authenticated",
    iat: FIXED_ISSUED_AT,
    exp: FIXED_VALID_UNTIL,
    app_metadata: { provider: "email" },
    user_metadata: {},
    ...overrides,
  };
}

/**
 * Ægte supabase-js-klient med falsk netværk.
 * @param {{ jwks?: object[], jwksFails?: boolean, userResponse?: () => Response }} opts
 */
function realClient({ jwks = [], jwksFails = false, userResponse } = {}) {
  const calls = { user: 0, jwks: 0 };
  const fakeFetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.endsWith("/auth/v1/.well-known/jwks.json")) {
      calls.jwks++;
      if (jwksFails) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ keys: jwks }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/auth/v1/user")) {
      calls.user++;
      if (userResponse) return userResponse();
      return new Response(JSON.stringify({ code: 403, error_code: "bad_jwt", msg: "invalid JWT" }), {
        status: 403, headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`uventet kald i test: ${url}`);
  };
  const client = createClient(PROJECT_URL, "unit-test-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fakeFetch },
  });
  return { client, calls };
}

function okUserResponse(id = "00000000-0000-4000-8000-000000000001") {
  return () => new Response(JSON.stringify({ id, aud: "authenticated", role: "authenticated", email: "player@example.test" }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

test("#7663 gyldigt ES256-token verificeres lokalt uden kald til /auth/v1/user", async () => {
  const key = makeSigningKey("kid-a");
  const { client, calls } = realClient({ jwks: [key.jwk] });
  const verdict = await verifyBearerToken(client, signJwt(key, userClaims()));
  assert.equal(verdict.outcome, "authenticated");
  assert.equal(verdict.user?.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(verdict.user?.email, "player@example.test");
  assert.equal(calls.user, 0, "det lokale tjek må ikke spørge Supabase Auth");
});

test("#7663 nøglesættet hentes én gang og genbruges på tværs af requests", async () => {
  const key = makeSigningKey("kid-reuse");
  const { client, calls } = realClient({ jwks: [key.jwk] });
  for (let i = 0; i < 5; i++) {
    const verdict = await verifyBearerToken(client, signJwt(key, userClaims()));
    assert.equal(verdict.outcome, "authenticated");
  }
  assert.equal(calls.jwks, 1, "fem requests, ét JWKS-opslag");
  assert.equal(calls.user, 0);
});

test("#7663 udløbet token afvises lokalt (401), uden kald til /auth/v1/user", async () => {
  const key = makeSigningKey("kid-exp");
  const { client, calls } = realClient({ jwks: [key.jwk] });
  const verdict = await verifyBearerToken(
    client,
    signJwt(key, userClaims({ iat: FIXED_EXPIRED_AT - 3600, exp: FIXED_EXPIRED_AT })),
  );
  assert.equal(verdict.outcome, "rejected");
  assert.equal(verdict.user, null);
  assert.equal(calls.user, 0);
});

test("#7663 token signeret med en fremmed nøgle men et kendt kid afvises", async () => {
  const real = makeSigningKey("kid-shared");
  const forger = makeSigningKey("kid-shared"); // samme kid, anden privat nøgle
  const { client, calls } = realClient({ jwks: [real.jwk] });
  const verdict = await verifyBearerToken(client, signJwt(forger, userClaims()));
  assert.equal(verdict.outcome, "rejected", "forkert signatur må aldrig give adgang");
  assert.equal(verdict.user, null);
  assert.equal(calls.user, 0);
});

test("#7663 et token hvis indhold er ændret efter signering afvises", async () => {
  const key = makeSigningKey("kid-tamper");
  const { client } = realClient({ jwks: [key.jwk] });
  const [h, , s] = signJwt(key, userClaims()).split(".");
  const forgedPayload = base64url(JSON.stringify(userClaims({ sub: "00000000-0000-4000-8000-000000000999" })));
  const verdict = await verifyBearerToken(client, `${h}.${forgedPayload}.${s}`);
  assert.equal(verdict.outcome, "rejected");
  assert.equal(verdict.user, null);
});

test("#7663 ødelagt token (ikke en JWT) afvises", async () => {
  const { client } = realClient({ jwks: [] });
  const verdict = await verifyBearerToken(client, "not-a-jwt");
  assert.equal(verdict.outcome, "rejected");
  assert.equal(verdict.user, null);
});

test("#7663 ukendt kid: falder tilbage til /auth/v1/user og bruger dets svar", async () => {
  const key = makeSigningKey("kid-rotated");
  const { client, calls } = realClient({ jwks: [], userResponse: okUserResponse() });
  const verdict = await verifyBearerToken(client, signJwt(key, userClaims()));
  assert.equal(calls.user >= 1, true, "ukendt nøgle afgøres af serveren, ikke lokalt");
  assert.equal(verdict.outcome, "authenticated");
});

test("#7663 JWKS kan ikke hentes: falder tilbage til det gamle kald", async () => {
  const key = makeSigningKey("kid-down");
  const ok = realClient({ jwksFails: true, userResponse: okUserResponse() });
  const verdict = await verifyBearerToken(ok.client, signJwt(key, userClaims()));
  assert.equal(verdict.outcome, "authenticated", "et JWKS-hik må ikke logge en rask spiller ud");
  assert.ok(ok.calls.user >= 1);

  // Er Supabase Auth også nede, er svaret stadig 503-grenen, aldrig 401.
  const down = realClient({ jwksFails: true, userResponse: () => { throw new TypeError("fetch failed"); } });
  const verdict2 = await verifyBearerToken(down.client, signJwt(key, userClaims()));
  assert.equal(verdict2.outcome, "unavailable");
  assert.equal(verdict2.user, null);
});

test("#7663 et signeret token der ikke er en bruger-session afgøres af serveren", async () => {
  const key = makeSigningKey("kid-anon");
  const { client, calls } = realClient({ jwks: [key.jwk] });
  // role=anon, ingen bruger: lokalt tjek må ikke give adgang, serveren svarer nej.
  const verdict = await verifyBearerToken(client, signJwt(key, userClaims({ role: "anon", sub: undefined })));
  assert.equal(verdict.outcome, "rejected");
  assert.equal(calls.user, 1);
});

// ── verifyBearerTokenLocally mod fake klienter (grænsetilfælde) ─────────────

test("#7663 klient uden getClaims bruger den gamle sti uændret", async () => {
  assert.equal(await verifyBearerTokenLocally({ auth: { getUser: async () => ({}) } }, "t"), null);
  assert.equal(await verifyBearerTokenLocally(null, "t"), null);
});

test("#7663 getClaims der kaster giver ingen afgørelse lokalt (fald tilbage)", async () => {
  const client = {
    auth: {
      getClaims: async () => { throw new Error("WebCrypto mangler"); },
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
  };
  assert.equal(await verifyBearerTokenLocally(client, "t"), null);
  const verdict = await verifyBearerToken(client, "t");
  assert.equal(verdict.outcome, "authenticated");
  assert.equal(verdict.user?.id, "u1");
});

test("#7663 kun AuthInvalidJwtError er en lokal afvisning; andre fejl spørger serveren", async () => {
  let getUserCalls = 0;
  const client = (error) => ({
    auth: {
      getClaims: async () => ({ data: null, error }),
      getUser: async () => { getUserCalls++; return { data: { user: { id: "u1" } }, error: null }; },
    },
  });
  const invalid = Object.assign(new Error("Invalid JWT signature"), { name: "AuthInvalidJwtError", status: 400, code: "invalid_jwt" });
  const local = await verifyBearerTokenLocally(client(invalid), "t");
  assert.equal(local?.outcome, "rejected");
  assert.equal(local?.reason, "invalid_jwt");

  // En 4xx fra JWKS-hentningen er IKKE et svar om tokenet: den gamle sti afgør.
  const jwks404 = authApiError({ status: 404, code: "not_found" });
  const verdict = await verifyBearerToken(client(jwks404), "t");
  assert.equal(verdict.outcome, "authenticated");
  assert.equal(getUserCalls, 1);
});

test("#7663 userFromClaims giver requireAuth de felter nedstrøms kode bruger", () => {
  const user = userFromClaims(userClaims());
  assert.equal(user.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(user.email, "player@example.test");
  assert.equal(user.role, "authenticated");
  assert.deepEqual(user.app_metadata, { provider: "email" });
  assert.equal(user.is_anonymous, false);
  const bare = userFromClaims({ sub: "x", role: "authenticated" });
  assert.equal(bare.email, null);
  assert.deepEqual(bare.user_metadata, {});
});

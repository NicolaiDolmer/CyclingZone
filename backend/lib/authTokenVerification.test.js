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

import {
  AUTH_FAILURE_RESPONSES,
  AUTH_UNAVAILABLE_ERROR,
  authFailureReason,
  classifyAuthFailure,
  verifyBearerToken,
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

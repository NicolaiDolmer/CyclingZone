import test from "node:test";
import assert from "node:assert/strict";

import {
  clearSessionExpiredFlash,
  isDefinitiveAuthDenial,
  markSessionExpired,
  peekSessionExpiredFlash,
  shouldDeclareExpired,
  tokenFromAuthHeaders,
} from "./sessionExpiry.js";

test("#4350 tokenFromAuthHeaders trækker Bearer-token ud af det kanoniske header-objekt", () => {
  assert.equal(tokenFromAuthHeaders({ Authorization: "Bearer abc.def" }), "abc.def");
  assert.equal(tokenFromAuthHeaders({ Authorization: "Bearer abc", "Content-Type": "application/json" }), "abc");
});

test("#4350 tokenFromAuthHeaders er null-sikker — authHeaders() returnerer null uden session", () => {
  assert.equal(tokenFromAuthHeaders(null), null);
  assert.equal(tokenFromAuthHeaders(undefined), null);
  assert.equal(tokenFromAuthHeaders({}), null);
  // Aldrig strengen "undefined" som token (#4347's fejlklasse).
  assert.equal(tokenFromAuthHeaders({ Authorization: "Bearer undefined" }), null);
});

// 503 er med vilje i listen: #4369 gav backendens requireAuth en egen kode for
// "kunne ikke nå Supabase til at tjekke tokenet" (503 auth_unavailable). Det
// signal må aldrig kunne logge en rask spiller ud - det er hele grunden til at
// det blev skilt ud fra 401.
test("#4350/#4369 kun 401 tæller — 200/403/5xx (inkl. 503 auth_unavailable) er ikke en afvist session", () => {
  for (const status of [200, 204, 403, 404, 500, 502, 503, 504]) {
    assert.equal(
      shouldDeclareExpired({ status, sentToken: "t1", currentToken: "t1" }),
      false,
      `status ${status} må ikke logge spilleren ud`,
    );
  }
});

test("#4350 401 med samme token som vi sendte = sessionen er død", () => {
  assert.equal(shouldDeclareExpired({ status: 401, sentToken: "t1", currentToken: "t1" }), true);
});

test("#4350 401 uden session tilbage = sessionen er død", () => {
  assert.equal(shouldDeclareExpired({ status: 401, sentToken: "t1", currentToken: null }), true);
});

// Kernen i fixet: uden denne gren ville en 401 midt i en normal token-fornyelse
// smide en rask spiller ud. Svaret nåede frem FØR fornyelsen landede, så
// 401'eren gælder et token vi ikke bruger længere.
test("#4350 401 på et token der SIDEN er fornyet = fornyelses-race, ikke udlogning", () => {
  assert.equal(shouldDeclareExpired({ status: 401, sentToken: "gammel", currentToken: "ny" }), false);
});

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  };
}

test("#4350 flash-beskeden kan læses og ryddes", () => {
  const s = fakeStorage();
  assert.equal(markSessionExpired(s), true);
  assert.equal(peekSessionExpiredFlash(s), true);
  clearSessionExpiredFlash(s);
  assert.equal(peekSessionExpiredFlash(s), false);
  assert.equal(s.size(), 0, "flaget skal være ryddet");
});

// Regressions-lås på selve fejlen der ramte i browseren: en læsning der OGSÅ
// rydder, bliver spist af React StrictModes dobbelte kald af useState-
// initializeren — banneret vises aldrig, og unit-testene er stadig grønne.
test("#4350 læsningen er ren — to kald i træk giver samme svar (StrictMode)", () => {
  const s = fakeStorage();
  markSessionExpired(s);
  assert.equal(peekSessionExpiredFlash(s), true);
  assert.equal(peekSessionExpiredFlash(s), true, "læsningen må ikke have bivirkninger");
});

test("#4350 ingen besked sat = intet banner", () => {
  assert.equal(peekSessionExpiredFlash(fakeStorage()), false);
});

test("#4350 storage der kaster (private mode) må ikke vælte udlogningen", () => {
  const throwing = {
    getItem() { throw new Error("nope"); },
    setItem() { throw new Error("nope"); },
    removeItem() { throw new Error("nope"); },
  };
  assert.equal(markSessionExpired(throwing), false);
  assert.equal(peekSessionExpiredFlash(throwing), false);
  assert.doesNotThrow(() => clearSessionExpiredFlash(throwing));
});

test("#4350 en levende bruger er aldrig en afvisning", () => {
  assert.equal(isDefinitiveAuthDenial({ user: { id: "u1" }, error: null }), false);
  assert.equal(isDefinitiveAuthDenial({ user: { id: "u1" }, error: { status: 401 } }), false);
});

test("#4350 Supabase svarede, og der er ingen bruger = entydig afvisning", () => {
  assert.equal(isDefinitiveAuthDenial({ user: null, error: null }), true);
  assert.equal(isDefinitiveAuthDenial({ user: null, error: { status: 401 } }), true);
  assert.equal(isDefinitiveAuthDenial({ user: null, error: { status: 403 } }), true);
});

// Kernen: uden denne gren logger et Supabase-udfald ALLE spillere ud, fordi
// supabase-js svarer user=null med en netværksfejl i stedet for at kaste.
// Det er samme fejlklasse som #4369, og den må ikke flytte ét lag ned.
test("#4350 'kunne ikke naa Supabase' er IKKE en afvisning", () => {
  const cases = [
    { name: "AuthRetryableFetchError", status: 0 },
    { name: "AuthRetryableFetchError" },
    { status: 500 },
    { status: 502 },
    { message: "Failed to fetch" },
  ];
  for (const error of cases) {
    assert.equal(
      isDefinitiveAuthDenial({ user: null, error }),
      false,
      `${JSON.stringify(error)} maa ikke logge spilleren ud`,
    );
  }
});

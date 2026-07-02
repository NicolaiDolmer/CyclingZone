import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAuthErrorHash, isExpiredOrDeniedAuthError } from "./authErrorHash.js";

test("udløbet confirm-link-hash parses (otp_expired)", () => {
  const hash =
    "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
  const parsed = parseAuthErrorHash(hash);
  assert.deepEqual(parsed, {
    error: "access_denied",
    errorCode: "otp_expired",
    errorDescription: "Email link is invalid or has expired",
  });
  assert.equal(isExpiredOrDeniedAuthError(parsed), true);
});

test("access_denied uden error_code trigger stadig", () => {
  const parsed = parseAuthErrorHash("#error=access_denied&error_description=denied");
  assert.equal(isExpiredOrDeniedAuthError(parsed), true);
});

test("hash uden ledende # håndteres", () => {
  const parsed = parseAuthErrorHash("error=access_denied&error_code=otp_expired");
  assert.equal(parsed?.errorCode, "otp_expired");
  assert.equal(isExpiredOrDeniedAuthError(parsed), true);
});

test("success-hash (access_token) ignoreres — ingen falsk error", () => {
  // supabase-js' detectSessionInUrl ejer dette; vi må ALDRIG reagere på det.
  const hash = "#access_token=abc123&expires_in=3600&token_type=bearer&type=signup";
  assert.equal(parseAuthErrorHash(hash), null);
});

test("tom/ikke-string/uden hash → null", () => {
  assert.equal(parseAuthErrorHash(""), null);
  assert.equal(parseAuthErrorHash("#"), null);
  assert.equal(parseAuthErrorHash(null), null);
  assert.equal(parseAuthErrorHash(undefined), null);
  assert.equal(parseAuthErrorHash(42), null);
});

test("ikke-auth-hash (fx anchor) → null", () => {
  assert.equal(parseAuthErrorHash("#section-2"), null);
  assert.equal(isExpiredOrDeniedAuthError(parseAuthErrorHash("#section-2")), false);
});

test("anden error_code (fx server_error) parses men trigger ikke expired-flow", () => {
  const parsed = parseAuthErrorHash("#error=server_error&error_code=unexpected_failure");
  assert.equal(parsed?.errorCode, "unexpected_failure");
  assert.equal(isExpiredOrDeniedAuthError(parsed), false);
});

test("isExpiredOrDeniedAuthError(null) === false", () => {
  assert.equal(isExpiredOrDeniedAuthError(null), false);
});

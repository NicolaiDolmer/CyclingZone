import assert from "node:assert/strict";
import test from "node:test";
import { isStagingSignupOtp, normalizeSignupOtp } from "./signupOtp.ts";

const STAGING_AUTH_URL = "https://pywxpnynzmbukdvoiazp.supabase.co";
const PRODUCTION_AUTH_URL = "https://ghwvkxzhsbbltzfnuhhz.supabase.co";

test("signup OTP requires both the staging build and the exact staging Auth origin", () => {
  assert.equal(isStagingSignupOtp("staging", STAGING_AUTH_URL), true);
  assert.equal(isStagingSignupOtp("production", STAGING_AUTH_URL), false);
  assert.equal(isStagingSignupOtp("staging", PRODUCTION_AUTH_URL), false);
  assert.equal(isStagingSignupOtp("staging", STAGING_AUTH_URL + ".example.test"), false);
  assert.equal(isStagingSignupOtp("staging", STAGING_AUTH_URL.replace("https:", "http:")), false);
  assert.equal(isStagingSignupOtp("staging", undefined), false);
});

test("signup OTP preserves leading zeroes and accepts pasted whitespace", () => {
  assert.equal(normalizeSignupOtp("  073\u00a0591\r\n"), "073591");
  for (const value of ["", "73591", "0735910", "073-591", "07359a"]) {
    assert.equal(normalizeSignupOtp(value), null);
  }
});

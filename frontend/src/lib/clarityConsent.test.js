import { test } from "node:test";
import assert from "node:assert/strict";
import { CLARITY_CONSENT_V2_PAYLOAD } from "./clarityConsent.js";

// #2041/#3189: without this exact consentv2 signal Clarity assigns EEA/UK/CH
// traffic a new identity per page view instead of stitching a session/user
// together — regressing the field names or values silently reintroduces the
// "sessions ~= users" bug without any build/lint error to catch it.
test("CLARITY_CONSENT_V2_PAYLOAD grants analytics storage and denies ad storage", () => {
  assert.deepEqual(CLARITY_CONSENT_V2_PAYLOAD, {
    ad_Storage: "denied",
    analytics_Storage: "granted",
  });
});

test("CLARITY_CONSENT_V2_PAYLOAD is frozen so it can't be mutated at a call site", () => {
  assert.ok(Object.isFrozen(CLARITY_CONSENT_V2_PAYLOAD));
});

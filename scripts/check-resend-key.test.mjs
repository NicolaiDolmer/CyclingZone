import test from "node:test";
import assert from "node:assert/strict";
import { classifyResendKeyProbe } from "./check-resend-key.mjs";

// Rod-aarsagen scriptet findes for (#2853, fund 8/9): en GYLDIG sende-noegle
// svarer 401 paa GET /domains. Uden dette skel konkluderede vi 2/9 at noeglen
// var ugyldig, selvom den kunne sende.
test("401 restricted_api_key = GYLDIG sende-noegle (exit 0)", () => {
  const r = classifyResendKeyProbe({ status: 401, errorName: "restricted_api_key" });
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0);
  assert.ok(r.verdict.includes("Sending access"));
});

test("401 invalid_api_key = ugyldig noegle (exit 1)", () => {
  const r = classifyResendKeyProbe({ status: 401, errorName: "invalid_api_key" });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.ok(r.verdict.includes("invalid_api_key"));
});

test("401 uden fejl-navn behandles som ugyldig - vi gaetter ikke til fordel for noeglen", () => {
  const r = classifyResendKeyProbe({ status: 401, errorName: null });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
});

test("200 = gyldig med fuld adgang", () => {
  const r = classifyResendKeyProbe({ status: 200 });
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0);
});

test("403 og andre statusser er ikke gyldige", () => {
  assert.equal(classifyResendKeyProbe({ status: 403, errorName: "forbidden" }).ok, false);
  assert.equal(classifyResendKeyProbe({ status: 500 }).ok, false);
  assert.equal(classifyResendKeyProbe({ status: 429, errorName: "rate_limit_exceeded" }).ok, false);
});

test("konklusionen naevner aldrig en noegleværdi", () => {
  for (const status of [200, 401, 403, 500]) {
    const { verdict } = classifyResendKeyProbe({ status, errorName: "restricted_api_key" });
    assert.ok(!/re_[A-Za-z0-9]/.test(verdict), "ingen noeglefragmenter i outputtet");
  }
});

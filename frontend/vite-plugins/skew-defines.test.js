// Unit-tests for skew-define-beregningen (#5170).
//
// Den vigtigste test er den første: med kode-flaget `false` skal buildet være
// bit-for-bit uafhængigt af Vercels skew-env, uanset at dashboard-toggle'en står
// til. Det var præcis den kombination der roterede 77 af 200 chunks pr. deploy.
import assert from "node:assert/strict";
import test from "node:test";

import { computeSkewDefines } from "./skew-defines.js";

const SKEW_ENV = {
  VERCEL_SKEW_PROTECTION_ENABLED: "1",
  VERCEL_ENV: "production",
  VERCEL_DEPLOYMENT_ID: "dpl_abc123",
};

const now = () => 1_757_600_000_000;

test("kode-flaget false + skew-env sat → ingen deploy-unikke værdier", () => {
  const defines = computeSkewDefines({ env: SKEW_ENV, codeFlag: false, now });
  assert.deepEqual(defines, { deploymentId: "", buildTime: 0 });
});

test("kode-flaget false giver SAMME defines for to forskellige deployments", () => {
  const a = computeSkewDefines({
    env: { ...SKEW_ENV, VERCEL_DEPLOYMENT_ID: "dpl_aaa" },
    codeFlag: false,
    now: () => 1,
  });
  const b = computeSkewDefines({
    env: { ...SKEW_ENV, VERCEL_DEPLOYMENT_ID: "dpl_bbb" },
    codeFlag: false,
    now: () => 2,
  });
  assert.deepEqual(a, b);
});

test("kode-flaget true + fuld env → id og build-tidspunkt bages ind", () => {
  const defines = computeSkewDefines({ env: SKEW_ENV, codeFlag: true, now });
  assert.deepEqual(defines, { deploymentId: "dpl_abc123", buildTime: now() });
});

test("kode-flaget true uden env → ingen deploy-unikke værdier", () => {
  assert.deepEqual(computeSkewDefines({ env: {}, codeFlag: true, now }), {
    deploymentId: "",
    buildTime: 0,
  });
});

test("kode-flaget true men Vercels toggle slået fra → slået fra", () => {
  const env = { ...SKEW_ENV, VERCEL_SKEW_PROTECTION_ENABLED: "0" };
  assert.deepEqual(computeSkewDefines({ env, codeFlag: true, now }), {
    deploymentId: "",
    buildTime: 0,
  });
});

test("preview-deploys pinnes aldrig, heller ikke med flaget true", () => {
  const env = { ...SKEW_ENV, VERCEL_ENV: "preview" };
  assert.deepEqual(computeSkewDefines({ env, codeFlag: true, now }), {
    deploymentId: "",
    buildTime: 0,
  });
});

test("manglende deployment-id giver build-tid 0, ikke Date.now()", () => {
  const env = { ...SKEW_ENV, VERCEL_DEPLOYMENT_ID: undefined };
  assert.deepEqual(computeSkewDefines({ env, codeFlag: true, now }), {
    deploymentId: "",
    buildTime: 0,
  });
});

test("et truthy men ikke-boolsk flag tæller IKKE som slået til", () => {
  for (const codeFlag of ["true", 1, {}]) {
    assert.deepEqual(
      computeSkewDefines({ env: SKEW_ENV, codeFlag, now }),
      { deploymentId: "", buildTime: 0 },
      `codeFlag=${JSON.stringify(codeFlag)} burde ikke tænde skew-defines`
    );
  }
});

test("defaults er den slukkede tilstand", () => {
  assert.deepEqual(computeSkewDefines(), { deploymentId: "", buildTime: 0 });
});

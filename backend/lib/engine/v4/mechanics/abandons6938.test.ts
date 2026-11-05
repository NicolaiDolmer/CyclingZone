// backend/lib/engine/v4/mechanics/abandons6938.test.ts
// #6938 (KUN s5_profiles_v3): U2 styrt-udgang pr. terraen. U1 er erstattet af sygdom (egen PR),
// og U3/U4 er fjernet (#7713, noRandomWithdrawals7713.test.ts). Spec: docs/superpowers/specs/
// 2026-10-23-6804-v3-tilvalg-design.md §2.2.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CRASH_ABANDON_V3_TUNING, crashSeriousShareFor, resolveIncident } from "./incidents.ts";
import { INCIDENTS_EXTRA_TUNING } from "../tuning.ts";

test("#6938 U2: andelen af styrt der udgaar kommer fra terraenet kun under s5_profiles_v3", () => {
  for (const kind of ["flat", "rolling", "climb", "descent", "cobbles"] as const) {
    assert.equal(crashSeriousShareFor(kind, false), undefined);
    assert.equal(crashSeriousShareFor(kind, true), CRASH_ABANDON_V3_TUNING.seriousShareByKind[kind]);
  }
  const shares = CRASH_ABANDON_V3_TUNING.seriousShareByKind;
  assert.ok(shares.cobbles >= shares.flat && shares.descent >= shares.flat, "brosten og nedkoersler hoejest");
  assert.ok(shares.climb <= shares.flat, "stigning lavest");
  for (const share of Object.values(shares)) assert.ok(share > INCIDENTS_EXTRA_TUNING.crashSeverityShares.serious);
});

test("#6938 U2: resolveIncident bruger terraenets andel; udeladt = tuningens egen (byte-identisk)", () => {
  const rolls = { kind: 0.99, severity: 0.08, magnitude: 0.5, injury: 0.5 };
  const ctx = { protectedByRule: false, helperNearby: false };
  assert.equal(resolveIncident(rolls, ctx, INCIDENTS_EXTRA_TUNING).severity, "hard");
  assert.equal(resolveIncident(rolls, { ...ctx, seriousShare: 0.1 }, INCIDENTS_EXTRA_TUNING).severity, "serious");
  assert.equal(resolveIncident(rolls, { ...ctx, seriousShare: 0.1 }, INCIDENTS_EXTRA_TUNING).outcome, "abandoned");
  // Mekanisk uheld kan stadig aldrig udgaa, uanset andelen.
  assert.equal(resolveIncident({ ...rolls, kind: 0 }, { ...ctx, seriousShare: 1 }, INCIDENTS_EXTRA_TUNING).outcome, "time_loss");
});

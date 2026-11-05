// #7684: kontakten for én prognose-kilde. Dækker stadierne, fail-safe, at beta-opslaget
// kun sker på beta, kataloget og seed-migrationen.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PLAYER_VISIBLE_BINARY_FLAG_KEYS, PLAYER_VISIBLE_FLAG_KEYS, findStageFlag } from "./stageFlagCatalog.js";
import { POTENTIAL_ESTIMATE_DISPLAY_FLAG_KEY, isPotentialEstimateDisplayEnabled } from "./potentialEstimateFlag.js";

// AGENTS regel 16: ingen vægur i tests.
const FIXED_NOW = Date.parse("2026-11-05T12:00:00Z");
const isEnabled = (client, opts) => isPotentialEstimateDisplayEnabled(client, { now: () => FIXED_NOW, ...opts });

function fakeSupabase(value, { fails = false } = {}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (fails
            ? { data: null, error: { message: "down" } }
            : { data: value === undefined ? null : { value }, error: null }),
        }),
      }),
    }),
  };
}

function betaProbe(answer) {
  const probe = async () => { probe.calls += 1; return answer; };
  probe.calls = 0;
  return probe;
}

test("nøglen er sin egen og ikke den pensionerede potential_single_number", () => {
  assert.equal(POTENTIAL_ESTIMATE_DISPLAY_FLAG_KEY, "potential_estimate_display");
  assert.ok(findStageFlag(POTENTIAL_ESTIMATE_DISPLAY_FLAG_KEY), "flaget skal stå i STAGE_FLAGS");
  assert.ok(PLAYER_VISIBLE_FLAG_KEYS.includes(POTENTIAL_ESTIMATE_DISPLAY_FLAG_KEY));
  assert.ok(!PLAYER_VISIBLE_BINARY_FLAG_KEYS.includes(POTENTIAL_ESTIMATE_DISPLAY_FLAG_KEY), "beta skal virke for beta-gruppen");
});

test("off, manglende række, ukendt værdi og opslagsfejl er slukket uden beta-opslag", async () => {
  for (const client of [fakeSupabase("off"), fakeSupabase(undefined), fakeSupabase("nonsense"), fakeSupabase(false), fakeSupabase("on", { fails: true })]) {
    const viewerIsBeta = betaProbe(true);
    assert.equal(await isEnabled(client, { viewerIsBeta }), false);
    assert.equal(viewerIsBeta.calls, 0);
  }
});

test("on er tændt for alle uden beta-opslag", async () => {
  for (const value of ["on", true]) {
    const viewerIsBeta = betaProbe(false);
    assert.equal(await isEnabled(fakeSupabase(value), { viewerIsBeta }), true);
    assert.equal(viewerIsBeta.calls, 0);
  }
});

test("beta er kun tændt for beta-seere", async () => {
  const beta = betaProbe(true);
  assert.equal(await isEnabled(fakeSupabase("beta"), { viewerIsBeta: beta }), true);
  assert.equal(beta.calls, 1);
  assert.equal(await isEnabled(fakeSupabase("beta"), { viewerIsBeta: betaProbe(false) }), false);
  assert.equal(await isEnabled(fakeSupabase("beta")), false, "uden seer er beta slukket");
});

test("uret når frem til flag-cachen: udløbet cache læses igen, frisk cache gør ikke", async () => {
  let queries = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => { queries += 1; return { data: { value: "on" }, error: null }; },
        }),
      }),
    }),
  };
  let clock = FIXED_NOW;
  const read = () => isPotentialEstimateDisplayEnabled(client, { now: () => clock });
  assert.equal(await read(), true);
  assert.equal(await read(), true);
  assert.equal(queries, 1);
  clock += 24 * 60 * 60 * 1000;
  assert.equal(await read(), true);
  assert.equal(queries, 2);
});

test("migrationen seeder off og overskriver aldrig et stadie ejeren har flyttet", () => {
  const sql = readFileSync(new URL("../../database/2026-11-05-6110-potential-estimate-display-flag.sql", import.meta.url), "utf8");
  assert.match(sql, /'potential_estimate_display',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING;/);
});

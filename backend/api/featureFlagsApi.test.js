// #4948 · GET /api/feature-flags: allowlist, per-viewer evaluering og
// fail-safe. Routeren koeres som en rigtig express-app paa en tilfaeldig port,
// med en falsk supabase der registrerer hvilke app_config-noegler der laeses.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createFeatureFlagsRouter, readPlayerFeatureFlags } from "./featureFlagsApi.js";
import { PLAYER_VISIBLE_FLAG_KEYS, isStageFlagKey } from "../lib/stageFlagCatalog.js";

// app_config-raekker. Ogsaa noegler der ALDRIG maa forlade serveren ad denne
// vej: et tal, en anden tre-tilstand og et ops-flag.
const BASE_ROWS = {
  race_engine_v4: "off",
  board_mandate_model_enabled: "beta",
  training_tick_per_race_day: "off",
  training_score_visible: "off",
  market_value_weekly_cap: 123,
  email_loop_enabled: "dry_run",
  stage_scheduler_enabled: "on",
};

function fakeSupabase(rows, { failKeys = [] } = {}) {
  const reads = [];
  return {
    reads,
    from(table) {
      return {
        select() {
          return {
            eq(_column, key) {
              reads.push({ table, key });
              return {
                async maybeSingle() {
                  if (failKeys.includes(key)) return { data: null, error: { message: "boom" } };
                  return Object.hasOwn(rows, key)
                    ? { data: { value: rows[key] }, error: null }
                    : { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

async function fixture(t, { rows = BASE_ROWS, betaTester = false, betaThrows = false, failKeys = [] } = {}) {
  const supabase = fakeSupabase(rows, { failKeys });
  const reported = [];
  let betaLookups = 0;
  const app = express();
  app.use("/api/feature-flags", createFeatureFlagsRouter({
    supabase,
    requireAuth: async (req, res, next) => {
      if (req.headers.authorization !== "Bearer valid") {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      req.user = { id: "viewer" };
      next();
    },
    isViewerBetaTester: async (req) => {
      betaLookups += 1;
      assert.equal(req.user?.id, "viewer", "beta-opslaget maa kun ske efter requireAuth");
      if (betaThrows) throw new Error("users lookup failed");
      return betaTester;
    },
    reportError: (error) => reported.push(error),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { port } = server.address();
  const call = (token) => fetch(`http://127.0.0.1:${port}/api/feature-flags`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { call, supabase, reported, betaLookups: () => betaLookups };
}

test("allowlisten er ikke tom, har unikke noegler, og hver noegle er et stadie-flag", () => {
  assert.ok(PLAYER_VISIBLE_FLAG_KEYS.length > 0);
  assert.equal(new Set(PLAYER_VISIBLE_FLAG_KEYS).size, PLAYER_VISIBLE_FLAG_KEYS.length);
  for (const key of PLAYER_VISIBLE_FLAG_KEYS) {
    assert.ok(isStageFlagKey(key), `${key} staar ikke i STAGE_FLAGS, men endpointet evaluerer den som et stadie-flag`);
  }
  // De fem Hjaelp-siden gater paa (#4948, #5274, #5519).
  for (const key of [
    "race_engine_v4",
    "board_mandate_model_enabled",
    "training_tick_per_race_day",
    "training_score_visible",
    "youth_squad_pages",
  ]) {
    assert.ok(PLAYER_VISIBLE_FLAG_KEYS.includes(key), `${key} mangler i allowlisten`);
  }
});

test("anonym: svarer 200 med praecis allowlistens noegler som booleans; beta er skjult", async (t) => {
  const f = await fixture(t);
  const res = await f.call(null);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["flags"]);
  assert.deepEqual(Object.keys(body.flags).sort(), [...PLAYER_VISIBLE_FLAG_KEYS].sort());
  assert.deepEqual(body.flags, {
    race_engine_v4: false,
    board_mandate_model_enabled: false,
    training_tick_per_race_day: false,
    training_score_visible: false,
    youth_squad_pages: false,
  });
  assert.equal(f.betaLookups(), 0, "en anonym forespoergsel maa ikke slaa en bruger op");
});

test("laeser KUN allowlistens noegler i app_config, aldrig resten af tabellen", async (t) => {
  const f = await fixture(t);
  const body = await (await f.call(null)).json();
  assert.deepEqual(f.supabase.reads.map((r) => r.table), PLAYER_VISIBLE_FLAG_KEYS.map(() => "app_config"));
  assert.deepEqual(f.supabase.reads.map((r) => r.key).sort(), [...PLAYER_VISIBLE_FLAG_KEYS].sort());
  for (const secret of ["market_value_weekly_cap", "email_loop_enabled", "stage_scheduler_enabled"]) {
    assert.equal(Object.hasOwn(body.flags, secret), false, `${secret} laekkede ud af endpointet`);
  }
});

test("race_engine_v4 on: true for alle, ogsaa anonyme (Hjaelp-sektionen raceDay vises)", async (t) => {
  const f = await fixture(t, { rows: { ...BASE_ROWS, race_engine_v4: "on" } });
  const body = await (await f.call(null)).json();
  assert.equal(body.flags.race_engine_v4, true);
});

test("gammelt boolean-skema honoreres: true er on, false er off", async (t) => {
  const f = await fixture(t, { rows: { ...BASE_ROWS, race_engine_v4: true, training_tick_per_race_day: false } });
  const body = await (await f.call(null)).json();
  assert.equal(body.flags.race_engine_v4, true);
  assert.equal(body.flags.training_tick_per_race_day, false);
});

test("manglende raekke, ukendt vaerdi og DB-fejl er alle off (fail-safe)", async (t) => {
  const rows = { board_mandate_model_enabled: "shadow" };
  const f = await fixture(t, { rows, failKeys: ["training_tick_per_race_day"] });
  const res = await f.call(null);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.flags, {
    race_engine_v4: false,
    board_mandate_model_enabled: false,
    training_tick_per_race_day: false,
    training_score_visible: false,
    youth_squad_pages: false,
  });
});

test("logget ind som beta-tester: beta-stadiet er synligt", async (t) => {
  const f = await fixture(t, { betaTester: true });
  const res = await f.call("valid");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.flags.board_mandate_model_enabled, true);
  assert.equal(body.flags.race_engine_v4, false, "off forbliver off, ogsaa for en beta-tester");
  assert.equal(f.betaLookups(), 1);
});

test("logget ind uden beta: beta-stadiet er skjult, on er synligt", async (t) => {
  const f = await fixture(t, { rows: { ...BASE_ROWS, race_engine_v4: "on" } });
  const body = await (await f.call("valid")).json();
  assert.equal(body.flags.board_mandate_model_enabled, false);
  assert.equal(body.flags.race_engine_v4, true);
});

test("ugyldigt token: requireAuth afviser med 401 foer noget laeses", async (t) => {
  const f = await fixture(t);
  const res = await f.call("stale");
  assert.equal(res.status, 401);
  assert.equal(f.supabase.reads.length, 0);
  assert.equal(f.betaLookups(), 0);
});

test("fejl i beta-opslaget: 500 uden flag-vaerdier, og fejlen rapporteres", async (t) => {
  const f = await fixture(t, { betaThrows: true });
  const res = await f.call("valid");
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(Object.hasOwn(body, "flags"), false);
  assert.equal(f.reported.length, 1);
  assert.match(String(f.reported[0]?.message), /users lookup failed/);
});

test("readPlayerFeatureFlags: samme evaluering uden HTTP-laget", async () => {
  const supabase = fakeSupabase({ race_engine_v4: "beta", training_tick_per_race_day: "on" });
  assert.deepEqual(await readPlayerFeatureFlags(supabase), {
    race_engine_v4: false,
    board_mandate_model_enabled: false,
    training_tick_per_race_day: true,
    training_score_visible: false,
    youth_squad_pages: false,
  });
  assert.deepEqual(await readPlayerFeatureFlags(supabase, { isBetaTester: true }), {
    race_engine_v4: true,
    board_mandate_model_enabled: false,
    training_tick_per_race_day: true,
    training_score_visible: false,
    youth_squad_pages: false,
  });
});

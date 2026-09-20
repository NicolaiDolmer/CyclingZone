import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createRankingsRouter } from "./rankings.ts";

// #5452: matviews genopfriskes via en PLAIN (eksklusiv) REFRESH (database/2026-07-27
// -3013-refresh-matviews-concurrently.sql). En læser der ankommer i det vindue
// afbrydes af Postgres' lock_timeout/statement_timeout (55P03/57014) - Sentry
// CYCLINGZONE-65 fangede dette på race-count, men de ikke-paginerede enkeltkald
// i rankings.ts (global?team_id, riders?top=5, race-count) stod ALLE uden retry.
// Disse tests dækker begge retninger: retry lykkes på forsøg 2 for lock-timeout-
// klassen, og der retries ALDRIG på andre fejl (fx 42501 permission denied).

const TEAM = "20000000-0000-4000-8000-000000000001";
const SEASON = "10000000-0000-4000-8000-000000000001";
const RIDER = "30000000-0000-4000-8000-000000000001";

type FixtureResponse = { status: number; body?: unknown; headers?: Record<string, string> };

// Bygger en minimal rankings-router hvis eneste kald svarer med en FAST SEKVENS
// af responses (én pr. faktisk underliggende fetch-kald til Supabase) - den
// sidste response gentages hvis flere kald sker end sekvensen har elementer.
// Lader os simulere "1. forsøg = lock timeout, 2. forsøg = ok" og omvendt.
async function fixtureWithResponses(t: test.TestContext, responses: FixtureResponse[]) {
  let callCount = 0;
  const supabase = createClient("https://database.example", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => {
      const r = responses[Math.min(callCount, responses.length - 1)];
      callCount++;
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
        status: r.status, headers: r.headers,
      });
    } },
  });
  const app = express();
  app.use("/api/rankings", createRankingsRouter({
    supabase,
    reportError: () => {},
    viewerClient: () => supabase,
    requireAuth: (_req, _res, next) => next(),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = (path: string) => fetch(`http://127.0.0.1:${address.port}/api/rankings${path}`, {
    headers: { Authorization: "Bearer valid" },
  });
  return { call, callCount: () => callCount };
}

const globalRow = { team_id: TEAM, name: "Team A", division: 1, is_ai: false, banked_points: 0,
  season_points: 0, global_points: 0, active_recent: true, is_rookie: false, global_rank: 3 };
const topRiderRow = { rider_id: RIDER, points: 80, stage_wins: 2, gc_wins: 1 };
const PERMISSION_DENIED = { message: 'permission denied for table "riders"', code: "42501" };

// ── global?team_id ───────────────────────────────────────────────────────────

test("global?team_id: retry lykkes på forsøg 2 efter lock-timeout (55P03)", async t => {
  const f = await fixtureWithResponses(t, [
    { status: 500, body: { message: "canceling statement due to lock timeout", code: "55P03" } },
    { status: 200, body: globalRow },
  ]);
  const response = await f.call(`/global?team_id=${TEAM}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: [globalRow] });
  assert.equal(f.callCount(), 2, "skal have retried EEN gang");
});

test("global?team_id: retries ALDRIG på permission denied (42501)", async t => {
  const f = await fixtureWithResponses(t, [{ status: 403, body: PERMISSION_DENIED }]);
  const response = await f.call(`/global?team_id=${TEAM}`);
  assert.equal(response.status, 500);
  assert.equal(f.callCount(), 1, "ingen retry på ikke-transiente fejl");
});

// ── riders?top=5 ──────────────────────────────────────────────────────────────

test("riders?top=5: retry lykkes på forsøg 2 efter statement-cancel (57014)", async t => {
  const f = await fixtureWithResponses(t, [
    { status: 500, body: { message: "canceling statement due to statement timeout", code: "57014" } },
    { status: 200, body: [topRiderRow] },
  ]);
  const response = await f.call(`/riders?season_id=${SEASON}&top=5`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: [topRiderRow] });
  assert.equal(f.callCount(), 2, "skal have retried EEN gang");
});

test("riders?top=5: retries ALDRIG på permission denied (42501)", async t => {
  const f = await fixtureWithResponses(t, [{ status: 403, body: PERMISSION_DENIED }]);
  const response = await f.call(`/riders?season_id=${SEASON}&top=5`);
  assert.equal(response.status, 500);
  assert.equal(f.callCount(), 1, "ingen retry på ikke-transiente fejl");
});

// ── race-count (HEAD, #5224's kodeløse tomme-fejl) ───────────────────────────

test("race-count: retry lykkes på forsøg 2 efter et tomt HEAD-500 (ingen code/message, #5224-klassen)", async t => {
  const f = await fixtureWithResponses(t, [
    { status: 500 }, // HEAD-svar: INGEN body ved fejl, per HTTP-spec (#5224).
    { status: 200, headers: { "content-type": "application/json", "content-range": "0-1/2" } },
  ]);
  const response = await f.call(`/race-count?team_id=${TEAM}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { count: 2 });
  assert.equal(f.callCount(), 2, "skal have retried EEN gang");
});

test("race-count: retries ALDRIG på et tomt HEAD-403 (kun status 500 er lock-timeout-signalet)", async t => {
  const f = await fixtureWithResponses(t, [{ status: 403 }]);
  const response = await f.call(`/race-count?team_id=${TEAM}`);
  assert.equal(response.status, 500);
  assert.equal(f.callCount(), 1, "403 er ikke lock-timeout-klassen, selv uden body");
});

test("race-count: retries ALDRIG når fejlen HAR en ægte kode (fx 42501 via en usædvanlig krop-bærende 5xx)", async t => {
  const f = await fixtureWithResponses(t, [{ status: 500, body: PERMISSION_DENIED }]);
  const response = await f.call(`/race-count?team_id=${TEAM}`);
  assert.equal(response.status, 500);
  assert.equal(f.callCount(), 1, "en ægte, ikke-transient kode overtrumfer status-500-heuristikken");
});

test("race-count: giver op efter PRÆCIS én retry hvis lock-timeout fortsætter (ikke uendelig)", async t => {
  const f = await fixtureWithResponses(t, [{ status: 500 }, { status: 500 }, { status: 500 }]);
  const response = await f.call(`/race-count?team_id=${TEAM}`);
  assert.equal(response.status, 500);
  assert.equal(f.callCount(), 2, "kun det oprindelige forsøg + ÉN retry - aldrig et 3.");
});

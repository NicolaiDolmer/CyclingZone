import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { createRankingsRouter } from "./rankings.ts";

// #5224: GET /api/rankings/race-count svarede 500 med en TOM Sentry-besked
// ({"message":""}) - årsagen kunne ikke læses ud af eventet. Roden: kaldet er
// et HEAD-request ({ count: "exact", head: true }), og et HEAD-svar har INGEN
// body per HTTP-spec, heller ikke ved fejl - PostgREST/postgrest-js kan derfor
// kun give os `{ message: "" }` uden code/details/hint. Disse tests dækker
// BEGGE halvdele af fixet: rankings.ts wrapper fejlen med rute+status-kontekst
// (denne fil), og backend/lib/sentry.test.js dækker den centrale
// besked-serialisering (code/details/hint) for alle ruter.

const TEAM = "20000000-0000-4000-8000-000000000001";

// Bygger en minimal rankings-router hvis eneste kald (HEAD race-count) svarer
// med en given status + en optional JSON-krop (simulerer et RIGTIGT HEAD-svar:
// ingen krop overhovedet ved fejl, medmindre `body` eksplicit sættes).
async function fixtureWithRaceCountError(t: test.TestContext, status: number, body: unknown = undefined) {
  const reported: unknown[] = [];
  const supabase = createClient("https://database.example", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(body === undefined ? null : JSON.stringify(body), { status }) },
  });
  const app = express();
  app.use("/api/rankings", createRankingsRouter({
    supabase,
    reportError: error => reported.push(error),
    viewerClient: () => supabase,
    requireAuth: (_req, _res, next) => next(),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/rankings/race-count?team_id=${TEAM}`, {
    headers: { Authorization: "Bearer valid" },
  });
  return { response, reported };
}

test("race-count: en TOM HEAD-fejl (ingen body, som i det ægte incident) rapporteres med rute+status-kontekst", async t => {
  const { response, reported } = await fixtureWithRaceCountError(t, 500);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Unable to load rankings" });
  assert.equal(reported.length, 1);
  const err = reported[0] as Error;
  assert.ok(err instanceof Error);
  // #5224's kernekrav: beskeden må IKKE længere være tom/ubrugelig - den skal
  // i det mindste bære rute-navnet og den faktiske HTTP-status.
  assert.notEqual(err.message, "");
  assert.match(err.message, /race-count/);
  assert.match(err.message, /500/);
});

test("race-count: en fejl MED code/details/hint (body findes, fx et 4xx) bevarer dem gennem wrapperen", async t => {
  // #5224 acceptkriterie: kast { code: "57014", message: "" } og forvent koden
  // i det rapporterede event. team_race_points_mv-kaldet er et HEAD, men
  // dækker også det almindelige tilfælde hvor PostgREST rent faktisk sender en
  // krop (fx et non-HEAD-endpoint, eller en proxy der ikke stripper HEAD-body).
  const { response, reported } = await fixtureWithRaceCountError(t, 500, { code: "57014", message: "" });
  assert.equal(response.status, 500);
  assert.equal(reported.length, 1);
  const err = reported[0] as Error & { code?: string };
  assert.equal(err.code, "57014", "code skal overleve toSupabaseError-wrapperen uændret");
  assert.match(err.message, /race-count/);
});

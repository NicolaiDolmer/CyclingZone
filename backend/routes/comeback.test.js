// #5643 · POST /api/season/comeback: auth, flag-gate, fejlkoder og svaret.
// Routeren køres som en rigtig express-app på en tilfældig port (samme mønster som
// api/featureFlagsApi.test.js); service og auth er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createComebackRouter, createRequireAuth } from "./comeback.js";
import { ComebackError } from "../lib/comebackService.js";

const passThrough = (_req, _res, next) => next();

async function fixture(t, {
  enabled = true,
  team = { id: "team-a", parked_at: "2026-09-27T20:00:00Z" },
  serviceResult,
  serviceError,
} = {}) {
  const calls = { service: [], flag: [], reported: [] };
  const app = express();
  app.use(express.json());
  app.use("/api/season/comeback", createComebackRouter({
    supabase: { from() { throw new Error("route må ikke læse DB direkte i testen"); } },
    requireAuth: (req, res, next) => {
      if (req.headers.authorization !== "Bearer valid") return res.status(401).json({ error: "Unauthorized" });
      req.user = { id: "user-a" };
      req.team = team;
      return next();
    },
    limiter: passThrough,
    isBetaTester: async () => false,
    isSignupEnabled: async (_supabase, opts) => { calls.flag.push(opts); return enabled; },
    returnParkedTeamFn: async (args) => {
      calls.service.push(args.teamId);
      if (serviceError) throw serviceError;
      return serviceResult ?? {
        returned: true,
        alreadyReturned: false,
        division: 3,
        leagueDivisionId: 12,
        poolLabel: "3B",
        seasonNumber: 4,
        sponsor: { paid: true, amount: 150000 },
      };
    },
    captureExceptionFn: (err) => calls.reported.push(err),
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const post = (headers = {}) => fetch(`http://127.0.0.1:${port}/api/season/comeback`, { method: "POST", headers });
  return { post, calls };
}

test("401 uden login, og servicen kaldes ikke", async (t) => {
  const { post, calls } = await fixture(t);
  const res = await post();
  assert.equal(res.status, 401);
  assert.equal(calls.service.length, 0);
});

test("flaget slået fra → 404", async (t) => {
  const { post, calls } = await fixture(t, { enabled: false });
  const res = await post({ Authorization: "Bearer valid" });
  assert.equal(res.status, 404);
  assert.equal(calls.service.length, 0);
});

test("ikke parkeret → 409 not_parked", async (t) => {
  const { post } = await fixture(t, { serviceError: new ComebackError("not_parked", 409) });
  const res = await post({ Authorization: "Bearer valid" });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "not_parked" });
});

test("intet hold → 400", async (t) => {
  const { post, calls } = await fixture(t, { team: null });
  const res = await post({ Authorization: "Bearer valid" });
  assert.equal(res.status, 400);
  assert.equal(calls.service.length, 0);
});

test("200: svaret har den nye division og sponsoren", async (t) => {
  const { post, calls } = await fixture(t);
  const res = await post({ Authorization: "Bearer valid" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.division, 3);
  assert.equal(body.league_division_id, 12);
  assert.equal(body.already_returned, false);
  assert.deepEqual(body.sponsor, { paid: true, amount: 150000 });
  assert.deepEqual(calls.service, ["team-a"]);
  assert.deepEqual(calls.flag, [{ isBetaTester: false }]);
});

test("uventet fejl → 500 og rapporteres", async (t) => {
  const { post, calls } = await fixture(t, { serviceError: new Error("db down") });
  const res = await post({ Authorization: "Bearer valid" });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "comeback_failed" });
  assert.equal(calls.reported.length, 1);
});

test("createRequireAuth: 401 uden Authorization-header", async (t) => {
  const app = express();
  app.post("/x", createRequireAuth({ supabase: { from() { throw new Error("ikke nået"); } } }), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/x`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("createComebackRouter kræver en Supabase-klient", () => {
  assert.throws(() => createComebackRouter({}), /Supabase client is required/);
});

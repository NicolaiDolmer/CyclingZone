// #5753 · GET /api/board/verdict/:seasonId — bestyrelsens dom i sæsonrecappen.
// Routeren køres som en rigtig express-app på en tilfældig port (samme mønster som
// comeback.test.js); auth, flag og Supabase er fakes.
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createBoardVerdictRouter, buildBoardVerdict, pickVerdictBeat } from "./boardVerdict.js";

const passThrough = (_req, _res, next) => next();
const SEASON_ID = "11111111-2222-4333-8444-555555555555";
const TEAM_ID = "team-a";
const MANDATE_ID = "mandate-1";

// Minimal PostgREST-lignende fake: hver tabel har rækker, filtre anvendes i JS.
function fakeSupabase(tables) {
  const reads = [];
  return {
    reads,
    from(table) {
      reads.push(table);
      let rows = [...(tables[table] ?? [])];
      let single = false;
      const api = {
        select() { return api; },
        eq(col, val) { rows = rows.filter((r) => r[col] === val); return api; },
        in(col, vals) { rows = rows.filter((r) => vals.includes(r[col])); return api; },
        order(col, { ascending = true } = {}) {
          rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1));
          return api;
        },
        limit(n) { rows = rows.slice(0, n); return api; },
        maybeSingle() { single = true; return api; },
        then(resolve, reject) {
          return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

function baseTables(overrides = {}) {
  return {
    seasons: [{ id: SEASON_ID, number: 3 }],
    board_mandates: [{
      id: MANDATE_ID, team_id: TEAM_ID, season_id: SEASON_ID, status: "completed",
      season_number: 3, goals: [{}, {}, {}, {}], signed_at: "2026-08-01T10:00:00Z",
    }],
    board_satisfaction_events: [
      { mandate_id: MANDATE_ID, created_at: "2026-08-02T10:00:00Z", satisfaction_before: 50, satisfaction_after: 52, goals_met: 1, goals_total: 4 },
      { mandate_id: MANDATE_ID, created_at: "2026-09-20T10:00:00Z", satisfaction_before: 60, satisfaction_after: 64, goals_met: 3, goals_total: 4 },
    ],
    team_board_members: [
      { team_id: TEAM_ID, archetype_key: "sponsoraten", is_chairman: false, assigned_at: "2026-08-01T00:00:00Z" },
      { team_id: TEAM_ID, archetype_key: "ungdomsidealisten", is_chairman: true, assigned_at: "2026-08-01T00:00:01Z" },
    ],
    teams: [{ id: TEAM_ID, team_dna_key: null }],
    ...overrides,
  };
}

async function fixture(t, {
  enabled = true,
  team = { id: TEAM_ID },
  tables = baseTables(),
  meeting = { available: true },
} = {}) {
  const calls = { flag: [], reported: [], meeting: 0 };
  const supabase = fakeSupabase(tables);
  const app = express();
  app.use("/api/board/verdict", createBoardVerdictRouter({
    supabase,
    requireAuth: (req, res, next) => {
      if (req.headers.authorization !== "Bearer valid") return res.status(401).json({ error: "Unauthorized" });
      req.user = { id: "user-a" };
      req.team = team;
      return next();
    },
    limiter: passThrough,
    isBetaTester: async () => true,
    isEnabled: async (_supabase, opts) => { calls.flag.push(opts); return enabled; },
    buildMeetingPayloadFn: async () => {
      calls.meeting += 1;
      if (meeting instanceof Error) throw meeting;
      return meeting;
    },
    captureExceptionFn: (err) => calls.reported.push(err),
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();
  const get = (seasonId = SEASON_ID, headers = { Authorization: "Bearer valid" }) =>
    fetch(`http://127.0.0.1:${port}/api/board/verdict/${seasonId}`, { headers });
  return { get, calls, supabase };
}

test("401 uden login", async (t) => {
  const { get } = await fixture(t);
  const res = await get(SEASON_ID, {});
  assert.equal(res.status, 401);
});

test("flag slået fra → { enabled: false } og ingen DB-læsning", async (t) => {
  const { get, calls, supabase } = await fixture(t, { enabled: false });
  const res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { enabled: false });
  assert.deepEqual(calls.flag, [{ isBetaTester: true }]);
  assert.deepEqual(supabase.reads, []);
});

test("ugyldigt sæson-id → 400 før flaget læses", async (t) => {
  const { get, calls } = await fixture(t);
  const res = await get("not-a-uuid");
  assert.equal(res.status, 400);
  assert.equal(calls.flag.length, 0);
});

test("AI-hold og manglende hold → { enabled: false }", async (t) => {
  const ai = await fixture(t, { team: { id: TEAM_ID, is_ai: true } });
  assert.deepEqual(await (await ai.get()).json(), { enabled: false });
  const none = await fixture(t, { team: null });
  assert.deepEqual(await (await none.get()).json(), { enabled: false });
});

test("ukendt sæson → 404", async (t) => {
  const { get } = await fixture(t, { tables: baseTables({ seasons: [] }) });
  const res = await get();
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "season_not_found" });
});

test("intet mandat i sæsonen → { enabled: false }", async (t) => {
  const { get } = await fixture(t, { tables: baseTables({ board_mandates: [] }) });
  assert.deepEqual(await (await get()).json(), { enabled: false });
});

test("et 'proposed' mandat tæller ikke som sæsonens dom", async (t) => {
  const tables = baseTables();
  tables.board_mandates[0].status = "proposed";
  const { get } = await fixture(t, { tables });
  assert.deepEqual(await (await get()).json(), { enabled: false });
});

test("data: mål fra seneste kvittering, tillid første før → seneste efter, formandens replik", async (t) => {
  const { get, calls } = await fixture(t);
  const res = await get();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, true);
  assert.equal(body.seasonNumber, 3);
  assert.equal(body.goalsMet, 3);
  assert.equal(body.goalsTotal, 4);
  assert.equal(body.confidenceBefore, 50);
  assert.equal(body.confidenceAfter, 64);
  assert.equal(body.mandateStatus, "completed");
  assert.equal(body.meetingAvailable, true);
  assert.equal(calls.meeting, 1);
  assert.equal(body.chairman.archetypeKey, "ungdomsidealisten");
  assert.ok(body.chairman.name, "formanden har et navn");
  assert.ok(body.chairman.initials);
  assert.match(body.chairman.quoteKey, /^archetypes\.ungdomsidealisten\.reactions\.receipt_positive\.\d+$/);
  assert.equal(typeof body.chairman.quoteFallbackDa, "string");
});

test("replikken er deterministisk pr. mandat (samme svar to gange)", async (t) => {
  const { get } = await fixture(t);
  const a = await (await get()).json();
  const b = await (await get()).json();
  assert.equal(a.chairman.quoteKey, b.chairman.quoteKey);
  assert.equal(a.chairman.name, b.chairman.name);
});

test("under halvdelen af målene → negativ kvittering", async (t) => {
  const tables = baseTables();
  tables.board_satisfaction_events[1].goals_met = 1;
  const { get } = await fixture(t, { tables });
  const body = await (await get()).json();
  assert.match(body.chairman.quoteKey, /reactions\.receipt_negative\./);
});

test("ingen kvitteringer endnu → null-felter, ingen replik, men formanden navngives", async (t) => {
  const { get } = await fixture(t, { tables: baseTables({ board_satisfaction_events: [] }) });
  const body = await (await get()).json();
  assert.equal(body.enabled, true);
  assert.equal(body.goalsMet, null);
  assert.equal(body.goalsTotal, 4, "falder tilbage til mandatets antal mål");
  assert.equal(body.confidenceBefore, null);
  assert.equal(body.confidenceAfter, null);
  assert.equal(body.chairman.quoteKey, null);
  assert.ok(body.chairman.name);
});

test("ingen bestyrelse → chairman null", async (t) => {
  const { get } = await fixture(t, { tables: baseTables({ team_board_members: [] }) });
  const body = await (await get()).json();
  assert.equal(body.chairman, null);
});

test("fejl i møde-opslaget → meetingAvailable false, rapporteres, dommen overlever", async (t) => {
  const { get, calls } = await fixture(t, { meeting: new Error("meeting down") });
  const res = await get();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.meetingAvailable, false);
  assert.equal(body.goalsMet, 3);
  assert.equal(calls.reported.length, 1);
});

test("DB-fejl → 500 board_verdict_failed og rapporteres", async (t) => {
  const broken = { from() { throw new Error("db down"); } };
  const calls = [];
  const app = express();
  app.use("/v", createBoardVerdictRouter({
    supabase: broken,
    requireAuth: (req, _res, next) => { req.team = { id: TEAM_ID }; next(); },
    limiter: passThrough,
    isBetaTester: async () => false,
    isEnabled: async () => true,
    buildMeetingPayloadFn: async () => ({ available: false }),
    captureExceptionFn: (err) => calls.push(err),
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/v/${SEASON_ID}`);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "board_verdict_failed" });
  assert.equal(calls.length, 1);
});

test("pickVerdictBeat: grænsen er halvdelen, og manglende data giver null", () => {
  assert.equal(pickVerdictBeat(2, 4), "receipt_positive");
  assert.equal(pickVerdictBeat(1, 4), "receipt_negative");
  assert.equal(pickVerdictBeat(null, 4), null);
  assert.equal(pickVerdictBeat(0, 0), null);
});

test("buildBoardVerdict kan kaldes direkte (uden Express)", async () => {
  const out = await buildBoardVerdict({
    supabase: fakeSupabase(baseTables()),
    teamId: TEAM_ID,
    seasonId: SEASON_ID,
    buildMeetingPayloadFn: async () => ({ available: false }),
  });
  assert.equal(out.enabled, true);
  assert.equal(out.meetingAvailable, false);
});

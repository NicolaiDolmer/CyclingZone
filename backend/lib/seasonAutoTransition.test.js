import test from "node:test";
import assert from "node:assert/strict";

import { processSeasonAutoTransitionCron } from "./seasonAutoTransition.js";

// Mock builder for transfer_windows query with .eq, .not, .order, .limit, .maybeSingle.
// Tracker .not()-kald så tests kan verificere at racing-window-guard er aktiv.
function makeWindowQuery(windowRow, capturedFilters = null) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    not(column, op, value) {
      if (capturedFilters) capturedFilters.push({ column, op, value });
      return builder;
    },
    order() { return builder; },
    limit() { return builder; },
    maybeSingle: () => Promise.resolve({ data: windowRow, error: null }),
  };
  return builder;
}

function makeSeasonQuery(seasonRow) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    maybeSingle: () => Promise.resolve({ data: seasonRow, error: null }),
  };
  return builder;
}

// Count-query stub (head:true, count:"exact") for admin_log min-interval-guard.
// Default 0 → ingen recent transition inden for guard-vinduet.
function makeCountQuery(count = 0) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    gte() { return builder; },
    then(resolve) { return resolve({ count, error: null }); },
  };
  return builder;
}

function makeSupabase({
  window: w,
  season: s,
  capturedFilters = null,
  recentTransitions = 0,
}) {
  return {
    from(table) {
      if (table === "transfer_windows") return makeWindowQuery(w, capturedFilters);
      if (table === "seasons") return makeSeasonQuery(s);
      if (table === "admin_log") return makeCountQuery(recentTransitions);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// Standard passing-readiness stub: cron-tests der vil nå transitionFn injicerer
// denne, så vi ikke afhænger af den rigtige assessTransitionReadiness (den queryer
// auctions/races og ville kræve ekstra stubbing — dækket af dens egen test-fil).
const readyStub = async () => ({ ready: true, failed_critical: [] });

test("processSeasonAutoTransitionCron: no wrapped window → no-op", async () => {
  const supabase = makeSupabase({ window: null, season: null });
  let transitionCalled = false;
  const result = await processSeasonAutoTransitionCron({
    supabase,
    transitionFn: async () => { transitionCalled = true; return { ok: true }; },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "no_wrapped_window");
  assert.equal(transitionCalled, false);
});

test("processSeasonAutoTransitionCron: window without season_id → no-op", async () => {
  const supabase = makeSupabase({
    window: { id: "w1", season_id: null, status: "closed", final_whistle_sent_at: "x", squad_enforcement_completed_at: "y" },
    season: null,
  });
  const result = await processSeasonAutoTransitionCron({
    supabase,
    transitionFn: async () => { throw new Error("should not be called"); },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "no_season_id");
});

test("processSeasonAutoTransitionCron: season already completed → no-op (idempotent)", async () => {
  const supabase = makeSupabase({
    window: { id: "w1", season_id: "s0", status: "closed", final_whistle_sent_at: "x", squad_enforcement_completed_at: "y" },
    season: { id: "s0", number: 0, status: "completed" },
  });
  const result = await processSeasonAutoTransitionCron({
    supabase,
    transitionFn: async () => { throw new Error("should not be called"); },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "season_status_completed");
});

test("processSeasonAutoTransitionCron: season not found → no-op", async () => {
  const supabase = makeSupabase({
    window: { id: "w1", season_id: "ghost", status: "closed", final_whistle_sent_at: "x", squad_enforcement_completed_at: "y" },
    season: null,
  });
  const result = await processSeasonAutoTransitionCron({
    supabase,
    transitionFn: async () => { throw new Error("should not be called"); },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "season_not_found");
});

test("processSeasonAutoTransitionCron: all flags set + season active → transitions", async () => {
  const supabase = makeSupabase({
    window: { id: "w1", season_id: "s0", status: "closed", final_whistle_sent_at: "2026-05-21T21:00Z", squad_enforcement_completed_at: "2026-05-21T21:05Z" },
    season: { id: "s0", number: 0, status: "active" },
  });
  const capturedArgs = [];
  const result = await processSeasonAutoTransitionCron({
    supabase,
    assessReadiness: readyStub,
    transitionFn: async (args) => {
      capturedArgs.push(args);
      return { ok: true, log: [{ phase: "insert_next_season", inserted: true }] };
    },
  });
  assert.equal(result.transitioned, true);
  assert.equal(result.fromSeason, 0);
  assert.equal(result.toSeason, 1);
  assert.equal(capturedArgs.length, 1);
  assert.equal(capturedArgs[0].fromSeasonId, "s0");
  assert.ok(capturedArgs[0].transitionAt instanceof Date);
});

test("processSeasonAutoTransitionCron: rejects missing supabase client", async () => {
  await assert.rejects(
    () => processSeasonAutoTransitionCron({ supabase: null }),
    /Supabase client required/
  );
});

// ─── #WS1 Task 2.1: readiness-gate i auto-transition-stien ────────────────────
// assessTransitionReadiness returnerer { ready, checks, failed_critical } (ikke
// { reason }) — gaten afleder en reason-streng fra failed_critical[0].

const ACTIVE_WRAPPED = {
  window: { id: "w1", season_id: "s0", status: "closed", final_whistle_sent_at: "2026-05-21T21:00Z", squad_enforcement_completed_at: "2026-05-21T21:05Z" },
  season: { id: "s0", number: 0, status: "active" },
};

test("processSeasonAutoTransitionCron: afbryder hvis readiness ikke er opfyldt", async () => {
  const supabase = makeSupabase(ACTIVE_WRAPPED);
  let transitioned = false;
  const r = await processSeasonAutoTransitionCron({
    supabase,
    now: new Date(),
    transitionFn: async () => { transitioned = true; return {}; },
    assessReadiness: async () => ({ ready: false, failed_critical: ["no_active_auctions"] }),
  });
  assert.equal(transitioned, false);
  assert.equal(r.transitioned, false);
  assert.equal(r.reason, "not_ready_no_active_auctions");
});

test("processSeasonAutoTransitionCron: transitionerer når readiness er opfyldt", async () => {
  const supabase = makeSupabase(ACTIVE_WRAPPED);
  let transitioned = false;
  const r = await processSeasonAutoTransitionCron({
    supabase,
    now: new Date(),
    transitionFn: async () => { transitioned = true; return { ok: true }; },
    assessReadiness: async () => ({ ready: true, failed_critical: [] }),
  });
  assert.equal(transitioned, true);
  assert.equal(r.transitioned, true);
});

test("processSeasonAutoTransitionCron: kalder assessReadiness med fromSeasonId fra vinduet", async () => {
  const supabase = makeSupabase(ACTIVE_WRAPPED);
  let readinessArg = null;
  await processSeasonAutoTransitionCron({
    supabase,
    now: new Date(),
    transitionFn: async () => ({ ok: true }),
    assessReadiness: async (arg) => { readinessArg = arg; return { ready: true, failed_critical: [] }; },
  });
  assert.equal(readinessArg.fromSeasonId, "s0");
  assert.equal(readinessArg.supabase, supabase);
});

// ─── #WS1 Task 2.2: min-interval-guard (prævention mod transition-loop) ────────
// admin_log-baseret hård prævention: maks én transition per N timer. Loop-guarden
// (dailySeasonCountCheck) alerter først EFTER den 2. transition — denne FORHINDRER.

test("processSeasonAutoTransitionCron: blokeres hvis en transition allerede er logget inden for min-interval", async () => {
  const supabase = makeSupabase({ ...ACTIVE_WRAPPED, recentTransitions: 1 });
  let transitioned = false;
  const r = await processSeasonAutoTransitionCron({
    supabase,
    now: new Date(),
    transitionFn: async () => { transitioned = true; return {}; },
    assessReadiness: readyStub,
  });
  assert.equal(transitioned, false);
  assert.equal(r.transitioned, false);
  assert.equal(r.reason, "recent_transition_guard");
});

test("processSeasonAutoTransitionCron: transitionerer når ingen recent transition i admin_log", async () => {
  const supabase = makeSupabase({ ...ACTIVE_WRAPPED, recentTransitions: 0 });
  let transitioned = false;
  const r = await processSeasonAutoTransitionCron({
    supabase,
    now: new Date(),
    transitionFn: async () => { transitioned = true; return { ok: true }; },
    assessReadiness: readyStub,
  });
  assert.equal(transitioned, true);
  assert.equal(r.transitioned, true);
});

// ─── Regression: sæson-loop-bug 2026-05-21 ────────────────────────────────────
// Racing-vinduer (oprettet via transitionToNextSeason med status='closed' men
// closed_at=null) må aldrig matche cron-filteret — ellers fyrer cron'en endnu
// en transition 5-10 min efter den forrige, hvilket skaber en endless loop.

test("processSeasonAutoTransitionCron: filter includes closed_at IS NOT NULL guard", async () => {
  const captured = [];
  const supabase = makeSupabase({
    window: null, season: null, capturedFilters: captured,
  });
  await processSeasonAutoTransitionCron({ supabase, transitionFn: async () => ({}) });
  const closedAtFilter = captured.find(f => f.column === "closed_at");
  assert.ok(closedAtFilter, "closed_at filter must be applied to exclude racing-windows");
  assert.equal(closedAtFilter.op, "is");
  assert.equal(closedAtFilter.value, null);
});

test("processSeasonAutoTransitionCron: ignores racing-window even if season is active (regression: dobbelt-transition 2026-05-21)", async () => {
  // Mock returnerer null fra query — det er hvad vi forventer når closed_at-filteret
  // er på plads og det øverste vindue er et racing-window (closed_at=null).
  // Test verificerer at cron'en ikke fyrer transition i denne situation.
  const supabase = makeSupabase({ window: null, season: null });
  let transitionCalled = false;
  const result = await processSeasonAutoTransitionCron({
    supabase,
    transitionFn: async () => { transitionCalled = true; return { ok: true }; },
  });
  assert.equal(result.transitioned, false);
  assert.equal(transitionCalled, false);
});

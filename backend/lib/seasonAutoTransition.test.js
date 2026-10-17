import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { processSeasonAutoTransitionCron } from "./seasonAutoTransition.js";

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

// #6784: cron'en må kun læse admin_log direkte; kildesæsonen kommer fra den
// injicerede resolver og readiness fra den injicerede gate. Alle andre tabeller
// (især transfer_windows) kaster, så en regression fanges med det samme.
function makeSupabase({ recentTransitions = 0, tables = null } = {}) {
  return {
    from(table) {
      if (tables) tables.push(table);
      if (table === "admin_log") return makeCountQuery(recentTransitions);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

const COMPLETED = { id: "s3", number: 3, status: "completed" };
// Fast ur (AGENTS.md: ingen væg-ur i tests); min-interval-guarden regnes ud fra det.
const NOW = new Date("2026-10-17T10:00:00Z");
const resolveTo = (season) => async () => season;

// Standard passing-readiness stub: dækket af seasonTransitionReadiness.test.js.
const readyStub = async () => ({ ready: true, failed_critical: [] });

test("processSeasonAutoTransitionCron: rejects missing supabase client", async () => {
  await assert.rejects(
    () => processSeasonAutoTransitionCron({ supabase: null }),
    /Supabase client required/
  );
});

test("processSeasonAutoTransitionCron: ingen kildesæson → no-op", async () => {
  let transitionCalled = false;
  const result = await processSeasonAutoTransitionCron({
    supabase: makeSupabase(),
    now: NOW,
    resolveSourceSeason: resolveTo(null),
    assessReadiness: readyStub,
    transitionFn: async () => { transitionCalled = true; return { ok: true }; },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "no_source_season");
  assert.equal(transitionCalled, false);
});

test("processSeasonAutoTransitionCron: aktiv sæson (season-end ikke kørt) skiftes aldrig automatisk", async () => {
  let readinessCalled = false;
  const result = await processSeasonAutoTransitionCron({
    supabase: makeSupabase(),
    now: NOW,
    resolveSourceSeason: resolveTo({ id: "s4", number: 4, status: "active" }),
    assessReadiness: async () => { readinessCalled = true; return { ready: true, failed_critical: [] }; },
    transitionFn: async () => { throw new Error("should not be called"); },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "season_status_active");
  assert.equal(readinessCalled, false);
});

test("processSeasonAutoTransitionCron: sæson 0 (aktiv, intet season-end-skridt) er manuel", async () => {
  const result = await processSeasonAutoTransitionCron({
    supabase: makeSupabase(),
    now: NOW,
    resolveSourceSeason: resolveTo({ id: "s0", number: 0, status: "active" }),
    assessReadiness: readyStub,
    transitionFn: async () => { throw new Error("should not be called"); },
  });
  assert.equal(result.transitioned, false);
  assert.equal(result.reason, "season_status_active");
});

test("processSeasonAutoTransitionCron: afsluttet sæson + grøn gate → transitionerer", async () => {
  const capturedArgs = [];
  const result = await processSeasonAutoTransitionCron({
    supabase: makeSupabase(),
    now: NOW,
    resolveSourceSeason: resolveTo(COMPLETED),
    assessReadiness: readyStub,
    transitionFn: async (args) => {
      capturedArgs.push(args);
      return { ok: true, log: [{ phase: "insert_next_season", inserted: true }] };
    },
  });
  assert.equal(result.transitioned, true);
  assert.equal(result.fromSeason, 3);
  assert.equal(result.toSeason, 4);
  assert.equal(capturedArgs.length, 1);
  assert.equal(capturedArgs[0].fromSeasonId, "s3");
  assert.equal(capturedArgs[0].transitionAt, NOW);
  assert.equal(capturedArgs[0].adminUserId, null);
});

// ─── #WS1 Task 2.1: readiness-gate i auto-transition-stien ────────────────────

test("processSeasonAutoTransitionCron: afbryder hvis readiness ikke er opfyldt", async () => {
  let transitioned = false;
  const r = await processSeasonAutoTransitionCron({
    supabase: makeSupabase(),
    now: NOW,
    resolveSourceSeason: resolveTo(COMPLETED),
    transitionFn: async () => { transitioned = true; return {}; },
    assessReadiness: async () => ({ ready: false, failed_critical: ["squad_enforcement_completed"] }),
  });
  assert.equal(transitioned, false);
  assert.equal(r.transitioned, false);
  assert.equal(r.reason, "not_ready_squad_enforcement_completed");
});

test("processSeasonAutoTransitionCron: kalder assessReadiness med kildesæsonens id", async () => {
  const supabase = makeSupabase();
  let readinessArg = null;
  await processSeasonAutoTransitionCron({
    supabase,
    now: NOW,
    resolveSourceSeason: resolveTo(COMPLETED),
    transitionFn: async () => ({ ok: true }),
    assessReadiness: async (arg) => { readinessArg = arg; return { ready: true, failed_critical: [] }; },
  });
  assert.equal(readinessArg.fromSeasonId, "s3");
  assert.equal(readinessArg.supabase, supabase);
});

// ─── #WS1 Task 2.2: min-interval-guard (prævention mod transition-loop) ────────

test("processSeasonAutoTransitionCron: blokeres hvis en transition allerede er logget inden for min-interval", async () => {
  let transitioned = false;
  const r = await processSeasonAutoTransitionCron({
    supabase: makeSupabase({ recentTransitions: 1 }),
    now: NOW,
    resolveSourceSeason: resolveTo(COMPLETED),
    transitionFn: async () => { transitioned = true; return {}; },
    assessReadiness: readyStub,
  });
  assert.equal(transitioned, false);
  assert.equal(r.transitioned, false);
  assert.equal(r.reason, "recent_transition_guard");
});

// ─── #6784: transfer_windows er død data (TRANSFER_MARKET_RULES.md) ─────────────

test("#6784 cron'en læser ikke transfer_windows", async () => {
  const tables = [];
  await processSeasonAutoTransitionCron({
    supabase: makeSupabase({ tables }),
    now: NOW,
    resolveSourceSeason: resolveTo(COMPLETED),
    assessReadiness: readyStub,
    transitionFn: async () => ({ ok: true }),
  });
  assert.deepEqual(tables, ["admin_log"]);
  const src = readFileSync(new URL("./seasonAutoTransition.js", import.meta.url), "utf8");
  assert.ok(!/from\(\s*["']transfer_windows["']/.test(src), "seasonAutoTransition.js må ikke query'e transfer_windows");
  assert.ok(!/squad_enforcement_completed_at|final_whistle_sent_at/.test(src), "ingen vindue-markører i cron'en");
});

test("#6784 auto-cron'en forbliver slukket", async () => {
  const { SEASON_AUTO_TRANSITION_ENABLED } = await import("./economyConstants.js");
  assert.equal(SEASON_AUTO_TRANSITION_ENABLED, false);
});

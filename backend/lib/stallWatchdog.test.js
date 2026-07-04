import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateStallFindings,
  processStallWatchdog,
  findingKey,
  STALL_WATCHDOG_DEFAULT_THRESHOLDS,
} from "./stallWatchdog.js";

const NOW = new Date("2026-07-03T15:00:00Z");
const hoursAgo = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

// ── (a) finalization-stall ────────────────────────────────────────────────────

test("(a) alle etaper kørt men ikke completed, sidste resultat >2t → finalize-finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    finalizeCandidates: [{ id: "r1", name: "Tour X" }],
    lastResultByRace: { r1: hoursAgo(3) },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "finalize");
  assert.equal(findings[0].raceId, "r1");
  assert.equal(findings[0].ageHours, 3);
});

test("(a) sidste resultat <2t → ingen finding (finalisering kan stadig nå det)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    finalizeCandidates: [{ id: "r1", name: "Tour X" }],
    lastResultByRace: { r1: hoursAgo(1) },
  });
  assert.equal(findings.length, 0);
});

test("(a) ingen race_results trods stages_completed>=stages → finding (anomali)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    finalizeCandidates: [{ id: "r1", name: "Tour X" }],
    lastResultByRace: { r1: null },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ageHours, null);
  assert.match(findings[0].detail, /ingen race_results/);
});

// ── (b) scheduler-progress-stall (global throughput-signal) ───────────────────

// Fælles: standings sat = results (lag 0) så check (d) ikke også fyrer.
const standingsFresh = (h) => ({ maxStandingsUpdated: hoursAgo(h), maxResultsImported: hoursAgo(h) });

test("(b) kø m. startfelt + INGEN resultater i >2t → scheduler-stall (global)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(5), has_results: false, has_entries: true },
    ],
    standings: standingsFresh(4), // sidste resultat 4t siden → scheduler producerer intet
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "stage");
  assert.equal(findings[0].queuedCount, 1);
  assert.match(findings[0].detail, /Vuelta Y/);
});

test("(b) kø m. startfelt MEN resultater friske (<2t) → INGEN finding (scheduler kører)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(103), has_results: false, has_entries: true },
    ],
    standings: standingsFresh(0.4), // sidste resultat 24 min siden → normal kø-catch-up
  });
  assert.equal(findings.length, 0);
});

test("(b) kun tomme spøgelsesløb (has_entries=false) + gamle resultater → INGEN finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "ghost", race_name: "Empty", stage_number: 1, scheduled_at: hoursAgo(100), has_results: false, has_entries: false },
    ],
    standings: standingsFresh(9),
  });
  assert.equal(findings.length, 0);
});

test("(b) al kø HAR resultater + gamle results → INGEN finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(5), has_results: true, has_entries: true },
    ],
    standings: standingsFresh(9),
  });
  assert.equal(findings.length, 0);
});

test("(b) ingen forfalden kø → INGEN finding trods gamle resultater", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [],
    standings: standingsFresh(10),
  });
  assert.equal(findings.length, 0);
});

// ── (c) prize-payout-stall ────────────────────────────────────────────────────

test("(c) completed + prize NULL >1t + auto-prize TÆNDT → prize-finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    autoPrizeEnabled: true,
    prizeCandidates: [{ id: "r3", name: "Race Z" }],
    lastResultByRace: { r3: hoursAgo(2) },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "prize");
});

test("(c) auto-prize SLUKKET → ingen prize-finding (manuel betaling forventet)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    autoPrizeEnabled: false,
    prizeCandidates: [{ id: "r3", name: "Race Z" }],
    lastResultByRace: { r3: hoursAgo(9) },
  });
  assert.equal(findings.length, 0);
});

test("(c) completed <1t siden sidste resultat → ingen finding (sweep'en får tid)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    autoPrizeEnabled: true,
    prizeCandidates: [{ id: "r3", name: "Race Z" }],
    lastResultByRace: { r3: hoursAgo(0.5) },
  });
  assert.equal(findings.length, 0);
});

// ── (d) standings-lag ─────────────────────────────────────────────────────────

test("(d) standings >1t bag results → standings-finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    standings: { maxStandingsUpdated: hoursAgo(3), maxResultsImported: hoursAgo(1) },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "standings");
  assert.equal(findings[0].ageHours, 2);
});

test("(d) standings opdateret EFTER results (normal) → ingen finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    standings: { maxStandingsUpdated: hoursAgo(0.5), maxResultsImported: hoursAgo(1) },
  });
  assert.equal(findings.length, 0);
});

test("(d) standings aldrig opdateret men results gamle → finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    standings: { maxStandingsUpdated: null, maxResultsImported: hoursAgo(4) },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /aldrig opdateret/);
});

test("(d) ingen results overhovedet → ingen finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    standings: { maxStandingsUpdated: null, maxResultsImported: null },
  });
  assert.equal(findings.length, 0);
});

// ── (e) matview-refresh-stall (#2196 Del 2) ───────────────────────────────────

test("(e) heartbeat >30min bag friske results → matview-finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    // resultater 6 min gamle, sidste matview-refresh 60 min gammel → lag 54 min
    standings: { maxStandingsUpdated: hoursAgo(0.05), maxResultsImported: hoursAgo(0.1) },
    matviewHeartbeat: hoursAgo(1),
  });
  const mv = findings.filter((f) => f.type === "matview");
  assert.equal(mv.length, 1);
  assert.equal(mv[0].ageHours, 0.9);
  assert.match(mv[0].detail, /refresh_ranking_matviews/);
});

test("(e) heartbeat friskt (lag <30min) → ingen matview-finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    standings: { maxStandingsUpdated: hoursAgo(0.1), maxResultsImported: hoursAgo(0.1) },
    matviewHeartbeat: hoursAgo(0.2), // 12 min → lag ~6 min
  });
  assert.equal(findings.filter((f) => f.type === "matview").length, 0);
});

test("(e) heartbeat mangler (tabel ikke applied endnu) trods friske results → ingen finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    standings: { maxStandingsUpdated: hoursAgo(0.1), maxResultsImported: hoursAgo(0.1) },
    matviewHeartbeat: null, // deploy FØR migration → spring (e) over, ingen false alarm
  });
  assert.equal(findings.filter((f) => f.type === "matview").length, 0);
});

test("(e) ingen results overhovedet → ingen matview-finding trods gammelt heartbeat", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    standings: { maxStandingsUpdated: null, maxResultsImported: null },
    matviewHeartbeat: hoursAgo(10),
  });
  assert.equal(findings.filter((f) => f.type === "matview").length, 0);
});

test("clean baseline (alt tomt) → 0 findings", () => {
  assert.equal(evaluateStallFindings({ now: NOW }).length, 0);
});

// ── findingKey / dedup ────────────────────────────────────────────────────────

test("findingKey — finalize/prize race-scoped; stage/standings/matview sæson-globalt", () => {
  assert.equal(findingKey({ type: "finalize", raceId: "r1" }, NOW), "finalize:r1:2026-07-03");
  assert.equal(findingKey({ type: "prize", raceId: "r9" }, NOW), "prize:r9:2026-07-03");
  assert.equal(findingKey({ type: "standings" }, NOW), "standings:2026-07-03");
  assert.equal(findingKey({ type: "stage" }, NOW), "stage:2026-07-03");
  assert.equal(findingKey({ type: "matview" }, NOW), "matview:2026-07-03");
});

// ── processStallWatchdog orchestrator (injiceret fetchStateFn) ─────────────────

function fakeState(overrides = {}) {
  return {
    seasonId: "s1",
    finalizeCandidates: [],
    prizeCandidates: [],
    lastResultByRace: {},
    dueStages: [],
    standings: { maxStandingsUpdated: null, maxResultsImported: null },
    matviewHeartbeat: null,
    ...overrides,
  };
}

test("processStallWatchdog — no active season → skip, ingen alarm", async () => {
  const result = await processStallWatchdog({
    supabase: { from() {} },
    now: NOW,
    fetchStateFn: async () => ({ seasonId: null }),
    sendWebhookFn: async () => { throw new Error("må ikke kaldes"); },
    getOpsWebhookFn: async () => "https://x/ops",
    captureExceptionFn: () => { throw new Error("må ikke kaldes"); },
  });
  assert.equal(result.alerted, false);
  assert.equal(result.skipped, "no_active_season");
});

test("processStallWatchdog — findings → ét Discord-embed + Sentry pr. type", async () => {
  const webhookCalls = [];
  const sentryCalls = [];
  const result = await processStallWatchdog({
    supabase: { from() {} },
    now: NOW,
    autoPrizeEnabled: true,
    fetchStateFn: async () =>
      fakeState({
        finalizeCandidates: [{ id: "r1", name: "Tour X" }],
        prizeCandidates: [{ id: "r3", name: "Race Z" }],
        lastResultByRace: { r1: hoursAgo(3), r3: hoursAgo(4) },
      }),
    sendWebhookFn: async (url, payload) => webhookCalls.push({ url, payload }),
    getOpsWebhookFn: async () => "https://x/ops",
    captureExceptionFn: (err, ctx) => sentryCalls.push({ err, ctx }),
  });
  assert.equal(result.alerted, true);
  assert.equal(result.newFindings.length, 2);
  assert.equal(webhookCalls.length, 1);
  assert.equal(webhookCalls[0].url, "https://x/ops");
  assert.equal(webhookCalls[0].payload.embeds[0].fields.length, 2);
  // finalize + prize = 2 distinkte typer → 2 Sentry-captures
  assert.equal(sentryCalls.length, 2);
  assert.deepEqual(sentryCalls[0].ctx.tags, { cron: "stall-watchdog", check: "finalize" });
});

test("processStallWatchdog — dedup: samme stall alarmerer ikke to gange samme dag", async () => {
  const webhookCalls = [];
  const seenKeys = new Set();
  const state = fakeState({
    finalizeCandidates: [{ id: "r1", name: "Tour X" }],
    lastResultByRace: { r1: hoursAgo(5) },
  });
  const opts = {
    supabase: { from() {} },
    now: NOW,
    seenKeys,
    fetchStateFn: async () => state,
    sendWebhookFn: async (url, payload) => webhookCalls.push({ url, payload }),
    getOpsWebhookFn: async () => "https://x/ops",
    captureExceptionFn: () => {},
  };
  const first = await processStallWatchdog(opts);
  const second = await processStallWatchdog(opts);
  assert.equal(first.alerted, true);
  assert.equal(second.alerted, false);
  assert.equal(webhookCalls.length, 1); // kun første tick alarmerede
});

test("processStallWatchdog — bruger default-thresholds når ikke override", () => {
  assert.equal(STALL_WATCHDOG_DEFAULT_THRESHOLDS.finalizeHours, 2);
  assert.equal(STALL_WATCHDOG_DEFAULT_THRESHOLDS.prizeHours, 1);
});

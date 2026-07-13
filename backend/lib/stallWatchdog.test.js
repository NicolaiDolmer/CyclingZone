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

// ── (b) etape-stall (PRÆCIS, pr. løb) + (b2) etape-gennemløb (info) — #2251 ────

// Fælles: standings sat = results (lag 0) så check (d) ikke også fyrer.
const standingsFresh = (h) => ({ maxStandingsUpdated: hoursAgo(h), maxResultsImported: hoursAgo(h) });

test("(b) forfalden etape m. startfelt uden resultater → PRÆCIS stage-finding pr. løb (uanset globalt resultsAge)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 3, scheduled_at: hoursAgo(5), has_results: false, has_entries: true },
    ],
    standings: standingsFresh(0.1), // globalt FRISK — men denne etape er stadig hængt
  });
  const stageFindings = findings.filter((f) => f.type === "stage");
  assert.equal(stageFindings.length, 1, "#2251: fyrer uafhængigt af det globale resultsAge-signal");
  assert.equal(stageFindings[0].raceId, "r2");
  assert.equal(stageFindings[0].raceName, "Vuelta Y");
  assert.equal(stageFindings[0].stageNumber, 3);
  assert.match(stageFindings[0].detail, /Etape 3/);
});

test("(b) kun tomme spøgelsesløb (has_entries=false) → INGEN stage-finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "ghost", race_name: "Empty", stage_number: 1, scheduled_at: hoursAgo(100), has_results: false, has_entries: false },
    ],
    standings: standingsFresh(9),
  });
  assert.equal(findings.filter((f) => f.type === "stage").length, 0);
});

test("(b) etape MED resultater → INGEN stage-finding for den etape", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(5), has_results: true, has_entries: true },
    ],
    standings: standingsFresh(9),
  });
  assert.equal(findings.filter((f) => f.type === "stage").length, 0);
});

test("(b) ingen forfalden kø → INGEN stage-finding", () => {
  const findings = evaluateStallFindings({ now: NOW, dueStages: [], standings: standingsFresh(10) });
  assert.equal(findings.filter((f) => f.type === "stage").length, 0);
});

test("(b) to forskellige løb i køen → to separate stage-findings (ikke aggregeret)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(5), has_results: false, has_entries: true },
      { race_id: "r5", race_name: "Giro Z", stage_number: 2, scheduled_at: hoursAgo(6), has_results: false, has_entries: true },
    ],
    standings: standingsFresh(9),
  });
  const stageFindings = findings.filter((f) => f.type === "stage");
  assert.equal(stageFindings.length, 2);
  assert.deepEqual(stageFindings.map((f) => f.raceId).sort(), ["r2", "r5"]);
});

// #2251: ALARMEN (b) kræver stageAlarmHours (4t), ikke stageHours (2t). En løbsdags-
// klynge (empirisk 22 etaper 18:00 dansk) drænes sundt over 1-2t og krydser kortvarigt
// 2t — det gav før eskalerende Discord/Sentry-støj (CYCLINGZONE-2G) uden ét ægte hang.
test("(b) forfalden 2-4t (normal klynge-dræning) → INGEN stage-ALARM (#2251)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(3), has_results: false, has_entries: true },
    ],
    standings: standingsFresh(0.1), // scheduleren producerer stadig → sund dræning
  });
  assert.equal(findings.filter((f) => f.type === "stage").length, 0, "3t < stageAlarmHours(4) → ingen alarm");
});

test("(b) forfalden lige over 4t → stage-ALARM fyrer (ægte enkelt-løbs-hang, #2251)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(4.5), has_results: false, has_entries: true },
    ],
    standings: standingsFresh(0.1),
  });
  assert.equal(findings.filter((f) => f.type === "stage").length, 1, "4.5t > stageAlarmHours(4) → alarm");
});

test("(b2) globalt gennemløbs-signal: kø + ingen resultater NOGET sted i >2t → INFO-finding (ikke error)", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(5), has_results: false, has_entries: true },
    ],
    standings: standingsFresh(4), // sidste resultat 4t siden → scheduler producerer intet
  });
  const throughput = findings.filter((f) => f.type === "stage_throughput");
  assert.equal(throughput.length, 1);
  assert.equal(throughput[0].level, "info", "#2251: globalt throughput-signal er INFO, ikke error");
  assert.equal(throughput[0].queuedCount, 1);
  assert.match(throughput[0].detail, /Vuelta Y/);
});

test("(b2) globalt gennemløbs-signal springes over når resultater er friske (<2t) — normal kø-catch-up", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(103), has_results: false, has_entries: true },
    ],
    standings: standingsFresh(0.4), // sidste resultat 24 min siden → normal kø-catch-up
  });
  assert.equal(findings.filter((f) => f.type === "stage_throughput").length, 0);
  // Den PRÆCISE stage-finding fyrer stadig for den enkelte hængende etape.
  assert.equal(findings.filter((f) => f.type === "stage").length, 1);
});

test("(b2) kun tomme spøgelsesløb → INGEN gennemløbs-finding", () => {
  const findings = evaluateStallFindings({
    now: NOW,
    dueStages: [
      { race_id: "ghost", race_name: "Empty", stage_number: 1, scheduled_at: hoursAgo(100), has_results: false, has_entries: false },
    ],
    standings: standingsFresh(9),
  });
  assert.equal(findings.filter((f) => f.type === "stage_throughput").length, 0);
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

test("findingKey — finalize/prize/stage (#2251: nu pr.-løb) race-scoped; standings/stage_throughput/matview sæson-globalt", () => {
  assert.equal(findingKey({ type: "finalize", raceId: "r1" }, NOW), "finalize:r1:2026-07-03");
  assert.equal(findingKey({ type: "prize", raceId: "r9" }, NOW), "prize:r9:2026-07-03");
  assert.equal(findingKey({ type: "stage", raceId: "r2" }, NOW), "stage:r2:2026-07-03");
  assert.equal(findingKey({ type: "standings" }, NOW), "standings:2026-07-03");
  assert.equal(findingKey({ type: "stage_throughput" }, NOW), "stage_throughput:2026-07-03");
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

// ── #2251: info-niveau (stage_throughput) logges men alarmerer ALDRIG Discord/Sentry ──

test("processStallWatchdog — info-finding (stage_throughput) logges, men fylder IKKE Discord/Sentry; præcis stage-finding gør", async () => {
  const webhookCalls = [];
  const sentryCalls = [];
  const result = await processStallWatchdog({
    supabase: { from() {} },
    now: NOW,
    fetchStateFn: async () =>
      fakeState({
        dueStages: [
          { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(5), has_results: false, has_entries: true },
        ],
        standings: standingsFresh(4), // trigger'er BÅDE (b) præcis + (b2) info
      }),
    sendWebhookFn: async (url, payload) => webhookCalls.push({ url, payload }),
    getOpsWebhookFn: async () => "https://x/ops",
    captureExceptionFn: (err, ctx) => sentryCalls.push({ err, ctx }),
  });
  assert.equal(result.alerted, true);
  assert.equal(result.newFindings.length, 1, "kun den PRÆCISE stage-finding tæller som alert");
  assert.equal(result.newFindings[0].type, "stage");
  assert.equal(result.infoFindings.length, 1);
  assert.equal(result.infoFindings[0].type, "stage_throughput");
  assert.equal(webhookCalls.length, 1);
  assert.equal(webhookCalls[0].payload.embeds[0].fields.length, 1, "kun alert-findings i Discord-embed — info udelades");
  assert.equal(sentryCalls.length, 1);
  assert.deepEqual(sentryCalls[0].ctx.tags, { cron: "stall-watchdog", check: "stage" });
});

test("processStallWatchdog — dedup gælder OGSÅ info-findings (samme dag alarmerer/logger ikke to gange)", async () => {
  const seenKeys = new Set();
  const state = fakeState({
    dueStages: [
      { race_id: "r2", race_name: "Vuelta Y", stage_number: 1, scheduled_at: hoursAgo(5), has_results: false, has_entries: true },
    ],
    standings: standingsFresh(4),
  });
  const opts = {
    supabase: { from() {} },
    now: NOW,
    seenKeys,
    fetchStateFn: async () => state,
    sendWebhookFn: async () => {},
    getOpsWebhookFn: async () => "https://x/ops",
    captureExceptionFn: () => {},
  };
  const first = await processStallWatchdog(opts);
  const second = await processStallWatchdog(opts);
  assert.equal(first.infoFindings.length, 1);
  assert.equal(second.infoFindings.length, 0, "info-finding dedup'es ligesom alert-findings");
  assert.equal(second.newFindings.length, 0);
  assert.equal(second.alerted, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HALF_FINALIZED_ALERT_AFTER_MS,
  PRIZE_UNPAID_ALERT_AFTER_MS,
  RACE_FINALIZE_ALERT_KEY,
  formatFindings,
  runHalfFinalizedRaceWatch,
  selectCompletedWithoutPrize,
  selectResultsWithoutStatus,
  selectStuckMarkers,
} from "./raceFinalizeWatch.js";

const NOW = new Date("2026-09-04T18:00:00.000Z");
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString();

// ── Fund 1: fastlåst markering ────────────────────────────────────────────────

test("stuck_marker: en frisk markering (under 10 min) er IKKE et fund", () => {
  const races = [{ id: "r1", name: "GP", finalize_state: { stage_index: 1, stage_number: 2, done: ["write"] }, finalize_updated_at: minutesAgo(4) }];
  assert.deepEqual(selectStuckMarkers(races, [], { now: NOW }), []);
});

test("stuck_marker: over 10 min uden levende claim er et fund", () => {
  const races = [{ id: "r1", name: "GP", finalize_state: { stage_index: 1, stage_number: 2, done: ["write", "standings"] }, finalize_updated_at: minutesAgo(22) }];
  const found = selectStuckMarkers(races, [], { now: NOW });
  assert.equal(found.length, 1);
  assert.equal(found[0].type, "stuck_marker");
  assert.equal(found[0].stalled_minutes, 22);
  assert.deepEqual(found[0].done, ["write", "standings"]);
});

test("stuck_marker: et LEVENDE stage-claim undertrykker fundet (genoptagelsen er på vej)", () => {
  const races = [{ id: "r1", name: "GP", finalize_state: { stage_index: 1, stage_number: 2, done: ["write"] }, finalize_updated_at: minutesAgo(12) }];
  const claims = [{ race_id: "r1", stage_index: 1, claimed_at: minutesAgo(3) }];
  assert.deepEqual(selectStuckMarkers(races, claims, { now: NOW }), []);
});

test("stuck_marker: et UDLØBET claim undertrykker IKKE — ingen kører længere", () => {
  const races = [{ id: "r1", name: "GP", finalize_state: { stage_index: 1, stage_number: 2, done: ["write"] }, finalize_updated_at: minutesAgo(30) }];
  const claims = [{ race_id: "r1", stage_index: 1, claimed_at: minutesAgo(40) }];
  assert.equal(selectStuckMarkers(races, claims, { now: NOW }).length, 1);
});

test("stuck_marker: et claim på en ANDEN etape undertrykker ikke", () => {
  const races = [{ id: "r1", name: "GP", finalize_state: { stage_index: 1, stage_number: 2, done: ["write"] }, finalize_updated_at: minutesAgo(30) }];
  const claims = [{ race_id: "r1", stage_index: 4, claimed_at: minutesAgo(1) }];
  assert.equal(selectStuckMarkers(races, claims, { now: NOW }).length, 1);
});

// ── Fund 2: resultater uden status-flip (Llanera-tilstanden 23/8) ─────────────

test("results_without_status: et løb midt i afviklingen er ikke et fund", () => {
  const races = [{ id: "r1", name: "GP", status: "scheduled", stages: 5, stages_completed: 2 }];
  assert.deepEqual(selectResultsWithoutStatus(races, new Map(), { now: NOW }), []);
});

test("results_without_status: alle etaper kørt + status stadig 'scheduled' = fund", () => {
  const races = [{ id: "r1", name: "Llanera", status: "scheduled", stages: 1, stages_completed: 1 }];
  const last = new Map([["r1", minutesAgo(35)]]);
  const found = selectResultsWithoutStatus(races, last, { now: NOW });
  assert.equal(found.length, 1);
  assert.equal(found[0].type, "results_without_status");
  assert.equal(found[0].status, "scheduled");
});

test("results_without_status: inden for vinduet tier vi — recovery-stien har 5-min-ticks", () => {
  const races = [{ id: "r1", name: "Llanera", status: "scheduled", stages: 1, stages_completed: 1 }];
  const last = new Map([["r1", minutesAgo(3)]]);
  assert.deepEqual(selectResultsWithoutStatus(races, last, { now: NOW }), []);
});

test("results_without_status: ukendt sluttidspunkt skjuler IKKE fundet", () => {
  const races = [{ id: "r1", name: "Ukendt", status: "scheduled", stages: 2, stages_completed: 2 }];
  assert.equal(selectResultsWithoutStatus(races, new Map(), { now: NOW }).length, 1);
});

// ── Fund 3: completed uden præmieudbetaling ──────────────────────────────────

test("completed_without_prize: uden præmie-berettigede rækker er der intet at udbetale", () => {
  const races = [{ id: "r1", name: "GP", status: "completed", prize_paid_at: null }];
  const last = new Map([["r1", minutesAgo(300)]]);
  assert.deepEqual(selectCompletedWithoutPrize(races, last, new Map([["r1", 0]]), { now: NOW }), []);
});

test("completed_without_prize: udbetalte løb er ikke fund", () => {
  const races = [{ id: "r1", name: "GP", status: "completed", prize_paid_at: minutesAgo(10) }];
  assert.deepEqual(selectCompletedWithoutPrize(races, new Map(), new Map([["r1", 21]]), { now: NOW }), []);
});

test("completed_without_prize: 21 præmierækker og NULL efter en time = fund", () => {
  const races = [{ id: "r1", name: "Llanera", status: "completed", prize_paid_at: null }];
  const last = new Map([["r1", minutesAgo(120)]]);
  const found = selectCompletedWithoutPrize(races, last, new Map([["r1", 21]]), { now: NOW });
  assert.equal(found.length, 1);
  assert.equal(found[0].payable_rows, 21);
});

test("tærsklerne er dem issuet beder om: 10 min for halve tilstande, 60 min for præmier", () => {
  assert.equal(HALF_FINALIZED_ALERT_AFTER_MS, 10 * 60 * 1000);
  assert.equal(PRIZE_UNPAID_ALERT_AFTER_MS, 60 * 60 * 1000);
});

test("formatFindings: én linje pr. fund, med løbs-id og årsag", () => {
  const lines = formatFindings([
    { type: "stuck_marker", race_id: "r1", race_name: "GP", stage_number: 2, done: ["write"], stalled_minutes: 22 },
    { type: "results_without_status", race_id: "r2", race_name: "Llanera", status: "scheduled", stages: 1 },
    { type: "completed_without_prize", race_id: "r3", race_name: "Piemonte", payable_rows: 21 },
  ]);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /r1.*etape 2.*22 min/);
  assert.match(lines[1], /r2.*status er stadig 'scheduled'/);
  assert.match(lines[2], /r3.*prize_paid_at er NULL/);
});

// ── I/O-runneren ─────────────────────────────────────────────────────────────

function makeWatchSupabase({ markerRaces = [], claims = [], seasonRaces = [], schedule = [], prizeCount = 0, stateRow = null } = {}) {
  const upserts = [];
  function from(table) {
    const b = {
      __eqs: [],
      select(_c, opts) { b.__head = opts?.head === true; return b; },
      eq(c, v) { b.__eqs.push([c, v]); return b; },
      in() { return b; }, not() { return b; }, gt() { return b; }, is() { return b; },
      order() { return b; }, limit() { return b; },
      maybeSingle() {
        if (table === "ops_alert_state") return Promise.resolve({ data: stateRow, error: null });
        if (table === "seasons") return Promise.resolve({ data: { id: "s3", number: 3 }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      upsert(row) { upserts.push(row); return Promise.resolve({ error: null }); },
      then(resolve, reject) {
        let data = [];
        if (table === "races") data = b.__eqs.some(([c]) => c === "season_id") ? seasonRaces : markerRaces;
        else if (table === "race_stage_claims") data = claims;
        else if (table === "race_stage_schedule") data = schedule;
        else if (table === "seasons") data = [{ id: "s3", number: 3, status: "active" }];
        const payload = table === "race_results" && b.__head ? { data: null, count: prizeCount, error: null } : { data, error: null };
        return Promise.resolve(payload).then(resolve, reject);
      },
    };
    return b;
  }
  return { from, __upserts: upserts };
}

test("runHalfFinalizedRaceWatch: ingen fund og ingen historik → alarmerer ikke og skriver ingenting", async () => {
  const supabase = makeWatchSupabase({ seasonRaces: [{ id: "r1", name: "GP", status: "scheduled", stages: 5, stages_completed: 2, prize_paid_at: null }] });
  const captured = [];
  const res = await runHalfFinalizedRaceWatch({ supabase, now: NOW, captureExceptionFn: (e) => captured.push(e), isAutoPrizeEnabled: async () => true });
  assert.equal(res.findings, 0);
  assert.equal(res.alerted, false);
  assert.equal(captured.length, 0);
  assert.equal(supabase.__upserts.length, 0, "et roligt tick må ikke skrive noget");
});

test("runHalfFinalizedRaceWatch: et løb der har RETTET sig nulstiller signaturen (så et nyt fund alarmerer straks)", async () => {
  const supabase = makeWatchSupabase({
    seasonRaces: [{ id: "r1", name: "GP", status: "completed", stages: 1, stages_completed: 1, prize_paid_at: minutesAgo(2) }],
    stateRow: { signature: "results_without_status:r1", last_alerted_at: minutesAgo(30) },
  });
  const res = await runHalfFinalizedRaceWatch({ supabase, now: NOW, captureExceptionFn: () => {}, isAutoPrizeEnabled: async () => true });
  assert.equal(res.findings, 0);
  assert.equal(supabase.__upserts.at(-1)?.signature, "", "signaturen skal ryddes når tilstanden er væk");
});

test("runHalfFinalizedRaceWatch: fastlåst markering → ÉN Sentry-capture med fast fingerprint", async () => {
  const supabase = makeWatchSupabase({
    markerRaces: [{ id: "r1", name: "GP", finalize_state: { stage_index: 1, stage_number: 2, done: ["write"] }, finalize_updated_at: minutesAgo(30) }],
    seasonRaces: [],
  });
  const captured = [];
  const res = await runHalfFinalizedRaceWatch({
    supabase, now: NOW,
    captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
    isAutoPrizeEnabled: async () => true,
    logger: { warn() {}, error() {} },
  });
  assert.equal(res.findings, 1);
  assert.equal(res.alerted, true);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].ctx.fingerprint, [RACE_FINALIZE_ALERT_KEY]);
  assert.match(captured[0].err.message, /Halvt afsluttede loeb: 1 fund/);
});

test("runHalfFinalizedRaceWatch: UÆNDRET fund alarmerer ikke igen (dedupe)", async () => {
  const marker = { id: "r1", name: "GP", finalize_state: { stage_index: 1, stage_number: 2, done: ["write"] }, finalize_updated_at: minutesAgo(30) };
  const supabase = makeWatchSupabase({
    markerRaces: [marker],
    seasonRaces: [],
    stateRow: { signature: "stuck_marker:r1", last_alerted_at: minutesAgo(60) },
  });
  const captured = [];
  const res = await runHalfFinalizedRaceWatch({
    supabase, now: NOW, captureExceptionFn: (e) => captured.push(e),
    isAutoPrizeEnabled: async () => true, logger: { warn() {}, error() {} },
  });
  assert.equal(res.findings, 1);
  assert.equal(res.alerted, false, "samme tilstand må ikke alarmere hvert 15. minut");
  assert.equal(captured.length, 0);
});

test("runHalfFinalizedRaceWatch: præmie-fundet er tavst når auto-prize er slukket", async () => {
  const seasonRaces = [{ id: "r1", name: "GP", status: "completed", stages: 1, stages_completed: 1, prize_paid_at: null }];
  const schedule = [{ race_id: "r1", scheduled_at: minutesAgo(300) }];
  const off = makeWatchSupabase({ seasonRaces, schedule, prizeCount: 21 });
  const resOff = await runHalfFinalizedRaceWatch({ supabase: off, now: NOW, captureExceptionFn: () => {}, isAutoPrizeEnabled: async () => false, logger: { warn() {}, error() {} } });
  assert.equal(resOff.findings, 0, "manuel udbetaling er tilsigtet når flaget er slukket");

  const on = makeWatchSupabase({ seasonRaces, schedule, prizeCount: 21 });
  const resOn = await runHalfFinalizedRaceWatch({ supabase: on, now: NOW, captureExceptionFn: () => {}, isAutoPrizeEnabled: async () => true, logger: { warn() {}, error() {} } });
  assert.equal(resOn.byType.completed_without_prize, 1);
});

test("runHalfFinalizedRaceWatch: vagten skriver ALDRIG til races (read-only)", async () => {
  const touched = [];
  const base = makeWatchSupabase({
    markerRaces: [{ id: "r1", name: "GP", finalize_state: { stage_index: 0, stage_number: 1, done: ["write"] }, finalize_updated_at: minutesAgo(30) }],
    seasonRaces: [{ id: "r2", name: "X", status: "scheduled", stages: 1, stages_completed: 1, prize_paid_at: null }],
  });
  const supabase = {
    from(table) {
      const b = base.from(table);
      b.update = () => { touched.push(table); return b; };
      b.insert = () => { touched.push(table); return b; };
      const origUpsert = b.upsert;
      b.upsert = (row) => { touched.push(`upsert:${table}`); return origUpsert(row); };
      return b;
    },
  };
  await runHalfFinalizedRaceWatch({ supabase, now: NOW, captureExceptionFn: () => {}, isAutoPrizeEnabled: async () => false, logger: { warn() {}, error() {} } });
  assert.deepEqual(touched, ["upsert:ops_alert_state"], "eneste skrivning må være dedupe-rækken");
});

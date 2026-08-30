// #2892 — unit-tests for den REN beregning i cronHeartbeat.js (kadence + margin
// fra ALL_CRON_MONITORS, overdue-detektion). I/O-funktionerne (recordCronCheckIn,
// primeCronHeartbeatCheckIns, runCronHeartbeatSweepCron) testes via en minimal
// in-memory supabase-stub — ingen ægte DB-forbindelse.

import test from "node:test";
import assert from "node:assert/strict";

import {
  cadenceSecondsFromConfig,
  marginSecondsFromConfig,
  isOverdue,
  computeOverdueSlugs,
  recordCronCheckIn,
  primeCronHeartbeatCheckIns,
  runCronHeartbeatSweepCron,
  CRON_CHECKINS_TABLE,
} from "./cronHeartbeat.js";

const CRON_MONITOR_5MIN = {
  schedule: { type: "interval", value: 5, unit: "minute" },
  checkinMargin: 10,
};
const CRON_MONITOR_24H = {
  schedule: { type: "interval", value: 1, unit: "day" },
  checkinMargin: 180,
};

// ── cadenceSecondsFromConfig / marginSecondsFromConfig ──────────────────────

test("cadenceSecondsFromConfig — minutter konverteres korrekt", () => {
  assert.equal(cadenceSecondsFromConfig({ schedule: { type: "interval", value: 5, unit: "minute" } }), 300);
});

test("cadenceSecondsFromConfig — dage konverteres korrekt", () => {
  assert.equal(cadenceSecondsFromConfig({ schedule: { type: "interval", value: 1, unit: "day" } }), 86400);
});

test("cadenceSecondsFromConfig — ukendt unit kaster (fanger fremtidige schedule-typer i registret)", () => {
  assert.throws(() => cadenceSecondsFromConfig({ schedule: { type: "interval", value: 1, unit: "fortnight" } }));
});

test("marginSecondsFromConfig — checkinMargin (minutter) konverteres til sekunder", () => {
  assert.equal(marginSecondsFromConfig(CRON_MONITOR_5MIN), 600);
  assert.equal(marginSecondsFromConfig(CRON_MONITOR_24H), 10800);
});

test("marginSecondsFromConfig — manglende checkinMargin defaulter til 0", () => {
  assert.equal(marginSecondsFromConfig({ schedule: { type: "interval", value: 5, unit: "minute" } }), 0);
});

// ── isOverdue ─────────────────────────────────────────────────────────────
// CRON_MONITOR_5MIN: cadence 300s + margin 600s = deadline ved +900s.

test("isOverdue — lige INDEN FOR margin (899s efter sidste check-in) er IKKE overskredet", () => {
  const now = new Date("2026-08-30T12:15:00.000Z");
  const lastCheckinAt = new Date(now.getTime() - 899_000).toISOString();
  assert.equal(
    isOverdue({ lastCheckinAt, cadenceSeconds: 300, marginSeconds: 600, now }),
    false
  );
});

test("isOverdue — lige UDEN FOR margin (901s efter sidste check-in) ER overskredet", () => {
  const now = new Date("2026-08-30T12:15:00.000Z");
  const lastCheckinAt = new Date(now.getTime() - 901_000).toISOString();
  assert.equal(
    isOverdue({ lastCheckinAt, cadenceSeconds: 300, marginSeconds: 600, now }),
    true
  );
});

test("isOverdue — præcis på deadline (900s) er IKKE overskredet (strict >, ikke >=)", () => {
  const now = new Date("2026-08-30T12:15:00.000Z");
  const lastCheckinAt = new Date(now.getTime() - 900_000).toISOString();
  assert.equal(
    isOverdue({ lastCheckinAt, cadenceSeconds: 300, marginSeconds: 600, now }),
    false
  );
});

test("isOverdue — intet check-in endnu (null) er IKKE overskredet (vent, gæt ikke)", () => {
  assert.equal(isOverdue({ lastCheckinAt: null, cadenceSeconds: 300, marginSeconds: 600, now: new Date() }), false);
});

// ── computeOverdueSlugs ──────────────────────────────────────────────────────

test("computeOverdueSlugs — finder kun de jobs der reelt er overskredet", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const monitors = [
    ["healthy-job", CRON_MONITOR_5MIN],
    ["dead-job", CRON_MONITOR_5MIN],
  ];
  const checkinsBySlug = {
    "healthy-job": { last_checkin_at: new Date(now.getTime() - 60_000).toISOString() }, // 1 min siden — frisk
    "dead-job": { last_checkin_at: new Date(now.getTime() - 3600_000).toISOString() }, // 1 time siden — dødt
  };
  const overdue = computeOverdueSlugs({ monitors, checkinsBySlug, now });
  assert.deepEqual(overdue.map((o) => o.slug), ["dead-job"]);
});

test("computeOverdueSlugs — job uden nogen check-in-række endnu springes over (ikke gættet som overskredet)", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const monitors = [["brand-new-job", CRON_MONITOR_5MIN]];
  const overdue = computeOverdueSlugs({ monitors, checkinsBySlug: {}, now });
  assert.deepEqual(overdue, []);
});

test("computeOverdueSlugs — respekterer hver jobs EGEN kadence/margin fra registret (24h-job er ikke overskredet efter 2 timer)", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const monitors = [["daily-job", CRON_MONITOR_24H]];
  const checkinsBySlug = {
    "daily-job": { last_checkin_at: new Date(now.getTime() - 2 * 3600_000).toISOString() }, // 2 timer siden
  };
  assert.deepEqual(computeOverdueSlugs({ monitors, checkinsBySlug, now }), []);
});

// ── recordCronCheckIn (in-memory supabase-stub) ─────────────────────────────

function makeUpsertStub({ onUpsert, error = null } = {}) {
  return {
    from(table) {
      return {
        upsert(row, opts) {
          onUpsert?.(table, row, opts);
          return Promise.resolve({ data: error ? null : [row], error });
        },
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
}

test("recordCronCheckIn — skriver job_slug + cadence til cron_checkins-tabellen", async () => {
  const upserts = [];
  const supabase = makeUpsertStub({ onUpsert: (table, row) => upserts.push({ table, row }) });
  await recordCronCheckIn({ supabase, jobSlug: "auctions", cadenceSeconds: 60, now: new Date("2026-08-30T10:00:00Z") });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].table, CRON_CHECKINS_TABLE);
  assert.equal(upserts[0].row.job_slug, "auctions");
  assert.equal(upserts[0].row.expected_cadence_seconds, 60);
  assert.equal(upserts[0].row.last_checkin_at, "2026-08-30T10:00:00.000Z");
});

test("recordCronCheckIn — Supabase-fejl logges/captures men kaster ALDRIG (må ikke vælte jobbet)", async () => {
  const supabase = makeUpsertStub({ error: { message: "connection reset" } });
  const captured = [];
  await assert.doesNotReject(() =>
    recordCronCheckIn({
      supabase,
      jobSlug: "auctions",
      cadenceSeconds: 60,
      captureExceptionFn: (err) => captured.push(err.message),
    })
  );
  assert.equal(captured.length, 1);
  assert.match(captured[0], /connection reset/);
});

test("recordCronCheckIn — en kastet exception fra supabase-klienten selv logges/captures men re-throw'er ikke", async () => {
  const supabase = { from: () => ({ upsert: () => { throw new Error("network down"); } }) };
  const captured = [];
  await assert.doesNotReject(() =>
    recordCronCheckIn({ supabase, jobSlug: "auctions", cadenceSeconds: 60, captureExceptionFn: (err) => captured.push(err.message) })
  );
  assert.equal(captured.length, 1);
  assert.match(captured[0], /network down/);
});

test("primeCronHeartbeatCheckIns — skriver ét check-in pr. monitor, fortsætter selv hvis ét fejler", async () => {
  const upserts = [];
  let call = 0;
  const supabase = {
    from: () => ({
      upsert: (row) => {
        call += 1;
        if (call === 1) return Promise.resolve({ data: null, error: { message: "boom" } });
        upserts.push(row.job_slug);
        return Promise.resolve({ data: [row], error: null });
      },
    }),
  };
  const monitors = [
    ["job-a", CRON_MONITOR_5MIN],
    ["job-b", CRON_MONITOR_5MIN],
  ];
  await primeCronHeartbeatCheckIns({ supabase, monitors, captureExceptionFn: () => {} });
  assert.deepEqual(upserts, ["job-b"]);
});

// ── runCronHeartbeatSweepCron (in-memory supabase-stub) ─────────────────────
// Anti-spam: signaturen i ops_alert_state ændrer sig KUN når SÆTTET af
// overskredne jobs ændrer sig — uændret sæt mellem to sweeps sender ikke en ny
// Discord-besked (ét pr. udeblivelse, ikke ét pr. sweep-tick).

function makeSweepSupabase({ checkins, initialAlertState = null }) {
  let alertState = initialAlertState;
  return {
    from(table) {
      if (table === CRON_CHECKINS_TABLE) {
        return { select: () => Promise.resolve({ data: checkins, error: null }) };
      }
      if (table === "ops_alert_state") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: () => Promise.resolve({ data: alertState, error: null }),
          upsert: (row) => {
            alertState = row;
            return Promise.resolve({ data: [row], error: null });
          },
        };
      }
      throw new Error(`uventet tabel i test-stub: ${table}`);
    },
    _getAlertState: () => alertState,
  };
}

test("runCronHeartbeatSweepCron — alarmerer Discord første gang et job bliver overskredet", async () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const supabase = makeSweepSupabase({
    checkins: [{ job_slug: "auctions", last_checkin_at: new Date(now.getTime() - 3600_000).toISOString() }],
  });
  const sent = [];
  const result = await runCronHeartbeatSweepCron({
    supabase,
    monitors: [["auctions", CRON_MONITOR_5MIN]],
    now,
    sendWebhookFn: (url, payload) => sent.push({ url, payload }),
    getOpsWebhookFn: async () => "https://discord.example/webhook",
  });
  assert.equal(result.alerted, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.embeds[0].fields[0].value, /auctions/);
});

test("runCronHeartbeatSweepCron — samme overskredne sæt på næste sweep sender IKKE en ny besked", async () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const supabase = makeSweepSupabase({
    checkins: [{ job_slug: "auctions", last_checkin_at: new Date(now.getTime() - 3600_000).toISOString() }],
  });
  const sent = [];
  const deps = {
    supabase,
    monitors: [["auctions", CRON_MONITOR_5MIN]],
    sendWebhookFn: (url, payload) => sent.push(payload),
    getOpsWebhookFn: async () => "https://discord.example/webhook",
  };
  const first = await runCronHeartbeatSweepCron({ ...deps, now });
  const second = await runCronHeartbeatSweepCron({ ...deps, now: new Date(now.getTime() + 5 * 60_000) });
  assert.equal(first.alerted, true);
  assert.equal(second.alerted, false, "uændret overdue-sæt må ikke re-alarmere");
  assert.equal(sent.length, 1, "kun ÉN Discord-besked for samme vedvarende udeblivelse");
});

test("runCronHeartbeatSweepCron — alarmerer IGEN når jobbet kommer sig og senere bliver overskredet på ny", async () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  let checkins = [{ job_slug: "auctions", last_checkin_at: new Date(now.getTime() - 3600_000).toISOString() }];
  const supabase = makeSweepSupabase({ checkins });
  const sent = [];
  const deps = {
    supabase,
    monitors: [["auctions", CRON_MONITOR_5MIN]],
    sendWebhookFn: (url, payload) => sent.push(payload),
    getOpsWebhookFn: async () => "https://discord.example/webhook",
  };
  const first = await runCronHeartbeatSweepCron({ ...deps, now });

  // Jobbet kommer sig — nyt check-in lige nu.
  checkins.splice(0, checkins.length, { job_slug: "auctions", last_checkin_at: now.toISOString() });
  const recovered = await runCronHeartbeatSweepCron({ ...deps, now });

  // Overskredet igen senere.
  const laterNow = new Date(now.getTime() + 3600_000);
  checkins.splice(0, checkins.length, { job_slug: "auctions", last_checkin_at: now.toISOString() });
  const second = await runCronHeartbeatSweepCron({ ...deps, now: laterNow });

  assert.equal(first.alerted, true);
  assert.equal(recovered.alerted, false);
  assert.equal(second.alerted, true, "en NY udeblivelse efter recovery skal alarmere igen");
  assert.equal(sent.length, 2);
});

test("runCronHeartbeatSweepCron — ingen overskredne jobs sender ingen besked", async () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const supabase = makeSweepSupabase({
    checkins: [{ job_slug: "auctions", last_checkin_at: now.toISOString() }],
  });
  const sent = [];
  const result = await runCronHeartbeatSweepCron({
    supabase,
    monitors: [["auctions", CRON_MONITOR_5MIN]],
    now,
    sendWebhookFn: (url, payload) => sent.push(payload),
    getOpsWebhookFn: async () => "https://discord.example/webhook",
  });
  assert.equal(result.alerted, false);
  assert.equal(sent.length, 0);
});

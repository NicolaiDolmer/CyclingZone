// #8101 — svartids-loft: måling, opgørelse og alarm-regel for de ti handlinger.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ACTIONS,
  ACTION_TIMING_TABLE,
  BUCKET_BOUNDS_MS,
  WARMUP_MS,
  ALERT_WINDOW_MS,
  matchAction,
  summarizeDurations,
  evaluateBreach,
  alertWindowStart,
  createActionTimingRecorder,
  createActionTimingMiddleware,
  runActionTimingFlush,
  buildBreachEmbed,
  configureActionTimingFlush,
  flushActionTimingOnShutdown,
} from "./actionTimingMonitor8101.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RIDER = "0b7f2d1e-3c4a-4b5c-8d9e-0f1a2b3c4d5e";

// ── Fake Supabase: ops_alert_state (dubletspærren) + action_timing_windows ────
function fakeSupabase({ missingTable = false } = {}) {
  const state = new Map();
  const inserted = [];
  const deletes = [];
  return {
    state,
    inserted,
    deletes,
    from(table) {
      if (table === "ops_alert_state") {
        return {
          select() {
            return {
              eq(_col, key) {
                return { maybeSingle: async () => ({ data: state.get(key) ?? null, error: null }) };
              },
            };
          },
          upsert: async (row) => {
            state.set(row.alert_key, { ...(state.get(row.alert_key) ?? {}), ...row });
            return { error: null };
          },
        };
      }
      if (table === ACTION_TIMING_TABLE) {
        return {
          insert: async (rows) => {
            if (missingTable) return { error: { code: "PGRST205", message: "Could not find the table" } };
            inserted.push(...rows);
            return { error: null };
          },
          delete() {
            return {
              lt: async (col, val) => {
                deletes.push([col, val]);
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`uventet tabel ${table}`);
    },
  };
}

function warmRecorder(startMs = 0) {
  let t = startMs;
  const rec = createActionTimingRecorder({ nowMs: () => t, bootMs: startMs - WARMUP_MS - 1 });
  return { rec, advance: (ms) => (t += ms) };
}

// ── Måling: hvilke ruter hører til hvilken handling ──────────────────────────

test("alle ti godkendte handlinger er med, i ejerens rækkefølge", () => {
  assert.deepEqual(
    ACTIONS.map((a) => a.key),
    [
      "train_now",
      "training_open",
      "race_selection_open",
      "race_selection_save",
      "tactics_save",
      "training_choice",
      "auction_bid",
      "list_for_sale",
      "team_create",
      "dashboard_open",
    ]
  );
});

test("matchAction genkender hver handlings ruter", () => {
  const cases = [
    ["POST", "/api/training/train-now", "train_now"],
    ["GET", "/api/training/me", "training_open"],
    ["GET", "/api/races/abc-123/selection", "race_selection_open"],
    ["PUT", "/api/races/abc-123/selection", "race_selection_save"],
    ["PUT", "/api/races/abc-123/team-orders/3", "tactics_save"],
    ["PUT", "/api/races/abc-123/stage-roles", "tactics_save"],
    ["POST", `/api/training/${RIDER}`, "training_choice"],
    ["POST", "/api/auctions/xyz/bid", "auction_bid"],
    ["PATCH", "/api/auctions/xyz/proxy", "auction_bid"],
    ["POST", "/api/auctions", "list_for_sale"],
    ["POST", "/api/transfers", "list_for_sale"],
    ["PUT", "/api/teams/my", "team_create"],
    ["GET", "/api/board/status", "dashboard_open"],
    ["GET", "/api/dashboard/my-latest-result?season=4", "dashboard_open"],
    ["get", "/api/training/me/", "training_open"],
  ];
  for (const [method, url, key] of cases) assert.equal(matchAction(method, url), key, `${method} ${url}`);
});

test("matchAction ignorerer ruter uden for listen (inkl. naboer til de ti)", () => {
  const misses = [
    ["GET", "/api/training/train-now"],
    ["POST", "/api/training/bulk"],
    ["POST", "/api/training/run-today"],
    ["DELETE", `/api/training/${RIDER}`],
    ["GET", "/api/auctions"],
    ["GET", "/api/auctions/xyz/proxy"],
    ["GET", "/api/races/abc/stage-roles"],
    ["GET", "/api/teams/my"],
    ["GET", "/api/board/verdict/7"],
    ["GET", "/health"],
    ["GET", undefined],
  ];
  for (const [method, url] of misses) assert.equal(matchAction(method, url), null, `${method} ${url}`);
});

test("middleware måler et kald ved finish uden at røre svaret", () => {
  const { rec } = warmRecorder();
  let clockMs = 1000;
  const mw = createActionTimingMiddleware({ recorder: rec, clock: () => clockMs });
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });
  let nextCalls = 0;
  mw({ method: "GET", originalUrl: "/api/training/me" }, res, () => nextCalls++);
  assert.equal(nextCalls, 1);
  clockMs += 3500;
  res.emit("finish");
  const { perAction } = rec.drain();
  assert.deepEqual(perAction.get("training_open"), [3500]);
});

test("middleware rører ikke kald uden for listen, og en fejlende måler vælter intet", () => {
  const throwing = { record() { throw new Error("boom"); } };
  const mw = createActionTimingMiddleware({ recorder: throwing, clock: () => 0 });
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });
  let nextCalls = 0;
  mw({ method: "GET", originalUrl: "/api/riders/1" }, res, () => nextCalls++);
  assert.equal(res.listenerCount("finish"), 0);
  mw({ method: "POST", originalUrl: "/api/training/train-now" }, res, () => nextCalls++);
  assert.doesNotThrow(() => res.emit("finish"));
  assert.equal(nextCalls, 2);
});

test("recorder springer kold start og 5xx over", () => {
  let t = 0;
  const rec = createActionTimingRecorder({ nowMs: () => t, bootMs: 0 });
  assert.equal(rec.record("training_open", 4000, 200), false, "inden for kold start");
  t = WARMUP_MS + 1;
  assert.equal(rec.record("training_open", 4000, 503), false, "5xx tælles ikke");
  assert.equal(rec.record("ukendt", 100, 200), false);
  assert.equal(rec.record("training_open", 4000, 200), true);
  assert.equal(rec.record("training_open", 120, 404), true, "4xx er stadig en spiller der venter");
  assert.equal(rec.pendingCount(), 2);
  rec.drain();
  assert.equal(rec.pendingCount(), 0, "drain tømmer vinduet");
});

// ── Opgørelse ─────────────────────────────────────────────────────────────────

test("summarizeDurations: antal, median, 95 %, over 3 s og hængende", () => {
  const d = [];
  for (let i = 1; i <= 100; i++) d.push(i * 100); // 100 ms .. 10.000 ms
  d.push(90_000); // én hængende
  const s = summarizeDurations(d);
  assert.equal(s.calls, 101);
  assert.equal(s.p50Ms, 5100);
  assert.equal(s.p95Ms, 9600);
  assert.equal(s.maxMs, 90_000);
  assert.equal(s.over3s, 71); // 3100..10000 (70) + den hængende
  assert.equal(s.hung, 1);
  assert.equal(s.buckets.length, BUCKET_BOUNDS_MS.length + 1);
  assert.equal(s.buckets.reduce((a, b) => a + b, 0), 101);
  assert.equal(s.buckets.at(-1), 1, "overløbs-spanden holder det hængende kald");
});

test("præcis 3 s er ikke over 3 s", () => {
  assert.equal(summarizeDurations([3000]).over3s, 0);
  assert.equal(summarizeDurations([3001]).over3s, 1);
});

test("spand-grænserne i migrationen matcher koden", () => {
  const sql = readFileSync(join(HERE, "..", "..", "database", "2026-11-13-8101-action-timing.sql"), "utf8");
  const m = sql.match(/SELECT ARRAY\[([0-9,\s]+)\]::integer\[\] AS ub/);
  assert.ok(m, "bounds-array ikke fundet i migrationen");
  assert.deepEqual(m[1].split(",").map((x) => Number(x.trim())), BUCKET_BOUNDS_MS);
});

// ── Alarm-regel ──────────────────────────────────────────────────────────────

function windowOf({ fast = 0, slow = 0, hung = 0 }) {
  return summarizeDurations([
    ...Array(fast).fill(800),
    ...Array(slow).fill(4000),
    ...Array(hung).fill(120_000),
  ]);
}

test("sjælden handling: ét langsomt kald er nok", () => {
  assert.equal(evaluateBreach({ key: "train_now", summary: windowOf({ slow: 1 }) }).breach, true);
  assert.equal(evaluateBreach({ key: "team_create", summary: windowOf({ slow: 1, fast: 5 }) }).breach, true);
  assert.equal(evaluateBreach({ key: "train_now", summary: windowOf({ fast: 3 }) }).breach, false);
});

test("hyppig handling: spredte langsomme kald på dagens niveau giver ingen alarm", () => {
  // Et enkelt eller to langsomme kald blandt mange: under minimum.
  assert.equal(evaluateBreach({ key: "training_open", summary: windowOf({ fast: 9, slow: 1 }) }).breach, false);
  assert.equal(evaluateBreach({ key: "training_open", summary: windowOf({ fast: 18, slow: 2 }) }).breach, false);
  // Nok langsomme kald, men en lille andel af mange: ingen alarm.
  assert.equal(evaluateBreach({ key: "race_selection_open", summary: windowOf({ fast: 60, slow: 3 }) }).breach, false);
});

test("hyppig handling: mange langsomme kald giver alarm", () => {
  const v = evaluateBreach({ key: "training_open", summary: windowOf({ fast: 10, slow: 4 }) });
  assert.equal(v.breach, true);
  assert.equal(v.slowCalls, 4);
});

test("hængende kald udløser ikke 3-sekunders-alarmen", () => {
  assert.equal(evaluateBreach({ key: "train_now", summary: windowOf({ hung: 2 }) }).breach, false);
  assert.equal(evaluateBreach({ key: "training_open", summary: windowOf({ hung: 5 }) }).breach, false);
});

test("alarmvinduet er fast og UTC-justeret", () => {
  const a = alertWindowStart(new Date("2026-11-14T07:59:00Z"));
  const b = alertWindowStart(new Date("2026-11-14T11:59:59Z"));
  const c = alertWindowStart(new Date("2026-11-14T12:00:00Z"));
  assert.equal(a.toISOString(), "2026-11-14T06:00:00.000Z");
  assert.equal(b.toISOString(), a.toISOString());
  assert.notEqual(c.toISOString(), a.toISOString());
  assert.equal(ALERT_WINDOW_MS, 6 * 60 * 60 * 1000);
});

// ── Flush: gem + alarm ───────────────────────────────────────────────────────

async function flushWith({ supabase, rec, now, sent }) {
  return runActionTimingFlush({
    supabase,
    recorder: rec,
    now,
    procId: "test:1",
    getOpsWebhookFn: async () => "https://discord.example/ops",
    sendWebhookFn: async (url, payload) => sent.push({ url, payload }),
    captureExceptionFn: (e) => {
      throw e;
    },
  });
}

test("flush skriver én række pr. handling med opgørelsen", async () => {
  const supabase = fakeSupabase();
  const { rec } = warmRecorder();
  rec.record("training_open", 900);
  rec.record("training_open", 1100);
  rec.record("dashboard_open", 400);
  const sent = [];
  const r = await flushWith({ supabase, rec, now: new Date("2026-11-14T08:15:00Z"), sent });
  assert.equal(r.persisted, true);
  assert.equal(supabase.inserted.length, 2);
  const row = supabase.inserted.find((x) => x.action === "training_open");
  assert.equal(row.calls, 2);
  assert.equal(row.over_3s, 0);
  assert.equal(row.process_id, "test:1");
  assert.equal(row.buckets.reduce((a, b) => a + b, 0), 2);
  assert.equal(sent.length, 0, "ingen alarm uden langsomme kald");
  assert.equal(supabase.deletes.length, 1, "gamle rækker ryddes");
  assert.equal(rec.pendingCount(), 0);
});

test("en langsom handling udløser præcis én alarm pr. vindue", async () => {
  const supabase = fakeSupabase();
  const { rec } = warmRecorder();
  const sent = [];
  // Tre kvarterer i samme 6-timers-vindue, hver med et langsomt Træn nu.
  for (const at of ["2026-11-14T06:15:00Z", "2026-11-14T06:30:00Z", "2026-11-14T11:45:00Z"]) {
    rec.record("train_now", 12_000);
    await flushWith({ supabase, rec, now: new Date(at), sent });
  }
  assert.equal(sent.length, 1, "kun første brud i vinduet sender");
  assert.equal(sent[0].url, "https://discord.example/ops");
  assert.match(sent[0].payload.embeds[0].title, /Træn nu/);

  // Nyt vindue: én ny besked.
  rec.record("train_now", 12_000);
  await flushWith({ supabase, rec, now: new Date("2026-11-14T12:15:00Z"), sent });
  assert.equal(sent.length, 2);
});

test("hver handling har sin egen spærre: to langsomme handlinger giver to beskeder", async () => {
  const supabase = fakeSupabase();
  const { rec } = warmRecorder();
  const sent = [];
  rec.record("train_now", 12_000);
  rec.record("team_create", 8_000);
  const r = await flushWith({ supabase, rec, now: new Date("2026-11-14T06:15:00Z"), sent });
  assert.deepEqual(r.alerted.sort(), ["team_create", "train_now"]);
  assert.equal(sent.length, 2);
});

test("manglende tabel (før migrationen) vælter intet, og alarmen virker stadig", async () => {
  const supabase = fakeSupabase({ missingTable: true });
  const { rec } = warmRecorder();
  const sent = [];
  rec.record("train_now", 12_000);
  const r = await flushWith({ supabase, rec, now: new Date("2026-11-14T06:15:00Z"), sent });
  assert.equal(r.persisted, false);
  assert.equal(sent.length, 1);
});

test("uden webhook bruges vinduet ikke op: alarmen sendes, når kanalen er tilbage", async () => {
  const supabase = fakeSupabase();
  const { rec } = warmRecorder();
  const sent = [];
  let url = null;
  const flush = (at) =>
    runActionTimingFlush({
      supabase,
      recorder: rec,
      now: new Date(at),
      procId: "test:1",
      getOpsWebhookFn: async () => url,
      sendWebhookFn: async (_u, payload) => sent.push(payload),
    });
  rec.record("train_now", 12_000);
  const r1 = await flush("2026-11-14T06:15:00Z");
  assert.deepEqual(r1.alerted, []);
  assert.equal(supabase.state.size, 0, "intet claim uden kanal");
  url = "https://discord.example/ops";
  rec.record("train_now", 12_000);
  await flush("2026-11-14T06:30:00Z");
  assert.equal(sent.length, 1);
});

test("et fejlende send claimer ikke vinduet", async () => {
  const supabase = fakeSupabase();
  const { rec } = warmRecorder();
  rec.record("train_now", 12_000);
  await assert.rejects(
    runActionTimingFlush({
      supabase,
      recorder: rec,
      now: new Date("2026-11-14T06:15:00Z"),
      procId: "test:1",
      getOpsWebhookFn: async () => "https://discord.example/ops",
      sendWebhookFn: async () => {
        throw new Error("discord nede");
      },
    })
  );
  assert.equal(supabase.state.size, 0);
});

test("flush ved nedlukning: no-op uden cron, ellers gemmes det igangværende kvarter", async () => {
  assert.equal(await flushActionTimingOnShutdown(), null, "ikke konfigureret endnu");
  const supabase = fakeSupabase();
  const { rec } = warmRecorder();
  configureActionTimingFlush({ supabase, recorder: rec, procId: "test:1" });
  rec.record("training_open", 700);
  const r = await flushActionTimingOnShutdown();
  assert.equal(r.persisted, true);
  assert.equal(supabase.inserted.length, 1);
});

test("flush ved nedlukning kaster aldrig og har et tidsloft", async () => {
  configureActionTimingFlush({
    supabase: { from() { throw new Error("db nede"); } },
    recorder: { drain: () => ({ windowStart: new Date(), windowEnd: new Date(), perAction: new Map([["train_now", [5000]]]) }) },
    procId: "test:1",
  });
  const captured = [];
  assert.equal(await flushActionTimingOnShutdown({ captureExceptionFn: (e) => captured.push(e) }), null);
  assert.equal(captured.length, 1);

  configureActionTimingFlush({
    supabase: { from: () => ({ insert: () => new Promise(() => {}) }) },
    recorder: { drain: () => ({ windowStart: new Date(), windowEnd: new Date(), perAction: new Map([["train_now", [5000]]]) }) },
    procId: "test:1",
  });
  const t0 = Date.now();
  assert.equal(await flushActionTimingOnShutdown({ timeoutMs: 50 }), null);
  assert.ok(Date.now() - t0 < 2000);
});

test("tomt vindue: ingen skrivning, ingen alarm", async () => {
  const supabase = fakeSupabase();
  const { rec } = warmRecorder();
  const sent = [];
  const r = await flushWith({ supabase, rec, now: new Date("2026-11-14T06:15:00Z"), sent });
  assert.equal(r.rows.length, 0);
  assert.equal(supabase.inserted.length, 0);
  assert.equal(sent.length, 0);
});

test("alarmbeskeden indeholder ingen spiller- eller hold-data", () => {
  const summary = windowOf({ fast: 10, slow: 4 });
  const payload = buildBreachEmbed({
    key: "training_open",
    summary,
    slowCalls: 4,
    share: 4 / 14,
    windowStart: new Date("2026-11-14T06:00:00Z"),
    windowEnd: new Date("2026-11-14T06:15:00Z"),
  });
  const text = JSON.stringify(payload);
  assert.match(text, /Åbn Træning/);
  assert.match(text, /4 af 14 kald/);
  assert.doesNotMatch(text, /team_id|user_id|@/);
});

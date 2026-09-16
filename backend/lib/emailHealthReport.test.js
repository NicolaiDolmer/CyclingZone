import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateEmailHealthThresholds,
  summarizeEmailLogWindow,
  summarizeSweepRunsWindow,
  buildHealthReportEmbed,
  recordEmailSweepRun,
  runEmailHealthReport,
  BOUNCE_RATE_THRESHOLD,
  COMPLAINT_RATE_THRESHOLD,
  MIN_SENT_FOR_RATE,
  EMAIL_HEALTH_HOUR_COPENHAGEN,
} from "./emailHealthReport.js";
import { copenhagenHour } from "./copenhagenTime.js";

const NOW = new Date("2026-09-08T09:00:00Z"); // 11:00 dansk tid (efter 08)
const BEFORE_HOUR = new Date("2026-09-08T04:00:00Z"); // 06:00 dansk tid

const iso = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const logRow = (status, extra = {}) => ({
  status, attempts: 1, next_attempt_at: null, created_at: iso(2 * HOUR), email_type: "welcome", ...extra,
});

// ─── vindue-optaelling ───────────────────────────────────────────────────────

test("summarizeEmailLogWindow taeller alle fire naaede-Resend-statusser som 'sendt'", () => {
  const rows = [logRow("sent"), logRow("delivered"), logRow("bounced"), logRow("complained"), logRow("dry_run")];
  const s = summarizeEmailLogWindow(rows, { fromIso: iso(DAY) });
  assert.equal(s.sent, 4, "dry_run taeller ikke som sendt");
  assert.equal(s.dryRun, 1);
  assert.equal(s.delivered, 1);
  assert.equal(s.bounced, 1);
  assert.equal(s.complained, 1);
});

test("summarizeEmailLogWindow skelner permanent fejl, retry i koe og opgivet retry", () => {
  const rows = [
    logRow("failed", { attempts: 1, next_attempt_at: null }), // permanent paa foerste forsoeg
    logRow("failed", { attempts: 3, next_attempt_at: iso(-HOUR) }), // i retry-koen
    logRow("failed", { attempts: 8, next_attempt_at: null }), // opgivet
  ];
  const s = summarizeEmailLogWindow(rows, { fromIso: iso(DAY) });
  assert.equal(s.failedPermanent, 2);
  assert.equal(s.failedRetryable, 1);
  assert.equal(s.deadRetries, 1, "kun raekken der faktisk blev proevet igen");
});

test("summarizeEmailLogWindow respekterer baade fra- og til-graensen (doegnet FOER)", () => {
  const rows = [logRow("sent", { created_at: iso(2 * HOUR) }), logRow("sent", { created_at: iso(30 * HOUR) })];
  const today = summarizeEmailLogWindow(rows, { fromIso: iso(DAY) });
  const yesterday = summarizeEmailLogWindow(rows, { fromIso: iso(2 * DAY), toIso: iso(DAY) });
  assert.equal(today.sent, 1);
  assert.equal(yesterday.sent, 1);
});

test("summarizeSweepRunsWindow lister alle tre typer, ogsaa dem uden koersler", () => {
  const runs = [{ email_type: "welcome", stage: "on", candidates: 4, sent: 4, skipped: 0, failed: 0, created_at: iso(2 * HOUR) }];
  const s = summarizeSweepRunsWindow(runs, { fromIso: iso(DAY) });
  assert.deepEqual(Object.keys(s).sort(), ["day1", "race_digest", "welcome"]);
  assert.deepEqual(s.welcome, { candidates: 4, sent: 4, skipped: 0, failed: 0, runs: 1 });
  assert.deepEqual(s.day1, { candidates: 0, sent: 0, skipped: 0, failed: 0, runs: 0 });
});

// ─── taerskler ───────────────────────────────────────────────────────────────

const cleanWindow = {
  sent: 100, dryRun: 0, delivered: 99, bounced: 1, complained: 0,
  failedPermanent: 0, failedRetryable: 0, deadRetries: 0,
};

// #5296: exercise the actual report, including its SELECT projection. A fake
// returning every column would hide the original missing skipped/failed read.
async function reportWithRuns(runs, now = NOW, logs = []) {
  const posts = [];
  const supabase = {
    from(table) {
      if (table === "ops_alert_state") return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: async () => ({ error: null }),
      };
      assert.ok(["email_log", "email_sweep_runs"].includes(table));
      let columns;
      let from;
      const query = {
        select(value) { columns = value.split(",").map((c) => c.trim()); return query; },
        gte(column, value) { assert.equal(column, "created_at"); from = value; return query; },
        order() { return query; },
        async range(start, end) {
          const source = table === "email_log" ? logs : runs;
          return { data: source.filter((row) => row.created_at >= from).slice(start, end + 1)
            .map((row) => Object.fromEntries(columns.map((column) => [column, row[column]]))), error: null };
        },
      };
      return query;
    },
  };
  const result = await runEmailHealthReport({
    supabase, now,
    sendWebhookFn: async (_url, payload) => posts.push(payload),
    getOpsWebhookFn: async () => "https://discord.example/ops",
  });
  return { result, payload: posts[0] };
}

const runRow = (hoursAgo, extra = {}) => ({
  email_type: "welcome", stage: "on", candidates: 1, sent: 0, skipped: 1, failed: 0,
  created_at: iso(hoursAgo * HOUR), ...extra,
});

test("#5296: already delivered welcome remains a candidate for 48h without a false alert", async () => {
  // One successful send just outside the 48h report span, followed by normal
  // dedupe observations in BOTH rolling windows. No new signup is required.
  const { result, payload } = await reportWithRuns([
    runRow(49, { sent: 1, skipped: 0 }), runRow(47), runRow(25), runRow(23),
  ], NOW, [logRow("delivered", { created_at: iso(49 * HOUR) })]);
  assert.deepEqual(result.breaches, []);
  assert.deepEqual(result.types24h.welcome, { candidates: 1, sent: 0, skipped: 1, failed: 0, runs: 1 });
  assert.equal(payload.content, undefined, "normal dedupe must not mention the owner");
  const details = payload.embeds[0].fields.find((field) => field.name.startsWith("Pr. type")).value;
  assert.match(details, /1 observation/);
  assert.match(details, /0 sendt/);
  assert.match(details, /1 skippet/);
  assert.match(details, /0 fejlet/);
});

test("#5296: skipped candidates do not hide real sweep failures or unaccounted candidates", async () => {
  for (const failed of [0, 1]) {
    const { result } = await reportWithRuns([
      runRow(30, { candidates: 2, failed }), runRow(2, { candidates: 2, failed }),
    ]);
    assert.equal(result.breaches.length, 1, "one non-skipped candidate per window must still alert");
    assert.match(result.breaches[0], /to doegn i traek/);
  }
  const { result } = await reportWithRuns([runRow(30), runRow(2, { candidates: 2, failed: 1 })]);
  assert.deepEqual(result.breaches, [], "a skipped-only previous window is not a second failed day");
});

test("#5296: dry_run neither creates a live-send alarm nor masks an on-stage failure", async () => {
  const dry = [runRow(30, { stage: "dry_run", skipped: 0, failed: 1 }), runRow(2, { stage: "dry_run", skipped: 0, failed: 1 })];
  const { result: dryResult } = await reportWithRuns(dry);
  assert.deepEqual(dryResult.breaches, []);
  assert.equal(dryResult.types24h.welcome.candidates, 0);
  const { result } = await reportWithRuns([
    runRow(30, { stage: "dry_run", sent: 1, skipped: 0 }),
    runRow(2, { stage: "dry_run", sent: 1, skipped: 0 }),
    runRow(30, { skipped: 0, failed: 1 }), runRow(2, { skipped: 0, failed: 1 }),
  ]);
  assert.equal(result.breaches.length, 1);
  assert.equal(result.types24h.welcome.sent, 0, "a dry run is not a sent email");
});

test("#5296: rolling 24h boundaries include late UTC deliveries across Copenhagen dates and DST", async () => {
  for (const now of [
    new Date("2026-09-16T06:00:00Z"), // 08 CEST
    new Date("2026-01-16T07:00:00Z"), // 08 CET
    new Date("2026-03-29T06:00:00Z"), // DST starts
    new Date("2026-10-25T07:00:00Z"), // DST ends
  ]) {
    const at = (hoursAgo) => new Date(now.getTime() - hoursAgo * HOUR).toISOString();
    const rows = [
      runRow(0, { created_at: at(24), sent: 1, skipped: 0 }),
      runRow(0, { created_at: at(48), sent: 2, candidates: 2, skipped: 0 }),
      runRow(0, { created_at: at(48 + 1 / 3600), sent: 99, candidates: 99, skipped: 0 }),
    ];
    const { result } = await reportWithRuns(rows, now);
    assert.equal(result.posted, true);
    assert.equal(result.types24h.welcome.sent, 1, "24h cutoff belongs to latest window");
    const earlier = summarizeSweepRunsWindow(rows, { fromIso: at(48), toIso: at(24) });
    assert.equal(earlier.welcome.sent, 2, "previous window is half-open with no overlap");
  }
  const { result } = await reportWithRuns([
    runRow(0, { created_at: "2026-09-15T23:08:01.000Z", sent: 1, skipped: 0 }),
  ], new Date("2026-09-16T06:00:00Z"), [logRow("delivered", { created_at: "2026-09-15T23:08:01.000Z" })]);
  assert.equal(result.types24h.welcome.sent, 1);
  assert.equal(result.window24h.sent, 1);
});

test("rene tal bryder ingen taerskel", () => {
  assert.deepEqual(evaluateEmailHealthThresholds({ window24h: cleanWindow }), []);
});

test("bounce-rate over 2 % bryder taersklen", () => {
  const w = { ...cleanWindow, bounced: 3 }; // 3 %
  const breaches = evaluateEmailHealthThresholds({ window24h: w });
  assert.equal(breaches.length, 1);
  assert.ok(breaches[0].startsWith("Bounce-rate"));
});

test("bounce-rate praecis PAA graensen bryder ikke (streng >)", () => {
  const w = { ...cleanWindow, sent: 100, bounced: BOUNCE_RATE_THRESHOLD * 100 };
  assert.deepEqual(evaluateEmailHealthThresholds({ window24h: w }), []);
});

test("under minimums-volumen ignoreres raterne helt (statistisk stoej)", () => {
  const w = { ...cleanWindow, sent: MIN_SENT_FOR_RATE - 1, bounced: 5, complained: 5 };
  assert.deepEqual(evaluateEmailHealthThresholds({ window24h: w }), [], "9 sendte er ikke nok til at udtale sig");
});

test("klage-rate over 0,1 % bryder taersklen", () => {
  const w = { ...cleanWindow, sent: 1000, delivered: 999, bounced: 0, complained: 2 }; // 0,2 %
  const breaches = evaluateEmailHealthThresholds({ window24h: w });
  assert.equal(breaches.length, 1);
  assert.ok(breaches[0].startsWith("Klage-rate"));
  assert.ok(COMPLAINT_RATE_THRESHOLD < 0.002);
});

test("én opgivet retry er nok til et brud", () => {
  const breaches = evaluateEmailHealthThresholds({ window24h: { ...cleanWindow, deadRetries: 1 } });
  assert.equal(breaches.length, 1);
  assert.ok(breaches[0].includes("opgivet"));
});

test("en type med kandidater men 0 sendt bryder FOERST paa andet doegn i traek", () => {
  const types = { welcome: { candidates: 5, sent: 0 } };
  const oneDay = evaluateEmailHealthThresholds({ window24h: cleanWindow, types24h: types, types48h: {} });
  assert.deepEqual(oneDay, [], "ét stille doegn kan vaere en tilfaeldighed");

  const twoDays = evaluateEmailHealthThresholds({ window24h: cleanWindow, types24h: types, types48h: types });
  assert.equal(twoDays.length, 1);
  assert.ok(twoDays[0].includes("to doegn i traek"));
});

test("en type UDEN kandidater er aldrig et brud, uanset hvor mange doegn", () => {
  const types = { welcome: { candidates: 0, sent: 0 } };
  assert.deepEqual(
    evaluateEmailHealthThresholds({ window24h: cleanWindow, types24h: types, types48h: types }),
    []
  );
});

// ─── embed ───────────────────────────────────────────────────────────────────

test("embedet skifter titel og farve ved brud og lister aarsagerne", () => {
  const types = { welcome: { candidates: 3, sent: 3 } };
  const clean = buildHealthReportEmbed({
    window24h: cleanWindow, window7d: cleanWindow, types24h: types, retryQueue: 0, breaches: [], now: NOW,
  });
  assert.equal(clean.embeds[0].title, "Mail-drift: daglig rapport");

  const broken = buildHealthReportEmbed({
    window24h: cleanWindow, window7d: cleanWindow, types24h: types, retryQueue: 0,
    breaches: ["Bounce-rate 4,0 % over graensen"], now: NOW,
  });
  assert.equal(broken.embeds[0].title, "Mail-drift: taerskel brudt");
  assert.ok(broken.embeds[0].description.includes("Bounce-rate"));
});

// ─── sweep-run-log ───────────────────────────────────────────────────────────

test("recordEmailSweepRun skriver intet naar der ingen kandidater var", async () => {
  const supabase = { from() { throw new Error("maa ikke skrive uden kandidater"); } };
  assert.deepEqual(await recordEmailSweepRun({ supabase, emailType: "welcome", stage: "on", candidates: 0 }), {
    recorded: false,
  });
});

test("recordEmailSweepRun sluger en DB-fejl - en sweep maa aldrig vaelte af sin egen log", async () => {
  const supabase = { from: () => ({ insert: async () => ({ error: { message: "boom" } }) }) };
  const res = await recordEmailSweepRun({ supabase, emailType: "day1", stage: "on", candidates: 2, sent: 2 });
  assert.deepEqual(res, { recorded: false });
});

// ─── time-gate + dags-dedupe ─────────────────────────────────────────────────

test("foer kl. 08 dansk tid koerer rapporten slet ikke (ingen DB-arbejde)", async () => {
  assert.ok(copenhagenHour(BEFORE_HOUR) < EMAIL_HEALTH_HOUR_COPENHAGEN);
  const supabase = { from() { throw new Error("maa ikke roere databasen foer vinduet"); } };
  const res = await runEmailHealthReport({ supabase, now: BEFORE_HOUR });
  assert.equal(res.skipped, "outside_hour_window");
});

test("samme dag to gange: kun den foerste rapport sendes", async () => {
  const state = { signature: null, last_alerted_at: null };
  const posts = [];
  const supabase = {
    from(table) {
      if (table === "ops_alert_state") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.signature ? { ...state } : null, error: null }) }) }),
          upsert: async (row) => { state.signature = row.signature; state.last_alerted_at = row.last_alerted_at ?? state.last_alerted_at; return { error: null }; },
        };
      }
      const empty = {
        select: () => empty, gte: () => empty, order: () => empty,
        range: async () => ({ data: [], error: null }),
      };
      return empty;
    },
  };
  const args = {
    supabase, now: NOW,
    sendWebhookFn: async (url, payload) => posts.push({ url, payload }),
    getOpsWebhookFn: async () => "https://discord.example/ops",
  };

  const first = await runEmailHealthReport(args);
  const second = await runEmailHealthReport(args);

  assert.equal(first.posted, true);
  assert.equal(second.posted, false);
  assert.equal(second.skipped, "already_reported_today");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].payload.content, undefined, "en ren rapport @mentioner ikke");
});

test("en fejlet afsendelse bruger IKKE dagen op - naeste tick samme dag rapporterer igen", async () => {
  // Fund 8/9 (review-runde 2): dags-signaturen blev claimet FOER postOpsEmbed.
  // Kastede webhook-opslaget (eller Discord), var dagen brugt, og rapporten
  // forsvandt indtil naeste doegn — praecis paa en dag hvor noget driller.
  const state = { signature: null, last_alerted_at: null };
  const posts = [];
  const supabase = {
    from(table) {
      if (table === "ops_alert_state") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.signature ? { ...state } : null, error: null }) }) }),
          upsert: async (row) => { state.signature = row.signature; state.last_alerted_at = row.last_alerted_at ?? state.last_alerted_at; return { error: null }; },
        };
      }
      const empty = {
        select: () => empty, gte: () => empty, order: () => empty,
        range: async () => ({ data: [], error: null }),
      };
      return empty;
    },
  };
  let webhookFails = true;

  await assert.rejects(
    runEmailHealthReport({
      supabase, now: NOW,
      sendWebhookFn: async (url, payload) => posts.push({ url, payload }),
      getOpsWebhookFn: async () => { if (webhookFails) throw new Error("ops-webhook nede"); return "https://discord.example/ops"; },
    }),
    /ops-webhook nede/
  );
  assert.equal(state.signature, null, "dagen maa IKKE vaere claimet naar intet blev sendt");

  webhookFails = false;
  const retry = await runEmailHealthReport({
    supabase, now: NOW,
    sendWebhookFn: async (url, payload) => posts.push({ url, payload }),
    getOpsWebhookFn: async () => "https://discord.example/ops",
  });

  assert.equal(retry.posted, true, "samme dag skal rapporten kunne sendes naar kanalen er tilbage");
  assert.equal(posts.length, 1);
  assert.ok(state.signature, "foerst NU er dagen claimet");
});

test("en rapport uden wired ops-kanal claimer heller ikke dagen", async () => {
  const state = { signature: null, last_alerted_at: null };
  const supabase = {
    from(table) {
      if (table === "ops_alert_state") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.signature ? { ...state } : null, error: null }) }) }),
          upsert: async (row) => { state.signature = row.signature; return { error: null }; },
        };
      }
      const empty = {
        select: () => empty, gte: () => empty, order: () => empty,
        range: async () => ({ data: [], error: null }),
      };
      return empty;
    },
  };

  const res = await runEmailHealthReport({ supabase, now: NOW });

  assert.equal(res.posted, false);
  assert.equal(state.signature, null);
});

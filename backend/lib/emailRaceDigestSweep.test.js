import test from "node:test";
import assert from "node:assert/strict";
import { runEmailRaceDigestSweep, DIGEST_HOUR_COPENHAGEN, DIGEST_ACTIVITY_WINDOW_MS } from "./emailRaceDigestSweep.js";
import { copenhagenHour, copenhagenMidnightUTC } from "./copenhagenTime.js";

// #2853: same-day timestamp as IN_WINDOW_NOW, well inside the 14-day
// activity window, used as the default last_seen for any fixture user row
// that doesn't explicitly test the activity filter.
const DEFAULT_ACTIVE_LAST_SEEN = "2026-07-20T10:00:00Z";

// July -> CEST (UTC+2). 17:15 UTC = 19:15 Copenhagen (inside the digest hour);
// 16:15 UTC = 18:15 Copenhagen (outside it). Asserted via copenhagenHour
// itself rather than hardcoded, so the test fails loudly if the fixture ever
// drifts off a DST boundary instead of silently testing the wrong hour.
const IN_WINDOW_NOW = new Date("2026-07-20T17:15:00Z");
const OUT_OF_WINDOW_NOW = new Date("2026-07-20T16:15:00Z");

function makeSupabase({ raceResultRows = [], userRows = [] } = {}) {
  return {
    from(table) {
      if (table === "race_results") {
        const eqFilters = [];
        let gteFilter = null;
        let notNullCol = null;
        const b = {
          select() { return b; },
          gte(col, val) { gteFilter = [col, val]; return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          not(col, op, val) { if (op === "is" && val === null) notNullCol = col; return b; },
          order() { return b; },
          range() {
            let out = [...raceResultRows];
            if (gteFilter) out = out.filter((r) => r.imported_at >= gteFilter[1]);
            for (const [col, val] of eqFilters) {
              const key = col.includes(".") ? col.split(".")[1] : col;
              out = out.filter((r) =>
                col.startsWith("team.") ? (r.team?.[key] ?? false) === val : (r[key] ?? null) === val
              );
            }
            if (notNullCol) out = out.filter((r) => r[notNullCol] != null);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "users") {
        return {
          select() { return this; },
          // #2853: default every fixture row to "recently active, no opt-out"
          // unless a test explicitly overrides last_seen/email_prefs, so the
          // pre-#2853 tests don't all need updating just to add an activity
          // timestamp.
          in: async (_col, ids) => ({
            data: userRows
              .filter((u) => ids.includes(u.id))
              .map((u) => ({ last_seen: DEFAULT_ACTIVE_LAST_SEEN, email_prefs: {}, ...u })),
            error: null,
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const row = ({ rank, rider_name, team_id, userId, raceId, raceName, imported_at = "2026-07-20T10:00:00Z", human = {} }) => ({
  rank, rider_name, team_id,
  race: { id: raceId, name: raceName },
  team: { user_id: userId, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, ...human },
  imported_at,
});

test("efter kl. 19 samme dag (deploy-restart catch-up) koerer sweepen stadig (#3475-klassen)", async () => {
  const CATCHUP_NOW = new Date("2026-07-20T18:15:00Z"); // 20:15 Copenhagen
  assert.ok(copenhagenHour(CATCHUP_NOW) > DIGEST_HOUR_COPENHAGEN);
  const supabase = makeSupabase({ raceResultRows: [], userRows: [] });
  const result = await runEmailRaceDigestSweep({ supabase, now: CATCHUP_NOW, isActive: async () => true });
  assert.notEqual(result.skippedReason, "outside_hour_window");
});

test("outside the 19:00-19:59 Copenhagen hour, the sweep does no DB work at all", async () => {
  assert.ok(copenhagenHour(OUT_OF_WINDOW_NOW) < DIGEST_HOUR_COPENHAGEN);
  const supabase = {
    from() { throw new Error("must not query any table outside the digest hour"); },
  };
  const result = await runEmailRaceDigestSweep({
    supabase, now: OUT_OF_WINDOW_NOW, isActive: async () => true,
    send: async () => { throw new Error("must not send"); },
  });
  assert.equal(result.skippedReason, "outside_hour_window");
  assert.equal(result.sent, 0);
});

test("inside the digest hour but flag inactive: no-op", async () => {
  assert.equal(copenhagenHour(IN_WINDOW_NOW), DIGEST_HOUR_COPENHAGEN);
  const supabase = makeSupabase({ raceResultRows: [row({ rank: 1, rider_name: "R", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race" })] });
  const result = await runEmailRaceDigestSweep({
    supabase, now: IN_WINDOW_NOW, isActive: async () => false,
    send: async () => { throw new Error("must not send"); },
  });
  assert.deepEqual(result, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
});

test("excludes AI/bank/frozen/test-account teams from the digest", async () => {
  const rows = [
    row({ rank: 1, rider_name: "Human Rider", team_id: "t-human", userId: "user-human", raceId: "race-1", raceName: "Race One" }),
    row({ rank: 1, rider_name: "AI Rider", team_id: "t-ai", userId: "user-ai", raceId: "race-1", raceName: "Race One", human: { is_ai: true } }),
    row({ rank: 1, rider_name: "Bank Rider", team_id: "t-bank", userId: "user-bank", raceId: "race-1", raceName: "Race One", human: { is_bank: true } }),
    row({ rank: 1, rider_name: "Frozen Rider", team_id: "t-frozen", userId: "user-frozen", raceId: "race-1", raceName: "Race One", human: { is_frozen: true } }),
    row({ rank: 1, rider_name: "Test Rider", team_id: "t-test", userId: "user-test", raceId: "race-1", raceName: "Race One", human: { is_test_account: true } }),
  ];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "user-human", email: "human@example.com" }] });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const result = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(result.candidates, 1);
  assert.deepEqual(sendCalls.map((c) => c.userId), ["user-human"]);
});

test("picks the best (lowest) rank per race per manager, never invents data", async () => {
  const rows = [
    row({ rank: 5, rider_name: "Rider A", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race One" }),
    row({ rank: 2, rider_name: "Rider B", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race One" }),
    row({ rank: 10, rider_name: "Rider C", team_id: "t1", userId: "u1", raceId: "race-2", raceName: "Race Two" }),
  ];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "u1", email: "u1@example.com" }] });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(sendCalls.length, 1);
  // sendCalls[0] is the args object passed to `send` (built by buildRaceDigestEmail
  // internally, so we assert through the rendered html instead of raw results).
  assert.ok(sendCalls[0].html.includes("Rider B"), "keeps the best (rank 2) result for race-1");
  assert.ok(!sendCalls[0].html.includes("Rider A"), "drops the worse (rank 5) duplicate for the same race");
  assert.ok(sendCalls[0].html.includes("Rider C"), "keeps the single result for race-2");
});

test("dedupeKey includes the Copenhagen calendar date", async () => {
  const rows = [row({ rank: 1, rider_name: "R", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race" })];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "u1", email: "u1@example.com" }] });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(sendCalls[0].dedupeKey, "digest:u1:2026-07-20");
  assert.equal(sendCalls[0].type, "race_digest");
});

test("only includes results imported today (Copenhagen day) via imported_at >= copenhagenMidnightUTC", async () => {
  const sinceIso = copenhagenMidnightUTC(IN_WINDOW_NOW).toISOString();
  const yesterday = new Date(new Date(sinceIso).getTime() - 60 * 60 * 1000).toISOString(); // 1h before today's Copenhagen midnight
  const rows = [
    row({ rank: 1, rider_name: "Today Rider", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race", imported_at: sinceIso }),
    row({ rank: 1, rider_name: "Yesterday Rider", team_id: "t2", userId: "u2", raceId: "race-2", raceName: "Race Two", imported_at: yesterday }),
  ];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "u1", email: "u1@example.com" }, { id: "u2", email: "u2@example.com" }] });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const result = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(result.candidates, 1);
  assert.deepEqual(sendCalls.map((c) => c.userId), ["u1"]);
});

// ─── #3399 · narrative headline leads the digest ──────────────────────────

test("passes the narrative headline for the manager's BEST (lowest-rank) race today to buildRaceDigestEmail", async () => {
  const rows = [
    row({ rank: 5, rider_name: "Rider A", team_id: "t1", userId: "u1", raceId: "race-worse", raceName: "Race Worse" }),
    row({ rank: 1, rider_name: "Rider B", team_id: "t1", userId: "u1", raceId: "race-best", raceName: "Race Best" }),
  ];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "u1", email: "u1@example.com" }] });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };
  const narrativeCalls = [];
  const fetchNarrative = async ({ race }) => {
    narrativeCalls.push(race.id);
    return race.id === "race-best" ? { headlineText: "Krogh takes the sprint", ranksByUser: new Map() } : null;
  };

  await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret", fetchNarrative });

  assert.deepEqual(narrativeCalls, ["race-best"], "kun det bedste løb slår rubrik op, ikke det ringere");
  assert.ok(sendCalls[0].html.includes("Krogh takes the sprint"));
});

test("narrative fetch failure degrades to no headline, never throws", async () => {
  const rows = [row({ rank: 1, rider_name: "Rider A", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race" })];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "u1", email: "u1@example.com" }] });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };
  const result = await runEmailRaceDigestSweep({
    supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret",
    fetchNarrative: async () => { throw new Error("boom"); },
  });
  assert.equal(result.sent, 1);
  assert.ok(!sendCalls[0].html.includes("Your best moment"));
});

test("narrative lookup is memoized per raceId across managers sharing the same race", async () => {
  const rows = [
    row({ rank: 1, rider_name: "Rider A", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race" }),
    row({ rank: 2, rider_name: "Rider B", team_id: "t2", userId: "u2", raceId: "race-1", raceName: "Race" }),
  ];
  const supabase = makeSupabase({ raceResultRows: rows, userRows: [{ id: "u1", email: "u1@example.com" }, { id: "u2", email: "u2@example.com" }] });
  const send = async () => ({ status: "dry_run" });
  let calls = 0;
  const fetchNarrative = async () => { calls += 1; return { headlineText: "Krogh takes the sprint", ranksByUser: new Map() }; };

  await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret", fetchNarrative });

  assert.equal(calls, 1, "samme raceId slås kun op én gang, uanset hvor mange managere deler den");
});

test("per-manager failures are isolated", async () => {
  const rows = [
    row({ rank: 1, rider_name: "R1", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race" }),
    row({ rank: 1, rider_name: "R2", team_id: "t2", userId: "u2", raceId: "race-1", raceName: "Race" }),
  ];
  const supabase = makeSupabase({
    raceResultRows: rows,
    userRows: [{ id: "u1", email: "u1@example.com" }, { id: "u2", email: "u2@example.com" }],
  });
  const send = async (args) => {
    if (args.userId === "u1") throw new Error("resend down");
    return { status: "dry_run" };
  };

  const result = await runEmailRaceDigestSweep({
    supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret", captureExceptionFn: () => {},
  });

  assert.equal(result.candidates, 2);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
});

// ─── #2853 · 14-day activity + email_prefs consent filter ─────────────────

test("a manager who hasn't been seen in over 14 days is skipped, never sent to", async () => {
  const staleLastSeen = new Date(IN_WINDOW_NOW.getTime() - DIGEST_ACTIVITY_WINDOW_MS - 60 * 60 * 1000).toISOString(); // just over 14d ago
  const rows = [row({ rank: 1, rider_name: "R", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race" })];
  const supabase = makeSupabase({
    raceResultRows: rows,
    userRows: [{ id: "u1", email: "u1@example.com", last_seen: staleLastSeen }],
  });
  const send = async () => { throw new Error("must not send to an inactive manager"); };

  const result = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(result.candidates, 1, "still counted among today's racers");
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
});

test("a manager seen exactly at the 14-day boundary is still included (>=, not >)", async () => {
  const boundaryLastSeen = new Date(IN_WINDOW_NOW.getTime() - DIGEST_ACTIVITY_WINDOW_MS).toISOString();
  const rows = [row({ rank: 1, rider_name: "R", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race" })];
  const supabase = makeSupabase({
    raceResultRows: rows,
    userRows: [{ id: "u1", email: "u1@example.com", last_seen: boundaryLastSeen }],
  });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.deepEqual(sendCalls.map((c) => c.userId), ["u1"]);
});

test("a manager with no last_seen at all (never returned) is skipped, not treated as active", async () => {
  const rows = [row({ rank: 1, rider_name: "R", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race" })];
  const supabase = makeSupabase({
    raceResultRows: rows,
    userRows: [{ id: "u1", email: "u1@example.com", last_seen: null }],
  });
  const send = async () => { throw new Error("must not send without a last_seen timestamp"); };

  const result = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
});

test("email_prefs race_digest=false (or all=false) is skipped, reusing the existing opt-out rule", async () => {
  const rows = [
    row({ rank: 1, rider_name: "R1", team_id: "t1", userId: "u-type-off", raceId: "race-1", raceName: "Race" }),
    row({ rank: 1, rider_name: "R2", team_id: "t2", userId: "u-all-off", raceId: "race-1", raceName: "Race" }),
    row({ rank: 1, rider_name: "R3", team_id: "t3", userId: "u-opted-in", raceId: "race-1", raceName: "Race" }),
  ];
  const supabase = makeSupabase({
    raceResultRows: rows,
    userRows: [
      { id: "u-type-off", email: "a@example.com", email_prefs: { race_digest: false } },
      { id: "u-all-off", email: "b@example.com", email_prefs: { all: false } },
      { id: "u-opted-in", email: "c@example.com", email_prefs: {} },
    ],
  });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const result = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.deepEqual(sendCalls.map((c) => c.userId), ["u-opted-in"]);
  assert.equal(result.candidates, 3);
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 2);
});

test("an inactive/opted-out manager never triggers the narrative lookup (filtered before that work happens)", async () => {
  const staleLastSeen = new Date(IN_WINDOW_NOW.getTime() - DIGEST_ACTIVITY_WINDOW_MS - 60 * 60 * 1000).toISOString();
  const rows = [row({ rank: 1, rider_name: "R", team_id: "t1", userId: "u1", raceId: "race-1", raceName: "Race" })];
  const supabase = makeSupabase({
    raceResultRows: rows,
    userRows: [{ id: "u1", email: "u1@example.com", last_seen: staleLastSeen }],
  });
  const fetchNarrative = async () => { throw new Error("must not fetch a narrative for a filtered-out manager"); };

  const result = await runEmailRaceDigestSweep({
    supabase, now: IN_WINDOW_NOW, isActive: async () => true,
    send: async () => ({ status: "dry_run" }), unsubSecret: "test-secret", fetchNarrative,
  });

  assert.equal(result.skipped, 1);
});

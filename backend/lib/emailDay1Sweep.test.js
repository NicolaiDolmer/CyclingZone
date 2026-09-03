import test from "node:test";
import assert from "node:assert/strict";
import { runEmailDay1Sweep, DAY1_WINDOW_MIN_MS, DAY1_WINDOW_MAX_MS } from "./emailDay1Sweep.js";

// resultTeamIds: team ids that have >=1 race_results row (drives hasResults).
// resultsErrorForTeamIds: team ids where the race_results lookup itself
// throws, to exercise the per-team try/catch isolation.
function makeSupabase(
  teamRows,
  userEmails = {},
  { resultTeamIds = [], resultsErrorForTeamIds = [] } = {}
) {
  return {
    from(table) {
      if (table === "teams") {
        const eqFilters = [];
        let gteFilter = null;
        let lteFilter = null;
        let notNullCol = null;
        const b = {
          select() { return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          gte(col, val) { gteFilter = [col, val]; return b; },
          lte(col, val) { lteFilter = [col, val]; return b; },
          not(col, op, val) { if (op === "is" && val === null) notNullCol = col; return b; },
          order() { return b; },
          range() {
            let out = [...teamRows];
            for (const [col, val] of eqFilters) out = out.filter((r) => (r[col] ?? false) === val);
            if (gteFilter) out = out.filter((r) => r[gteFilter[0]] >= gteFilter[1]);
            if (lteFilter) out = out.filter((r) => r[lteFilter[0]] <= lteFilter[1]);
            if (notNullCol) out = out.filter((r) => r[notNullCol] != null);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "users") {
        let userId = null;
        return {
          select() { return this; },
          eq(_col, id) { userId = id; return this; },
          // userEmails values may be a bare email string (language omitted,
          // legacy fixture shape) or { email, language } for the language-
          // selection tests below.
          maybeSingle: async () => {
            const entry = userEmails[userId];
            if (!entry) return { data: null, error: null };
            const data = typeof entry === "string" ? { email: entry } : { email: entry.email, language: entry.language };
            return { data, error: null };
          },
        };
      }
      if (table === "race_results") {
        let teamId = null;
        return {
          // #2853 v2: the #3310/#3912 deep-link columns (race_id, stage_number,
          // imported_at + an order-by) are gone — pin the exact select string
          // so a regression back to the old wide select fails this mock
          // loudly instead of silently ignoring it.
          select(cols) {
            assert.equal(cols, "id");
            return this;
          },
          eq(_col, id) { teamId = id; return this; },
          limit: async () => {
            if (resultsErrorForTeamIds.includes(teamId)) {
              return { data: null, error: { message: "connection reset" } };
            }
            return {
              data: resultTeamIds.includes(teamId) ? [{ id: `result-${teamId}` }] : [],
              error: null,
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const mk = (id, extra) => ({
  id, name: `Team ${id}`, user_id: `user-${id}`,
  is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, ...extra,
});

test("targets only teams created 20-30h ago (window edges excluded/included correctly)", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const tooFresh = new Date(now.getTime() - DAY1_WINDOW_MIN_MS + 60 * 60 * 1000).toISOString(); // 19h ago
  const inWindow = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
  const tooOld = new Date(now.getTime() - DAY1_WINDOW_MAX_MS - 60 * 60 * 1000).toISOString(); // 31h ago
  const rows = [
    mk("too-fresh", { created_at: tooFresh }),
    mk("in-window", { created_at: inWindow }),
    mk("too-old", { created_at: tooOld }),
  ];
  const supabase = makeSupabase(rows, { "user-in-window": "player@example.com" });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const result = await runEmailDay1Sweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.deepEqual(sendCalls.map((c) => c.teamId), ["in-window"]);
  assert.equal(result.candidates, 1);
});

test("excludes AI/bank/frozen/test-account teams", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const inWindow = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = [
    mk("human", { created_at: inWindow }),
    mk("ai", { created_at: inWindow, is_ai: true }),
    mk("bank", { created_at: inWindow, is_bank: true }),
    mk("frozen", { created_at: inWindow, is_frozen: true }),
    mk("test", { created_at: inWindow, is_test_account: true }),
  ];
  const supabase = makeSupabase(rows, { "user-human": "human@example.com" });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const result = await runEmailDay1Sweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.deepEqual(sendCalls.map((c) => c.teamId), ["human"]);
  assert.equal(result.candidates, 1);
});

test("dedupeKey is deterministic (day1:<userId>)", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const inWindow = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = [mk("t1", { created_at: inWindow, user_id: "user-42" })];
  const supabase = makeSupabase(rows, { "user-42": "player@example.com" });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailDay1Sweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(sendCalls[0].dedupeKey, "day1:user-42");
  assert.equal(sendCalls[0].type, "day1");
});

test("hasResults=true renders the raced-while-away copy for a team with a race_results row", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const inWindow = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = [mk("t1", { created_at: inWindow, user_id: "user-42" })];
  const supabase = makeSupabase(rows, { "user-42": "player@example.com" }, { resultTeamIds: ["t1"] });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailDay1Sweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(sendCalls[0].subject, "Day 1: your riders have already raced");
  assert.ok(sendCalls[0].html.includes("raced while you were away"));
});

test("hasResults=false renders the truthful no-results-yet copy, never the invented results claim", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const inWindow = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = [mk("t1", { created_at: inWindow, user_id: "user-42" })];
  const supabase = makeSupabase(rows, { "user-42": "player@example.com" }, { resultTeamIds: [] });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailDay1Sweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(sendCalls[0].subject, "Day 1: your first race is on the calendar");
  assert.ok(!sendCalls[0].html.includes("raced while you were away"));
});

// ─── #2853 DA follow-up: users.language selects the mail's copy ───────────

test("users.language 'da' renders the Danish day1 copy for both hasResults variants", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const inWindow = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = [
    mk("has-results", { created_at: inWindow, user_id: "user-hr" }),
    mk("no-results", { created_at: inWindow, user_id: "user-nr" }),
  ];
  const supabase = makeSupabase(
    rows,
    {
      "user-hr": { email: "hr@example.com", language: "da" },
      "user-nr": { email: "nr@example.com", language: "da" },
    },
    { resultTeamIds: ["has-results"] }
  );
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailDay1Sweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });

  const byTeam = Object.fromEntries(sendCalls.map((c) => [c.teamId, c]));
  assert.equal(byTeam["has-results"].subject, "Dag 1: dine ryttere har allerede kørt");
  assert.equal(byTeam["no-results"].subject, "Dag 1: dit første løb er på kalenderen");
});

test("any users.language other than 'da' (including missing) renders the English day1 copy", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const inWindow = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = [mk("t1", { created_at: inWindow, user_id: "user-42" })];
  const supabase = makeSupabase(rows, { "user-42": { email: "player@example.com" } }, { resultTeamIds: ["t1"] });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailDay1Sweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(sendCalls[0].subject, "Day 1: your riders have already raced");
});

test("is a no-op when the flag is not active", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const supabase = makeSupabase([{ id: "should-not-be-queried" }]);
  const send = async () => { throw new Error("send must not be called when flag is inactive"); };

  const result = await runEmailDay1Sweep({ supabase, now, isActive: async () => false, send });
  assert.deepEqual(result, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
});

test("per-team failures are isolated", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const inWindow = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = [mk("a", { created_at: inWindow }), mk("b", { created_at: inWindow })];
  const supabase = makeSupabase(rows, { "user-a": "a@example.com", "user-b": "b@example.com" });
  const send = async (args) => {
    if (args.teamId === "a") throw new Error("resend down");
    return { status: "dry_run" };
  };

  const result = await runEmailDay1Sweep({
    supabase, now, isActive: async () => true, send, unsubSecret: "test-secret", captureExceptionFn: () => {},
  });

  assert.equal(result.candidates, 2);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
});

test("a failed race_results lookup for one team is isolated (per-team try/catch), other teams still get sent", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const inWindow = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = [mk("a", { created_at: inWindow }), mk("b", { created_at: inWindow })];
  const supabase = makeSupabase(
    rows,
    { "user-a": "a@example.com", "user-b": "b@example.com" },
    { resultsErrorForTeamIds: ["a"] }
  );
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };
  const capturedErrors = [];

  const result = await runEmailDay1Sweep({
    supabase, now, isActive: async () => true, send, unsubSecret: "test-secret",
    captureExceptionFn: (err, ctx) => capturedErrors.push({ err, ctx }),
  });

  assert.equal(result.candidates, 2);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(sendCalls.map((c) => c.teamId), ["b"]);
  assert.equal(capturedErrors.length, 1);
  assert.match(capturedErrors[0].err.message, /race_results lookup/);
});

test("skips (does not throw) a team whose user has no email on file", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const inWindow = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const rows = [mk("no-email", { created_at: inWindow })];
  const supabase = makeSupabase(rows, {}); // no email registered
  const send = async () => { throw new Error("send must not be called without an email"); };

  const result = await runEmailDay1Sweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });
  assert.equal(result.candidates, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
});

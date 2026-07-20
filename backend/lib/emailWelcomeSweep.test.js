import test from "node:test";
import assert from "node:assert/strict";
import { runEmailWelcomeSweep, WELCOME_WINDOW_MS } from "./emailWelcomeSweep.js";

// Mocks the two tables the sweep touches:
//   teams: select("id, name, user_id, created_at").eq(is_ai/is_bank/is_frozen/
//          is_test_account, false).gte("created_at", cutoff).not("user_id","is",null)
//   users: select("email").eq("id", userId).maybeSingle()
function makeSupabase(teamRows, userEmails = {}) {
  return {
    from(table) {
      if (table === "teams") {
        const eqFilters = [];
        let gteFilter = null;
        let notNullCol = null;
        const b = {
          select() { return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          gte(col, val) { gteFilter = [col, val]; return b; },
          not(col, op, val) { if (op === "is" && val === null) notNullCol = col; return b; },
          order() { return b; },
          range() {
            let out = [...teamRows];
            for (const [col, val] of eqFilters) out = out.filter((r) => (r[col] ?? false) === val);
            if (gteFilter) out = out.filter((r) => r[gteFilter[0]] >= gteFilter[1]);
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
          maybeSingle: async () => ({ data: userEmails[userId] ? { email: userEmails[userId] } : null, error: null }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const mk = (id, extra) => ({
  id, name: `Team ${id}`, user_id: `user-${id}`, created_at: extra?.created_at,
  is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, ...extra,
});

test("targets only teams created within the last 48h", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const fresh = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
  const stale = new Date(now.getTime() - WELCOME_WINDOW_MS - 60 * 60 * 1000).toISOString(); // 49h ago
  const rows = [mk("fresh", { created_at: fresh }), mk("stale", { created_at: stale })];
  const supabase = makeSupabase(rows, { "user-fresh": "fresh@example.com", "user-stale": "stale@example.com" });

  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const result = await runEmailWelcomeSweep({
    supabase, now, isActive: async () => true, send, unsubSecret: "test-secret",
  });

  assert.deepEqual(sendCalls.map((c) => c.teamId), ["fresh"]);
  assert.equal(result.candidates, 1);
  assert.equal(result.sent, 1);
});

test("excludes AI/bank/frozen/test-account teams (human-team filter discipline)", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [
    mk("human", { created_at: recent }),
    mk("ai", { created_at: recent, is_ai: true }),
    mk("bank", { created_at: recent, is_bank: true }),
    mk("frozen", { created_at: recent, is_frozen: true }),
    mk("test", { created_at: recent, is_test_account: true }),
  ];
  const supabase = makeSupabase(rows, { "user-human": "human@example.com" });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const result = await runEmailWelcomeSweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.deepEqual(sendCalls.map((c) => c.teamId), ["human"]);
  assert.equal(result.candidates, 1);
});

test("dedupeKey is deterministic (welcome:<userId>) so sendLoopEmail's own dedupe check is the guard", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [mk("t1", { created_at: recent, user_id: "user-42" })];
  const supabase = makeSupabase(rows, { "user-42": "player@example.com" });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailWelcomeSweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });

  assert.equal(sendCalls[0].dedupeKey, "welcome:user-42");
  assert.equal(sendCalls[0].type, "welcome");
  assert.equal(sendCalls[0].to, "player@example.com");
});

test("is a no-op (0 db work signaled via candidates=0) when the flag is not active", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const supabase = makeSupabase([{ id: "should-not-be-queried" }]);
  const send = async () => { throw new Error("send must not be called when flag is inactive"); };

  const result = await runEmailWelcomeSweep({ supabase, now, isActive: async () => false, send });
  assert.deepEqual(result, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
});

test("per-team failures are isolated (one throws, the rest still send)", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [mk("a", { created_at: recent }), mk("b", { created_at: recent })];
  const supabase = makeSupabase(rows, { "user-a": "a@example.com", "user-b": "b@example.com" });
  const send = async (args) => {
    if (args.teamId === "a") throw new Error("resend down");
    return { status: "dry_run" };
  };

  const result = await runEmailWelcomeSweep({
    supabase, now, isActive: async () => true, send, unsubSecret: "test-secret", captureExceptionFn: () => {},
  });

  assert.equal(result.candidates, 2);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
});

test("skips (does not throw) a team whose user has no email on file", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [mk("no-email", { created_at: recent })];
  const supabase = makeSupabase(rows, {}); // no email registered
  const send = async () => { throw new Error("send must not be called without an email"); };

  const result = await runEmailWelcomeSweep({ supabase, now, isActive: async () => true, send, unsubSecret: "test-secret" });
  assert.equal(result.candidates, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
});

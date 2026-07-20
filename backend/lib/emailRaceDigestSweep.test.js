import test from "node:test";
import assert from "node:assert/strict";
import { runEmailRaceDigestSweep, DIGEST_HOUR_COPENHAGEN } from "./emailRaceDigestSweep.js";
import { copenhagenHour, copenhagenMidnightUTC } from "./copenhagenTime.js";

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
          in: async (_col, ids) => ({ data: userRows.filter((u) => ids.includes(u.id)), error: null }),
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

test("outside the 19:00-19:59 Copenhagen hour, the sweep does no DB work at all", async () => {
  assert.notEqual(copenhagenHour(OUT_OF_WINDOW_NOW), DIGEST_HOUR_COPENHAGEN);
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

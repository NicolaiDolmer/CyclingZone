import test from "node:test";
import assert from "node:assert/strict";
import {
  runEmailRaceDigestSweep,
  DIGEST_HOUR_COPENHAGEN,
  DIGEST_ABSENCE_WINDOW_MS,
  DIGEST_MAX_PER_ABSENCE,
} from "./emailRaceDigestSweep.js";
import { copenhagenHour, copenhagenIsoWeekString } from "./copenhagenTime.js";

// July -> CEST (UTC+2). 17:15 UTC = 19:15 Copenhagen (inside the digest hour);
// 16:15 UTC = 18:15 Copenhagen (outside it). Asserted via copenhagenHour
// itself rather than hardcoded, so the test fails loudly if the fixture ever
// drifts off a DST boundary instead of silently testing the wrong hour.
const IN_WINDOW_NOW = new Date("2026-07-20T17:15:00Z");
const OUT_OF_WINDOW_NOW = new Date("2026-07-20T16:15:00Z");

// Well inside DIGEST_ABSENCE_WINDOW_MS (3 days) before IN_WINDOW_NOW -- the
// default last_seen for a fixture user that should count as absent, unless a
// test overrides it to probe the boundary or the "still active" case.
const ABSENT_LAST_SEEN = new Date(IN_WINDOW_NOW.getTime() - DIGEST_ABSENCE_WINDOW_MS - 24 * 60 * 60 * 1000).toISOString();

function makeSupabase({ teamRows = [], userRows = [], emailLogRows = [], raceResultsByTeam = {} } = {}) {
  return {
    from(table) {
      if (table === "teams") {
        const eqFilters = [];
        let notNullCol = null;
        const b = {
          select() { return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          not(col, op, val) { if (op === "is" && val === null) notNullCol = col; return b; },
          order() { return b; },
          range() {
            let out = [...teamRows];
            for (const [col, val] of eqFilters) out = out.filter((r) => (r[col] ?? false) === val);
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
      if (table === "email_log") {
        let typeFilter = null;
        let idsFilter = [];
        const b = {
          select() { return b; },
          eq(col, val) { if (col === "email_type") typeFilter = val; return b; },
          in(_col, ids) { idsFilter = ids; return b; },
          order() { return b; },
          range() {
            let out = emailLogRows.filter((r) => idsFilter.includes(r.user_id));
            if (typeFilter) out = out.filter((r) => r.email_type === typeFilter);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "race_results") {
        let teamId = null;
        let sinceFilter = null;
        let notNullCol = null;
        const b = {
          select() { return b; },
          eq(col, val) { if (col === "team_id") teamId = val; return b; },
          gte(col, val) { if (col === "imported_at") sinceFilter = val; return b; },
          not(col, op, val) { if (op === "is" && val === null) notNullCol = col; return b; },
          order() { return b; },
          range() {
            let out = raceResultsByTeam[teamId] || [];
            if (sinceFilter) out = out.filter((r) => r.imported_at >= sinceFilter);
            if (notNullCol) out = out.filter((r) => r[notNullCol] != null);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const team = (id, extra) => ({
  id, name: `Team ${id}`, user_id: `user-${id}`,
  is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, ...extra,
});

const user = (id, extra) => ({ id, email: `${id}@example.com`, last_seen: ABSENT_LAST_SEEN, email_prefs: {}, ...extra });

const result = ({ raceId, raceName, rank, riderName, importedAt }) => ({
  rank, rider_name: riderName, race_id: raceId, race: { id: raceId, name: raceName }, imported_at: importedAt,
});

// ─── hour gate (unchanged from before #4650) ───────────────────────────────

test("efter kl. 19 samme dag (deploy-restart catch-up) koerer sweepen stadig (#3475-klassen)", async () => {
  const CATCHUP_NOW = new Date("2026-07-20T18:15:00Z"); // 20:15 Copenhagen
  assert.ok(copenhagenHour(CATCHUP_NOW) > DIGEST_HOUR_COPENHAGEN);
  const supabase = makeSupabase({});
  const result = await runEmailRaceDigestSweep({ supabase, now: CATCHUP_NOW, isActive: async () => true });
  assert.notEqual(result.skippedReason, "outside_hour_window");
});

test("outside the 19:00-19:59 Copenhagen hour, the sweep does no DB work at all", async () => {
  assert.ok(copenhagenHour(OUT_OF_WINDOW_NOW) < DIGEST_HOUR_COPENHAGEN);
  const supabase = { from() { throw new Error("must not query any table outside the digest hour"); } };
  const res = await runEmailRaceDigestSweep({
    supabase, now: OUT_OF_WINDOW_NOW, isActive: async () => true,
    send: async () => { throw new Error("must not send"); },
  });
  assert.equal(res.skippedReason, "outside_hour_window");
  assert.equal(res.sent, 0);
});

test("inside the digest hour but flag inactive: no-op, no team/user query", async () => {
  assert.equal(copenhagenHour(IN_WINDOW_NOW), DIGEST_HOUR_COPENHAGEN);
  const supabase = { from() { throw new Error("must not query any table when the flag is inactive"); } };
  const res = await runEmailRaceDigestSweep({
    supabase, now: IN_WINDOW_NOW, isActive: async () => false,
    send: async () => { throw new Error("must not send"); },
  });
  assert.deepEqual(res, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
});

// ─── human-team filter (unchanged) ──────────────────────────────────────────

test("excludes AI/bank/frozen/test-account teams from the digest", async () => {
  const teamRows = [
    team("t-human", {}),
    team("t-ai", { is_ai: true }),
    team("t-bank", { is_bank: true }),
    team("t-frozen", { is_frozen: true }),
    team("t-test", { is_test_account: true }),
  ];
  const userRows = teamRows.map((t) => user(t.user_id));
  const raceResultsByTeam = Object.fromEntries(
    teamRows.map((t) => [t.id, [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "Rider", importedAt: "2026-07-19T10:00:00Z" })]])
  );
  const supabase = makeSupabase({ teamRows, userRows, raceResultsByTeam });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const res = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(res.candidates, 1);
  assert.deepEqual(sendCalls.map((c) => c.userId), ["user-t-human"]);
});

// ─── #4650 · 3-day absence window (opposite direction from the pre-#4650 rule) ─

test("a manager seen within the last 3 days is never sent to (still active, not absent)", async () => {
  const activeLastSeen = new Date(IN_WINDOW_NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
  const teamRows = [team("t1")];
  const userRows = [user("user-t1", { last_seen: activeLastSeen })];
  const raceResultsByTeam = { t1: [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "R", importedAt: "2026-07-19T10:00:00Z" })] };
  const supabase = makeSupabase({ teamRows, userRows, raceResultsByTeam });
  const send = async () => { throw new Error("must not send to a still-active manager"); };

  const res = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(res.candidates, 0);
  assert.equal(res.sent, 0);
});

test("a manager seen EXACTLY 3 days ago is not yet absent (< cutoff, not <=)", async () => {
  const boundaryLastSeen = new Date(IN_WINDOW_NOW.getTime() - DIGEST_ABSENCE_WINDOW_MS).toISOString();
  const teamRows = [team("t1")];
  const userRows = [user("user-t1", { last_seen: boundaryLastSeen })];
  const supabase = makeSupabase({ teamRows, userRows });
  const send = async () => { throw new Error("must not send at the exact boundary"); };

  const res = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(res.candidates, 0);
});

test("a manager seen just over 3 days ago IS absent and is considered", async () => {
  const justOver = new Date(IN_WINDOW_NOW.getTime() - DIGEST_ABSENCE_WINDOW_MS - 60 * 1000).toISOString();
  const teamRows = [team("t1")];
  const userRows = [user("user-t1", { last_seen: justOver })];
  const raceResultsByTeam = { t1: [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "R", importedAt: "2026-07-19T10:00:00Z" })] };
  const supabase = makeSupabase({ teamRows, userRows, raceResultsByTeam });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const res = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(res.candidates, 1);
  assert.equal(sendCalls.length, 1);
});

test("a manager with no last_seen at all is excluded, never treated as absent", async () => {
  const teamRows = [team("t1")];
  const userRows = [user("user-t1", { last_seen: null })];
  const supabase = makeSupabase({ teamRows, userRows });
  const send = async () => { throw new Error("must not send without a last_seen timestamp"); };

  const res = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(res.candidates, 0);
});

test("email_prefs race_digest=false (or all=false) is excluded even though absent", async () => {
  const teamRows = [team("t-off"), team("t-all-off"), team("t-in")];
  const userRows = [
    user("user-t-off", { email_prefs: { race_digest: false } }),
    user("user-t-all-off", { email_prefs: { all: false } }),
    user("user-t-in", {}),
  ];
  const raceResultsByTeam = { "t-in": [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "R", importedAt: "2026-07-19T10:00:00Z" })] };
  const supabase = makeSupabase({ teamRows, userRows, raceResultsByTeam });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const res = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(res.candidates, 1, "only the opted-in absentee counts as a candidate");
  assert.deepEqual(sendCalls.map((c) => c.userId), ["user-t-in"]);
});

// ─── #4650 · at most 1 per ISO week (dedupe key) ───────────────────────────

test("dedupeKey embeds the Copenhagen ISO week, not a calendar date", async () => {
  const teamRows = [team("t1")];
  const userRows = [user("user-t1")];
  const raceResultsByTeam = { t1: [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "R", importedAt: "2026-07-19T10:00:00Z" })] };
  const supabase = makeSupabase({ teamRows, userRows, raceResultsByTeam });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(sendCalls[0].dedupeKey, `digest:user-t1:${copenhagenIsoWeekString(IN_WINDOW_NOW)}`);
  assert.equal(sendCalls[0].type, "race_digest");
});

// ─── #4650 · at most 2 per absence period ──────────────────────────────────

test("a manager already sent 2 digests since their current last_seen is skipped (cap reached)", async () => {
  const teamRows = [team("t1")];
  const userRows = [user("user-t1")];
  const emailLogRows = [
    { user_id: "user-t1", email_type: "race_digest", created_at: new Date(new Date(ABSENT_LAST_SEEN).getTime() + 60 * 60 * 1000).toISOString() },
    { user_id: "user-t1", email_type: "race_digest", created_at: new Date(new Date(ABSENT_LAST_SEEN).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() },
  ];
  const raceResultsByTeam = { t1: [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "R", importedAt: "2026-07-19T10:00:00Z" })] };
  const supabase = makeSupabase({ teamRows, userRows, emailLogRows, raceResultsByTeam });
  const send = async () => { throw new Error("must not send a 3rd digest for the same absence period"); };

  const res = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(res.candidates, 1);
  assert.equal(res.sent, 0);
  assert.equal(res.skipped, 1);
  assert.equal(DIGEST_MAX_PER_ABSENCE, 2);
});

test("a manager with only 1 prior digest this absence period can still receive a 2nd", async () => {
  const teamRows = [team("t1")];
  const userRows = [user("user-t1")];
  const emailLogRows = [
    { user_id: "user-t1", email_type: "race_digest", created_at: new Date(new Date(ABSENT_LAST_SEEN).getTime() + 60 * 60 * 1000).toISOString() },
  ];
  const raceResultsByTeam = { t1: [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "R", importedAt: "2026-07-19T10:00:00Z" })] };
  const supabase = makeSupabase({ teamRows, userRows, emailLogRows, raceResultsByTeam });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const res = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(res.sent, 1);
  assert.equal(sendCalls.length, 1);
});

test("digests sent BEFORE the player's most recent visit don't count toward the cap (a fresh absence period resets it)", async () => {
  // The player came back (last_seen is now recent-ish, but still >3 days old
  // relative to IN_WINDOW_NOW) AFTER those 2 old digests were sent -- a new
  // absence period has started since, so the 2-per-absence cap must not see
  // rows from the PREVIOUS period.
  const priorLastSeen = new Date(new Date(ABSENT_LAST_SEEN).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const currentLastSeen = ABSENT_LAST_SEEN; // player returned since, then went absent again
  const teamRows = [team("t1")];
  const userRows = [user("user-t1", { last_seen: currentLastSeen })];
  const emailLogRows = [
    { user_id: "user-t1", email_type: "race_digest", created_at: new Date(new Date(priorLastSeen).getTime() + 60 * 60 * 1000).toISOString() },
    { user_id: "user-t1", email_type: "race_digest", created_at: new Date(new Date(priorLastSeen).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() },
  ];
  const raceResultsByTeam = { t1: [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "R", importedAt: "2026-07-19T10:00:00Z" })] };
  const supabase = makeSupabase({ teamRows, userRows, emailLogRows, raceResultsByTeam });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const res = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(res.sent, 1, "the 2 old digests belong to a prior absence period the player already returned from");
  assert.equal(sendCalls.length, 1);
});

// ─── #4650 · only results since the player's last visit ───────────────────

test("only includes race_results imported at or after the player's last_seen, never earlier ones", async () => {
  const teamRows = [team("t1")];
  const userRows = [user("user-t1")];
  const beforeLastSeen = new Date(new Date(ABSENT_LAST_SEEN).getTime() - 60 * 60 * 1000).toISOString();
  const afterLastSeen = new Date(new Date(ABSENT_LAST_SEEN).getTime() + 60 * 60 * 1000).toISOString();
  const raceResultsByTeam = {
    t1: [
      result({ raceId: "r-old", raceName: "Old Race", rank: 1, riderName: "Old Rider", importedAt: beforeLastSeen }),
      result({ raceId: "r-new", raceName: "New Race", rank: 1, riderName: "New Rider", importedAt: afterLastSeen }),
    ],
  };
  const supabase = makeSupabase({ teamRows, userRows, raceResultsByTeam });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.ok(sendCalls[0].html.includes("New Rider"));
  assert.ok(!sendCalls[0].html.includes("Old Rider"), "a result from before the player's last visit must never appear");
});

test("no results since the player's last visit: no email sent at all (never an empty digest)", async () => {
  const teamRows = [team("t1")];
  const userRows = [user("user-t1")];
  const supabase = makeSupabase({ teamRows, userRows, raceResultsByTeam: {} });
  const send = async () => { throw new Error("must not send an empty come-back digest"); };

  const res = await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(res.candidates, 1);
  assert.equal(res.sent, 0);
  assert.equal(res.skipped, 1);
});

test("picks the best (lowest) rank per race, never invents data", async () => {
  const teamRows = [team("t1")];
  const userRows = [user("user-t1")];
  const raceResultsByTeam = {
    t1: [
      result({ raceId: "race-1", raceName: "Race One", rank: 5, riderName: "Rider A", importedAt: "2026-07-19T10:00:00Z" }),
      result({ raceId: "race-1", raceName: "Race One", rank: 2, riderName: "Rider B", importedAt: "2026-07-19T11:00:00Z" }),
      result({ raceId: "race-2", raceName: "Race Two", rank: 10, riderName: "Rider C", importedAt: "2026-07-19T12:00:00Z" }),
    ],
  };
  const supabase = makeSupabase({ teamRows, userRows, raceResultsByTeam });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.ok(sendCalls[0].html.includes("Rider B"), "keeps the best (rank 2) result for race-1");
  assert.ok(!sendCalls[0].html.includes("Rider A"), "drops the worse (rank 5) duplicate for the same race");
  assert.ok(sendCalls[0].html.includes("Rider C"), "keeps the single result for race-2");
});

test("subject and body carry the manager's real team name", async () => {
  const teamRows = [team("t1", { name: "Team Velodrome" })];
  const userRows = [user("user-t1")];
  const raceResultsByTeam = { t1: [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "R", importedAt: "2026-07-19T10:00:00Z" })] };
  const supabase = makeSupabase({ teamRows, userRows, raceResultsByTeam });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailRaceDigestSweep({ supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s" });

  assert.equal(sendCalls[0].subject, "Team Velodrome raced while you were away");
});

test("per-manager failures are isolated", async () => {
  const teamRows = [team("t1"), team("t2")];
  const userRows = [user("user-t1"), user("user-t2")];
  const raceResultsByTeam = {
    t1: [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "R1", importedAt: "2026-07-19T10:00:00Z" })],
    t2: [result({ raceId: "r1", raceName: "Race", rank: 1, riderName: "R2", importedAt: "2026-07-19T10:00:00Z" })],
  };
  const supabase = makeSupabase({ teamRows, userRows, raceResultsByTeam });
  const send = async (args) => {
    if (args.userId === "user-t1") throw new Error("resend down");
    return { status: "dry_run" };
  };

  const res = await runEmailRaceDigestSweep({
    supabase, now: IN_WINDOW_NOW, isActive: async () => true, send, unsubSecret: "s", captureExceptionFn: () => {},
  });

  assert.equal(res.candidates, 2);
  assert.equal(res.sent, 1);
  assert.equal(res.failed, 1);
});

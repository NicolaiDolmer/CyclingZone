// #5864 · tests for enforce5864ExpiredContracts.mjs (rene funktioner + apply med fake supabase).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseArgs,
  isInScopeTeam,
  outOfScopeReason,
  rosterBucket,
  captainRefsFor,
  buildPlan,
  buildSnapshotSql,
  buildRestoreSql,
  renderPublicSummary,
  renderPrivateReport,
  makeScopedFetcher,
  runApply,
  writePrivateArtifacts,
  OWNER_GO_FLAG,
  BACKUP_RIDERS_TABLE,
} from "./enforce5864ExpiredContracts.mjs";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const humanTeam = (id, extra = {}) => ({
  id, name: `Team ${id}`, user_id: `u-${id}`, is_ai: false, is_frozen: false, is_bank: false, is_test_account: false,
  division: 3, parked_at: null, retired_at: null, ...extra,
});
const rider = (n, team, extra = {}) => ({
  id: uuid(n), firstname: "F", lastname: `L${n}`, team_id: team.id, team, squad: "u23", is_academy: true,
  contract_end_season: 3, salary: 10, ...extra,
});

test("parseArgs: dry-run is the default", () => {
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: false, expectCount: null });
});

test("parseArgs: apply requires the exact owner-go token and expect-count", () => {
  assert.throws(() => parseArgs(["--apply"]), /owner-go/);
  assert.throws(() => parseArgs(["--apply", "--owner-go=yes"]), /Wrong owner-go/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG]), /expect-count/);
  assert.throws(() => parseArgs([OWNER_GO_FLAG]), /only makes sense/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG, "--expect-count=x"]), /non-negative/);
  assert.throws(() => parseArgs(["--live"]), /Unknown option/);
  assert.deepEqual(parseArgs(["--apply", OWNER_GO_FLAG, "--expect-count=3"]), { apply: true, ownerGo: true, expectCount: 3 });
});

test("scope mirrors the normal expiry path's ownership filter, human teams only", () => {
  assert.equal(isInScopeTeam(humanTeam("a")), true);
  assert.equal(isInScopeTeam(humanTeam("a", { parked_at: "2026-09-01" })), true, "parked teams are not filtered by the normal path");
  assert.equal(outOfScopeReason(humanTeam("a", { is_frozen: true })), "frozen");
  assert.equal(outOfScopeReason(humanTeam("a", { is_test_account: true })), "test_account");
  assert.equal(outOfScopeReason(humanTeam("a", { is_bank: true })), "bank");
  assert.equal(outOfScopeReason(humanTeam("a", { is_ai: true })), "ai_team");
  assert.equal(outOfScopeReason(null), "no_team");
});

test("rosterBucket uses squad first, academy without youth squad is flagged", () => {
  assert.equal(rosterBucket({ squad: "junior", is_academy: true }), "junior");
  assert.equal(rosterBucket({ squad: "senior", is_academy: true }), "youth_unknown");
  assert.equal(rosterBucket({ squad: "senior", is_academy: false }), "senior");
});

test("captainRefsFor finds a_chain and terrain captain priorities", () => {
  const s = { a_chain: [uuid(1)], captain_priorities: { flat: [uuid(2), uuid(1)], mountain: [uuid(3)] } };
  assert.deepEqual(captainRefsFor(uuid(1), s), ["a_chain", "captain_priorities.flat"]);
  assert.deepEqual(captainRefsFor(uuid(9), s), []);
  assert.deepEqual(captainRefsFor(uuid(1), null), []);
});

function fixture() {
  const a = humanTeam("A");
  const b = humanTeam("B", { parked_at: "2026-09-20" });
  const frozen = humanTeam("F", { is_frozen: true });
  const candidates = [
    rider(1, a), rider(2, a), rider(3, a, { squad: "junior" }),
    rider(4, a, { squad: "senior", is_academy: false, contract_end_season: 2 }),
    rider(5, b),
    rider(6, frozen),
  ];
  // Hold A: 6 u23 i alt (2 udløbne), 1 junior (udløbet), 10 senior (1 udløbet).
  const roster = [
    ...[1, 2, 10, 11, 12, 13].map((n) => ({ id: uuid(n), team_id: "A", squad: "u23", is_academy: true })),
    { id: uuid(3), team_id: "A", squad: "junior", is_academy: true },
    ...[4, 20, 21, 22, 23, 24, 25, 26, 27, 28].map((n) => ({ id: uuid(n), team_id: "A", squad: "senior", is_academy: false })),
    { id: uuid(5), team_id: "B", squad: "u23", is_academy: true },
  ];
  return {
    candidates, roster,
    racingIds: new Set([uuid(2)]),
    strategies: new Map([["A", { a_chain: [uuid(4)], captain_priorities: {} }]]),
    futureEntries: [{ rider_id: uuid(1), race_role: "captain" }, { rider_id: uuid(1), race_role: "helper" }],
    openListings: [{ rider_id: uuid(4) }],
    threshold: 3,
  };
}

test("buildPlan: out-of-scope teams are listed, not touched", () => {
  const plan = buildPlan(fixture());
  assert.equal(plan.totals.candidatesAllHumanTeams, 6);
  assert.equal(plan.totals.outOfScope, 1);
  assert.deepEqual(plan.totals.outOfScopeByReason, { frozen: 1 });
  assert.equal(plan.rows.some((r) => r.riderId === uuid(6)), false);
});

test("buildPlan: a rider in an active stage race is deferred, never released", () => {
  const plan = buildPlan(fixture());
  const r2 = plan.rows.find((r) => r.riderId === uuid(2));
  assert.equal(r2.outcome, "deferred_active_stage_race");
  assert.equal(r2.youthNormalize, false);
  assert.equal(plan.totals.release, 4);
  assert.equal(plan.totals.deferredActiveStageRace, 1);
});

test("buildPlan: youth squad dropping under the start minimum is flagged per team", () => {
  const plan = buildPlan(fixture());
  const a = plan.teams.find((t) => t.teamId === "A");
  // u23: 6 → 5 (rytter 2 udskudt, kun rytter 1 frigives) → under MIN_RACE_ENTRIES (6)
  assert.deepEqual(a.squads.u23, { before: 6, after: 5, min: 6, startableBefore: true, startableAfter: false });
  // senior: 10 → 9, div 3 min 8 → stadig startbar
  assert.equal(a.squads.senior.startableAfter, true);
  assert.deepEqual(a.lostStart, ["u23"]);
  assert.equal(plan.totals.activeTeamsLosingStart, 1);
  const b = plan.teams.find((t) => t.teamId === "B");
  assert.equal(b.parked, true);
  assert.equal(plan.totals.teamsParked, 1);
});

test("buildPlan: captains, future entries and listings are counted", () => {
  const plan = buildPlan(fixture());
  const r1 = plan.rows.find((r) => r.riderId === uuid(1));
  assert.equal(r1.futureEntries, 2);
  assert.equal(r1.futureCaptainEntries, 1);
  const r4 = plan.rows.find((r) => r.riderId === uuid(4));
  assert.deepEqual(r4.captainRefs, ["a_chain"]);
  assert.equal(r4.openListings, 1);
  assert.equal(r4.youthNormalize, false, "seniors are not normalized");
  assert.equal(plan.totals.youthNormalize, 3);
});

test("snapshot SQL is idempotent and covers riders, entries and listings", () => {
  const sql = buildSnapshotSql([uuid(1), uuid(2)]);
  assert.match(sql, /create table if not exists public\.backup_5864_riders/);
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /backup_5864_race_entries/);
  assert.match(sql, /backup_5864_transfer_listings/);
  assert.match(sql, /enable row level security/);
  assert.ok(sql.includes(`'${uuid(2)}'`));
  assert.throws(() => buildSnapshotSql(["x'; drop table riders; --"]), /Unexpected rider id/);
  assert.match(buildSnapshotSql([]), /ingen kandidater/);
});

test("restore SQL only restores riders that are still free agents", () => {
  const sql = buildRestoreSql();
  assert.match(sql, /r\.team_id is null and b\.team_id is not null/);
  assert.match(sql, /insert into public\.race_entries/);
});

test("public summary contains no rider ids or team names; private report does", () => {
  const plan = buildPlan(fixture());
  const pub = renderPublicSummary(plan);
  assert.equal(pub.includes(uuid(1)), false);
  assert.equal(pub.includes("Team A"), false);
  const priv = renderPrivateReport(plan, { generatedAt: "2026-10-05T10:00:00Z", activeSeason: 4 });
  assert.ok(priv.includes(uuid(1)));
  assert.ok(priv.includes("Team A"));
  assert.ok(priv.includes("UDSKUDT"));
  assert.equal((priv + pub).includes(String.fromCharCode(0x2014)), false, "no em-dash");
});

test("writePrivateArtifacts writes report, json, snapshot and restore", () => {
  const dir = mkdtempSync(join(tmpdir(), "cz5864-"));
  try {
    const plan = buildPlan(fixture());
    const files = writePrivateArtifacts(plan, { activeSeason: 4, generatedAt: "2026-10-05T10:00:00.000Z", dir });
    assert.ok(readFileSync(files.report, "utf8").includes("#5864"));
    assert.equal(JSON.parse(readFileSync(files.json, "utf8")).totals.inScope, 5);
    assert.ok(readFileSync(files.snapshot, "utf8").includes(uuid(5)));
    assert.ok(readFileSync(files.restore, "utf8").includes("restore"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("makeScopedFetcher limits to in-scope teams and the approved list", async () => {
  const f = fixture();
  const fetchCandidates = async () => f.candidates;
  const fetcher = makeScopedFetcher(3, [uuid(1), uuid(6)], fetchCandidates);
  const rows = await fetcher({ supabase: {} });
  assert.deepEqual(rows.map((r) => r.id), [uuid(1)]);
});

// Minimal fake: understøtter backup-tabel-select og riders-update-kæden.
function fakeSupabase({ backupIds = [], releasedIds = new Set() } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, filters: [], patch: null };
      const q = {
        select() { return q; },
        in(col, vals) { state.filters.push(["in", col, vals]); return q; },
        is(col, v) { state.filters.push(["is", col, v]); return q; },
        eq(col, v) { state.filters.push(["eq", col, v]); return q; },
        update(p) { state.patch = p; return q; },
        order() { return q; },
        range() { return q; },
        then(resolve) {
          calls.push(state);
          if (state.table === BACKUP_RIDERS_TABLE) {
            const ids = state.filters.find((x) => x[0] === "in")[2];
            return resolve({ data: ids.filter((id) => backupIds.includes(id)).map((id) => ({ id })), error: null });
          }
          if (state.table === "riders" && state.patch) {
            const ids = state.filters.find((x) => x[0] === "in")[2];
            return resolve({ data: ids.filter((id) => releasedIds.has(id)).map((id) => ({ id })), error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
  };
}

test("runApply refuses without owner-go and when the live list differs", async () => {
  const plan = buildPlan(fixture());
  const releaseFn = async () => { throw new Error("must not be called"); };
  await assert.rejects(runApply({ supabase: fakeSupabase(), plan, threshold: 3, releaseFn, ownerGo: false, expectCount: 5 }), /owner-go/);
  await assert.rejects(runApply({ supabase: fakeSupabase(), plan, threshold: 3, releaseFn, ownerGo: true, expectCount: 4 }), /Nothing was written/);
});

test("runApply aborts before any write when the snapshot does not cover every rider", async () => {
  const plan = buildPlan(fixture());
  let released = false;
  const releaseFn = async () => { released = true; return {}; };
  const supabase = fakeSupabase({ backupIds: [uuid(1)] });
  await assert.rejects(runApply({ supabase, plan, threshold: 3, releaseFn, ownerGo: true, expectCount: 5 }), /Snapshot missing 4 of 5/);
  assert.equal(released, false);
  assert.equal(supabase.calls.some((c) => c.patch), false);
});

test("runApply reuses the normal release path with the scoped fetcher, then normalizes released academy riders", async () => {
  const f = fixture();
  const plan = buildPlan(f);
  const ids = plan.rows.map((r) => r.riderId);
  let receivedArgs;
  const releaseFn = async (args) => {
    receivedArgs = args;
    const rows = await args.fetchExpiredContractRiders({ supabase: args.supabase, seasonNumber: args.seasonNumber });
    return { candidates: rows.length, released: rows.length - 1 };
  };
  const supabase = fakeSupabase({ backupIds: ids, releasedIds: new Set([uuid(1), uuid(3), uuid(5)]) });
  const result = await runApply({
    supabase, plan, threshold: 3, releaseFn, ownerGo: true, expectCount: 5,
    fetchCandidates: async () => f.candidates,
  });
  assert.equal(receivedArgs.seasonNumber, 3);
  assert.equal(result.candidates, 5, "frozen-team rider excluded by the scoped fetcher");
  assert.equal(result.youthNormalized, 3);
  const update = supabase.calls.find((c) => c.patch);
  assert.deepEqual(update.patch, { is_academy: false });
  assert.ok(update.filters.some((x) => x[0] === "is" && x[1] === "team_id" && x[2] === null), "only riders that are free agents now");
  assert.ok(update.filters.some((x) => x[0] === "eq" && x[1] === "is_academy" && x[2] === true));
});

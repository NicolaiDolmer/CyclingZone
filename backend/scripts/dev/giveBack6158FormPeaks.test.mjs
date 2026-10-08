// #6158 · tests for giveBack6158FormPeaks.mjs (rene funktioner + I/O + apply med fake supabase).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseArgs,
  outOfScopeReason,
  firstStageAtByRace,
  targetStartedBeforeIgnition,
  countedAfterIgnition,
  buildPlan,
  giveBackIds,
  approvedListHash,
  buildSnapshotSql,
  buildRestoreSql,
  renderPublicSummary,
  renderPrivateReport,
  writePrivateArtifacts,
  loadPlan,
  fetchBackupIds,
  runApply,
  OWNER_GO_FLAG,
  BACKUP_TABLE,
} from "./giveBack6158FormPeaks.mjs";
import { RACE_V3_TUNING } from "../../lib/raceRoles.js";
import { MAX_PEAK_PLANS_PER_SEASON } from "../../lib/riderPeakPlans.js";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HASH = "a".repeat(64);
const IGNITION = "2026-10-12T08:00:00+02:00";

// ── Fixture ────────────────────────────────────────────────────────────────
// Sæson starter 28/9. Tænding 12/10 kl. 08 CEST.
//   p1  vindue startet 1/10, mål løb R1 (afsluttet før tænding)     → A+B
//   p2  vindue starter 20/10, mål R2 (etapeløb i gang ved tænding)  → kun B
//   p3  vindue startet 10/10, mål R3 (starter 14/10, efter tænding) → kun A
//   p4  vindue starter 20/10, mål R3                                → beholdes, virker
//   p5  vindue startet 11/10, mål R3, men har talt i løb R4 efter tænding → beholdes
//   p6  frosset hold                                                → uden for scope
//   p7  intet målløb                                                → uden målløb
//   p8  AI-hold                                                     → uden for scope
function fixture(extra = {}) {
  const season = { id: "S4", number: 4, start_date: "2026-09-28" };
  const teams = new Map([
    ["A", { id: "A", name: "Team A", is_ai: false, is_frozen: false, is_bank: false, is_test_account: false, parked_at: null }],
    ["B", { id: "B", name: "Team B", is_ai: false, is_frozen: false, is_bank: false, is_test_account: false, parked_at: "2026-10-01" }],
    ["F", { id: "F", name: "Team F", is_ai: false, is_frozen: true, is_bank: false, is_test_account: false, parked_at: null }],
    ["X", { id: "X", name: "AI X", is_ai: true, is_frozen: false, is_bank: false, is_test_account: false, parked_at: null }],
  ]);
  const riders = new Map([
    [uuid(1), { id: uuid(1), firstname: "F", lastname: "L1", team_id: "A", squad: "senior", is_academy: false, is_retired: false }],
    [uuid(2), { id: uuid(2), firstname: "F", lastname: "L2", team_id: "A", squad: "senior", is_academy: false, is_retired: false }],
    [uuid(3), { id: uuid(3), firstname: "F", lastname: "L3", team_id: "B", squad: "u23", is_academy: true, is_retired: false }],
    [uuid(5), { id: uuid(5), firstname: "F", lastname: "L5", team_id: "A", squad: "senior", is_academy: false, is_retired: false }],
    [uuid(6), { id: uuid(6), firstname: "F", lastname: "L6", team_id: "F", squad: "senior", is_academy: false, is_retired: false }],
    [uuid(8), { id: uuid(8), firstname: "F", lastname: "L8", team_id: "X", squad: "senior", is_academy: false, is_retired: false }],
  ]);
  const races = new Map([
    ["R1", { id: "R1", name: "Race 1", status: "completed", stages: 1, stages_completed: 1 }],
    ["R2", { id: "R2", name: "Race 2", status: "active", stages: 10, stages_completed: 3 }],
    ["R3", { id: "R3", name: "Race 3", status: "scheduled", stages: 1, stages_completed: 0 }],
  ]);
  const plan = (n, rider, target, start, end, locked = null) => ({
    id: uuid(100 + n), rider_id: rider, season_id: "S4", target_race_id: target, window_start: start, window_end: end, locked_at: locked,
  });
  const plans = [
    plan(1, uuid(1), "R1", "2026-10-01", "2026-10-05", "2026-10-02T10:00:00Z"),
    plan(2, uuid(1), "R2", "2026-10-20", "2026-10-24"),
    plan(3, uuid(2), "R3", "2026-10-10", "2026-10-14"),
    plan(4, uuid(3), "R3", "2026-10-20", "2026-10-24"),
    plan(5, uuid(5), "R3", "2026-10-11", "2026-10-15"),
    plan(6, uuid(6), "R1", "2026-10-01", "2026-10-05"),
    plan(7, uuid(2), null, "2026-10-01", "2026-10-05"),
    plan(8, uuid(8), "R1", "2026-10-01", "2026-10-05"),
  ];
  const firstStageMs = new Map([
    ["R1", Date.parse("2026-10-03T18:00:00+02:00")],
    ["R2", Date.parse("2026-10-09T18:00:00+02:00")],
    ["R3", Date.parse("2026-10-14T18:00:00+02:00")],
  ]);
  // Rytter 5 kørte en etape 13/10 i løbet R4, der startede efter tændingen.
  const dayOrd = (d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const postIgnitionStagesByRider = new Map([[uuid(5), [{ raceId: "R4", dayOrdinal: dayOrd("2026-10-13") }]]]);
  return {
    season, plans, ridersById: riders, teamsById: teams, racesById: races, firstStageMs, postIgnitionStagesByRider,
    ignitionAt: IGNITION, ...extra,
  };
}
const byPlan = (plan, n) => plan.rows.find((r) => r.planId === uuid(100 + n));

// ── Argumenter ─────────────────────────────────────────────────────────────

test("parseArgs: read-only dry-run is the default, ignition optional", () => {
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: false, approvedHash: null, ignition: null });
  assert.equal(parseArgs([`--ignition=${IGNITION}`]).ignition, new Date(Date.parse(IGNITION)).toISOString());
  assert.throws(() => parseArgs(["--ignition=tomorrow"]), /ISO timestamp/);
});

test("parseArgs: apply requires exact owner-go, list hash and explicit ignition", () => {
  assert.throws(() => parseArgs(["--apply"]), /owner-go/);
  assert.throws(() => parseArgs(["--apply", "--owner-go=yes"]), /Wrong owner-go/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG]), /approved-list/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG, `--approved-list=${HASH}`]), /explicit --ignition/);
  assert.throws(() => parseArgs([OWNER_GO_FLAG]), /only makes sense/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG, "--approved-list=123"]), /64-char/);
  assert.throws(() => parseArgs(["--live"]), /Unknown option/);
  const ok = parseArgs(["--apply", OWNER_GO_FLAG, `--approved-list=${HASH}`, `--ignition=${IGNITION}`]);
  assert.equal(ok.apply && ok.ownerGo, true);
  assert.equal(ok.approvedHash, HASH);
});

// ── Rene klassifikationer ──────────────────────────────────────────────────

test("outOfScopeReason mirrors the #5864 ownership filter plus retired riders", () => {
  const team = { is_ai: false, is_frozen: false, is_bank: false, is_test_account: false };
  assert.equal(outOfScopeReason({ is_retired: false }, team), null);
  assert.equal(outOfScopeReason(null, team), "rider_missing");
  assert.equal(outOfScopeReason({ is_retired: true }, team), "retired_rider");
  assert.equal(outOfScopeReason({ is_retired: false }, null), "no_team");
  assert.equal(outOfScopeReason({}, { ...team, is_ai: true }), "ai_team");
  assert.equal(outOfScopeReason({}, { ...team, is_bank: true }), "bank");
  assert.equal(outOfScopeReason({}, { ...team, is_test_account: true }), "test_account");
  assert.equal(outOfScopeReason({}, { ...team, is_frozen: true }), "frozen");
});

test("firstStageAtByRace takes the earliest valid stage time", () => {
  const m = firstStageAtByRace([
    { race_id: "R", scheduled_at: "2026-10-05T18:00:00Z" },
    { race_id: "R", scheduled_at: "2026-10-04T18:00:00Z" },
    { race_id: "R", scheduled_at: "garbage" },
    { race_id: null, scheduled_at: "2026-10-01T18:00:00Z" },
  ]);
  assert.equal(m.get("R"), Date.parse("2026-10-04T18:00:00Z"));
  assert.equal(m.size, 1);
});

test("targetStartedBeforeIgnition uses the schedule first, status only as fallback", () => {
  const ign = Date.parse(IGNITION);
  assert.equal(targetStartedBeforeIgnition({ status: "scheduled" }, ign - 1, ign), true);
  assert.equal(targetStartedBeforeIgnition({ status: "completed" }, ign, ign), false, "starting at ignition = new rules");
  assert.equal(targetStartedBeforeIgnition({ status: "active", stages_completed: 2 }, null, ign), true);
  assert.equal(targetStartedBeforeIgnition({ status: "scheduled", stages_completed: 0 }, null, ign), false);
  assert.equal(targetStartedBeforeIgnition(null, null, ign), true, "unknown race is treated as started (defensive)");
});

test("countedAfterIgnition: a stage inside the window counts, a stage in the dip only flags", () => {
  const dayOrd = (d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const plan = { window_start: "2026-10-12", window_end: "2026-10-14" };
  const inWindow = countedAfterIgnition(plan, [{ raceId: "R", dayOrdinal: dayOrd("2026-10-13") }]);
  assert.deepEqual(inWindow, { counted: true, countedRaceIds: ["R"], dipFelt: false });
  const inDip = countedAfterIgnition(plan, [{ raceId: "R", dayOrdinal: dayOrd("2026-10-15") }]);
  assert.deepEqual(inDip, { counted: false, countedRaceIds: [], dipFelt: true });
  const afterDip = countedAfterIgnition(plan, [{ raceId: "R", dayOrdinal: dayOrd("2026-10-14") + RACE_V3_TUNING.PEAK_PAYBACK_DAYS + 1 }]);
  assert.deepEqual(afterDip, { counted: false, countedRaceIds: [], dipFelt: false });
  assert.equal(countedAfterIgnition(plan, undefined).counted, false);
});

// ── buildPlan ──────────────────────────────────────────────────────────────

test("buildPlan: the two rules from spec §4 classify every in-scope plan", () => {
  const plan = buildPlan(fixture());
  assert.deepEqual(byPlan(plan, 1).rules, ["window_started", "target_started"]);
  assert.deepEqual(byPlan(plan, 2).rules, ["target_started"]);
  assert.deepEqual(byPlan(plan, 3).rules, ["window_started"]);
  assert.deepEqual(byPlan(plan, 4).rules, []);
  assert.equal(byPlan(plan, 4).outcome, "keep_will_work");
  assert.deepEqual(plan.totals.giveBackByRule, { window_started_only: 1, target_started_only: 1, both: 1 });
  assert.equal(plan.totals.giveBack, 3);
  assert.deepEqual(giveBackIds(plan).sort(), [uuid(101), uuid(102), uuid(103)]);
});

test("buildPlan: no peak is both counted in a race and given back", () => {
  const plan = buildPlan(fixture());
  const p5 = byPlan(plan, 5);
  assert.deepEqual(p5.rules, ["window_started"], "rule A matches");
  assert.equal(p5.outcome, "keep_counted_after_ignition", "but it already counted after ignition");
  assert.deepEqual(p5.countedRaceIds, ["R4"]);
  assert.equal(giveBackIds(plan).includes(uuid(105)), false);
  assert.equal(plan.totals.keepCountedAfterIgnition, 1);
  for (const r of plan.rows) assert.ok(!(r.outcome === "give_back" && r.countedRaceIds.length), `plan ${r.planId} counted and given back`);
});

test("buildPlan: out-of-scope teams and plans without a target are listed, never given back", () => {
  const plan = buildPlan(fixture());
  assert.deepEqual(plan.totals.outOfScopeByReason, { frozen: 1, ai_team: 1 });
  assert.equal(plan.totals.orphansNoTarget, 1);
  const ids = giveBackIds(plan);
  for (const n of [106, 107, 108]) assert.equal(ids.includes(uuid(n)), false);
  assert.equal(plan.totals.plansInSeason, 8);
  assert.equal(plan.totals.inScope, 5);
});

test("buildPlan: window start bounds are the season start and the ignition day (inclusive)", () => {
  const f = fixture();
  f.plans = [
    { id: uuid(201), rider_id: uuid(2), season_id: "S4", target_race_id: "R3", window_start: "2026-09-27", window_end: "2026-10-01" },
    { id: uuid(202), rider_id: uuid(2), season_id: "S4", target_race_id: "R3", window_start: "2026-09-28", window_end: "2026-10-02" },
    { id: uuid(203), rider_id: uuid(2), season_id: "S4", target_race_id: "R3", window_start: "2026-10-12", window_end: "2026-10-16" },
    { id: uuid(204), rider_id: uuid(2), season_id: "S4", target_race_id: "R3", window_start: "2026-10-13", window_end: "2026-10-17" },
  ];
  const plan = buildPlan(f);
  const rules = (id) => plan.rows.find((r) => r.planId === id).rules;
  assert.deepEqual(rules(uuid(201)), [], "before the season start");
  assert.deepEqual(rules(uuid(202)), ["window_started"], "season start day");
  assert.deepEqual(rules(uuid(203)), ["window_started"], "ignition day");
  assert.deepEqual(rules(uuid(204)), [], "after ignition day");
});

test("buildPlan: default ignition 'now' is a forecast; a later ignition widens rule A", () => {
  const early = buildPlan(fixture({ ignitionAt: "2026-10-09T08:00:00+02:00" }));
  assert.deepEqual(byPlan(early, 3).rules, [], "window 10/10 not started yet on 9/10");
  assert.deepEqual(byPlan(early, 2).rules, [], "R2 not started yet on 9/10 morning");
  const late = buildPlan(fixture({ ignitionAt: "2026-10-21T08:00:00+02:00", postIgnitionStagesByRider: new Map() }));
  assert.deepEqual(byPlan(late, 4).rules, ["window_started", "target_started"]);
});

test("buildPlan: follow-on effect and re-plannability are reported per plan", () => {
  const plan = buildPlan(fixture());
  const p2 = byPlan(plan, 2);
  assert.equal(p2.targetInProgressAtIgnition, true, "long stage race in progress at ignition");
  assert.equal(p2.sameTargetReplannable, false, "started race can not be targeted again");
  const p3 = byPlan(plan, 3);
  assert.equal(p3.sameTargetReplannable, true, "R3 has not started, can be targeted again");
  assert.equal(plan.totals.giveBackTargetInProgress, 1);
  assert.equal(plan.totals.giveBackLocked, 1);
  assert.equal(plan.totals.giveBackRiders, 2);
  assert.equal(plan.totals.giveBackTeams, 1);
});

test("buildPlan: a youth-squad rider gets the slot back but is flagged as not plannable now", () => {
  const f = fixture({ ignitionAt: "2026-10-21T08:00:00+02:00", postIgnitionStagesByRider: new Map() });
  const plan = buildPlan(f);
  const p4 = byPlan(plan, 4);
  assert.equal(p4.outcome, "give_back");
  assert.equal(p4.riderSeniorNow, false);
  assert.equal(plan.totals.giveBackRiderNotSenior, 1);
  assert.equal(plan.totals.giveBackTeamsParked, 1);
});

test("buildPlan: refuses an invalid ignition or a season without start date", () => {
  assert.throws(() => buildPlan(fixture({ ignitionAt: "nope" })), /ignitionAt/);
  assert.throws(() => buildPlan(fixture({ season: { id: "S4", number: 4, start_date: null } })), /start_date/);
});

// ── Hash, SQL, rapport ─────────────────────────────────────────────────────

test("approvedListHash pins the exact set incl. already given back, order independent", () => {
  const plan = buildPlan(fixture());
  const reordered = { ...plan, rows: [...plan.rows].reverse() };
  assert.equal(approvedListHash(reordered), approvedListHash(plan));
  // Efter et afbrudt apply: én plan er slettet og ligger kun i backup → samme hash.
  const f = fixture();
  f.plans = f.plans.filter((p) => p.id !== uuid(101));
  const resumed = buildPlan({ ...f, alreadyGivenBackIds: [uuid(101)] });
  assert.equal(approvedListHash(resumed), approvedListHash(plan), "resume after partial apply matches the approved hash");
  // En ny kandidat → anden hash.
  const g = fixture();
  g.plans.push({ id: uuid(109), rider_id: uuid(2), season_id: "S4", target_race_id: "R1", window_start: "2026-10-02", window_end: "2026-10-06" });
  assert.notEqual(approvedListHash(buildPlan(g)), approvedListHash(plan));
});

test("snapshot SQL is idempotent, RLS-protected and injection-safe", () => {
  const sql = buildSnapshotSql([uuid(101), uuid(102)]);
  assert.match(sql, new RegExp(`create table if not exists public\\.${BACKUP_TABLE}`));
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /enable row level security/);
  assert.ok(sql.includes(`'${uuid(102)}'`));
  assert.throws(() => buildSnapshotSql(["x'; drop table riders; --"]), /Unexpected plan id/);
  assert.match(buildSnapshotSql([]), /ingen planer/);
});

test("restore SQL never re-inserts over the quota or over an existing plan", () => {
  const sql = buildRestoreSql();
  assert.match(sql, /where not exists \(select 1 from public\.rider_peak_plans p where p\.id = b\.id\)/);
  assert.ok(sql.includes(`< ${MAX_PEAK_PLANS_PER_SEASON}`));
  assert.match(sql, /on conflict do nothing/);
});

test("public summary has only totals; private report has ids, names and the re-plan explanation", () => {
  const plan = buildPlan(fixture());
  const pub = renderPublicSummary(plan);
  assert.equal(pub.includes(uuid(1)), false);
  assert.equal(pub.includes(uuid(101)), false);
  assert.equal(pub.includes("Team A"), false);
  assert.ok(pub.includes(approvedListHash(plan)));
  const priv = renderPrivateReport(plan, { generatedAt: "2026-10-07T10:00:00Z" });
  assert.ok(priv.includes(uuid(101)));
  assert.ok(priv.includes("Team A"));
  assert.match(priv, /planlægbar igen/);
  assert.match(priv, /Følgeeffekt/);
  assert.equal((priv + pub).includes(String.fromCharCode(0x2014)), false, "no em-dash");
});

test("writePrivateArtifacts writes report, json, snapshot and restore", () => {
  const dir = mkdtempSync(join(tmpdir(), "cz6158-"));
  try {
    const plan = buildPlan(fixture());
    const files = writePrivateArtifacts(plan, { generatedAt: "2026-10-07T10:00:00.000Z", dir });
    assert.ok(readFileSync(files.report, "utf8").includes("#6158"));
    const json = JSON.parse(readFileSync(files.json, "utf8"));
    assert.equal(json.totals.giveBack, 3);
    assert.equal(json.listHash, approvedListHash(plan));
    assert.ok(readFileSync(files.snapshot, "utf8").includes(uuid(103)));
    assert.equal(readFileSync(files.snapshot, "utf8").includes(uuid(105)), false, "counted plan is not backed up for deletion");
    assert.ok(readFileSync(files.restore, "utf8").includes("restore"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Fake supabase (læse + slette) ──────────────────────────────────────────

function fakeSupabase(tables, { missingTables = [] } = {}) {
  const calls = [];
  const db = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const get = (row, col) => col.split(".").reduce((o, k) => o?.[k], row);
  return {
    calls,
    db,
    from(table) {
      const st = { table, filters: [], op: "select", range: null, single: false };
      const q = {
        select() { return q; },
        delete() { st.op = "delete"; return q; },
        in(col, vals) { st.filters.push((r) => vals.includes(get(r, col))); return q; },
        eq(col, v) { st.filters.push((r) => get(r, col) === v); return q; },
        gt(col, v) { st.filters.push((r) => Number(get(r, col)) > v); return q; },
        order() { return q; },
        limit() { return q; },
        range(a, b) { st.range = [a, b]; return q; },
        maybeSingle() { st.single = true; return q; },
        then(resolve) {
          calls.push(st);
          if (missingTables.includes(table)) return resolve({ data: null, error: { message: `relation "public.${table}" does not exist` } });
          const rows = (db[table] || []).filter((r) => st.filters.every((f) => f(r)));
          if (st.op === "delete") {
            db[table] = db[table].filter((r) => !rows.includes(r));
            return resolve({ data: rows.map((r) => ({ id: r.id })), error: null });
          }
          if (st.single) return resolve({ data: rows[0] ?? null, error: null });
          const page = st.range ? rows.slice(st.range[0], st.range[1] + 1) : rows;
          return resolve({ data: page, error: null });
        },
      };
      return q;
    },
  };
}

function dbFromFixture() {
  const f = fixture();
  return {
    seasons: [{ id: "S4", number: 4, status: "active", start_date: "2026-09-28" }],
    rider_peak_plans: f.plans,
    riders: [...f.ridersById.values()],
    teams: [...f.teamsById.values()],
    races: [...f.racesById.values()].map((r) => ({ ...r, season_id: "S4" })),
    race_stage_schedule: [
      { race_id: "R1", stage_number: 1, scheduled_at: "2026-10-03T16:00:00Z" },
      { race_id: "R2", stage_number: 1, scheduled_at: "2026-10-09T16:00:00Z" },
      { race_id: "R2", stage_number: 2, scheduled_at: "2026-10-10T16:00:00Z" },
      { race_id: "R3", stage_number: 1, scheduled_at: "2026-10-14T16:00:00Z" },
      // R4 startede efter tændingen; etape 1 er kørt 13/10, etape 2 er ikke.
      { race_id: "R4", stage_number: 1, scheduled_at: "2026-10-13T16:00:00Z" },
      { race_id: "R4", stage_number: 2, scheduled_at: "2026-10-16T16:00:00Z" },
    ],
    race_entries: [
      { race_id: "R4", rider_id: uuid(5), races: { season_id: "S4", stages_completed: 1 } },
      { race_id: "R2", rider_id: uuid(1), races: { season_id: "S4", stages_completed: 3 } },
    ],
    [BACKUP_TABLE]: [],
  };
}

test("loadPlan wires the read-only loaders into the same plan as the pure builder", async () => {
  const supabase = fakeSupabase(dbFromFixture());
  const { plan } = await loadPlan(supabase, { ignitionAt: IGNITION });
  assert.equal(plan.totals.giveBack, 3);
  assert.equal(byPlan(plan, 5).outcome, "keep_counted_after_ignition", "R4 stage 1 ran inside p5's window after ignition");
  assert.equal(approvedListHash(plan), approvedListHash(buildPlan(fixture())));
  assert.equal(supabase.calls.some((c) => c.op === "delete"), false, "dry-run never writes");
});

test("fetchBackupIds tolerates a missing backup table (before the snapshot ran)", async () => {
  const supabase = fakeSupabase(dbFromFixture(), { missingTables: [BACKUP_TABLE] });
  assert.deepEqual(await fetchBackupIds(supabase, "S4"), []);
  const { plan } = await loadPlan(supabase, { ignitionAt: IGNITION });
  assert.equal(plan.totals.alreadyGivenBack, 0);
});

// ── Apply ──────────────────────────────────────────────────────────────────

test("runApply refuses without owner-go and when the live list differs", async () => {
  const supabase = fakeSupabase(dbFromFixture());
  const { plan } = await loadPlan(supabase, { ignitionAt: IGNITION });
  await assert.rejects(runApply({ supabase, plan, seasonId: "S4", ownerGo: false, approvedHash: approvedListHash(plan) }), /owner-go/);
  await assert.rejects(runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: HASH }), /Nothing was written/);
  assert.equal(supabase.calls.some((c) => c.op === "delete"), false);
});

test("runApply aborts before any write when the backup does not cover every plan", async () => {
  const db = dbFromFixture();
  db[BACKUP_TABLE] = [{ id: uuid(101), season_id: "S4" }];
  const supabase = fakeSupabase(db);
  const { plan } = await loadPlan(supabase, { ignitionAt: IGNITION });
  await assert.rejects(runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: approvedListHash(plan) }), /Backup missing 2 of 3/);
  assert.equal(supabase.calls.some((c) => c.op === "delete"), false);
});

test("runApply deletes exactly the approved plans, verifies, and is idempotent on re-run", async () => {
  const db = dbFromFixture();
  db[BACKUP_TABLE] = [101, 102, 103].map((n) => ({ id: uuid(n), season_id: "S4" }));
  const supabase = fakeSupabase(db);
  const { plan } = await loadPlan(supabase, { ignitionAt: IGNITION });
  const approved = approvedListHash(plan);
  const result = await runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: approved });
  assert.deepEqual(result, { planned: 3, deleted: 3, alreadyGivenBack: 0, remainingAfter: 0 });
  const left = supabase.db.rider_peak_plans.map((p) => p.id).sort();
  assert.deepEqual(left, [uuid(104), uuid(105), uuid(106), uuid(107), uuid(108)], "counted, will-work and out-of-scope plans untouched");

  // Genkørsel: samme godkendte hash matcher (slettede = allerede givet tilbage), intet slettes.
  const { plan: again } = await loadPlan(supabase, { ignitionAt: IGNITION });
  assert.equal(approvedListHash(again), approved);
  const second = await runApply({ supabase, plan: again, seasonId: "S4", ownerGo: true, approvedHash: approved });
  assert.deepEqual(second, { planned: 0, deleted: 0, alreadyGivenBack: 3, remainingAfter: 0 });
});

test("after give-back the rider's quota slot is free again (quota counts rows)", async () => {
  const db = dbFromFixture();
  db[BACKUP_TABLE] = [101, 102, 103].map((n) => ({ id: uuid(n), season_id: "S4" }));
  const supabase = fakeSupabase(db);
  const { plan } = await loadPlan(supabase, { ignitionAt: IGNITION });
  const before = db.rider_peak_plans.filter((p) => p.rider_id === uuid(1)).length;
  assert.equal(before, MAX_PEAK_PLANS_PER_SEASON, "rider 1 starts with a full quota");
  await runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: approvedListHash(plan) });
  const { canCreatePeakPlan } = await import("../../lib/riderPeakPlans.js");
  const existing = supabase.db.rider_peak_plans.filter((p) => p.rider_id === uuid(1)).map((p) => p.target_race_id);
  assert.deepEqual(canCreatePeakPlan({ existingTargetRaceIds: existing, targetRaceId: "R3" }), { ok: true, reason: null });
});

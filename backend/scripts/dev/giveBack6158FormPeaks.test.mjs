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
  lastStageAtByRace,
  targetInProgressAtIgnition,
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
  backupTableName,
  defaultBackupDate,
  assessDip,
  dipApplyBlockers,
  postIgnitionFrom,
  fetchNextSeasonIgnition,
  assertNothingLeft,
  cardRows,
  renderCardHtml,
  teamAlias,
  IGNITION_NEXT_SEASON,
} from "./giveBack6158FormPeaks.mjs";
import { RACE_V3_TUNING } from "../../lib/raceRoles.js";
import { MAX_PEAK_PLANS_PER_SEASON } from "../../lib/riderPeakPlans.js";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HASH = "a".repeat(64);
const IGNITION = "2026-10-12T08:00:00+02:00";
const BACKUP_TABLE = backupTableName("20261017");
const BACKUP_DATE = "20261017";

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

test("parseArgs: read-only dry-run is the default, ignition and backup date optional", () => {
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: false, approvedHash: null, ignition: null, backupDate: null });
  assert.equal(parseArgs([`--ignition=${IGNITION}`]).ignition, new Date(Date.parse(IGNITION)).toISOString());
  assert.equal(parseArgs(["--ignition=next-season"]).ignition, IGNITION_NEXT_SEASON);
  assert.equal(parseArgs(["--ignition=now"]).ignition, "now");
  assert.equal(parseArgs([`--backup-date=${BACKUP_DATE}`]).backupDate, BACKUP_DATE);
  assert.throws(() => parseArgs(["--ignition=tomorrow"]), /ISO timestamp/);
  assert.throws(() => parseArgs(["--backup-date=2026-10-17"]), /YYYYMMDD/);
});

test("parseArgs: apply requires exact owner-go, list hash, explicit ignition and backup date", () => {
  assert.throws(() => parseArgs(["--apply"]), /owner-go/);
  assert.throws(() => parseArgs(["--apply", "--owner-go=yes"]), /Wrong owner-go/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG]), /approved-list/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG, `--approved-list=${HASH}`]), /explicit --ignition/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG, `--approved-list=${HASH}`, "--ignition=now"]), /explicit --ignition/, "'now' would move the rule's boundary on a late run");
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG, `--approved-list=${HASH}`, `--ignition=${IGNITION}`]), /backup-date/);
  assert.throws(() => parseArgs([OWNER_GO_FLAG]), /only makes sense/);
  assert.throws(() => parseArgs(["--apply", OWNER_GO_FLAG, "--approved-list=123"]), /64-char/);
  assert.throws(() => parseArgs(["--live"]), /Unknown option/);
  const ok = parseArgs(["--apply", OWNER_GO_FLAG, `--approved-list=${HASH}`, "--ignition=next-season", `--backup-date=${BACKUP_DATE}`]);
  assert.equal(ok.apply && ok.ownerGo, true);
  assert.equal(ok.approvedHash, HASH);
  assert.equal(ok.ignition, IGNITION_NEXT_SEASON);
});

test("backup table is backup_6158_<date>; default date is the Copenhagen date", () => {
  assert.equal(backupTableName("20261017"), "backup_6158_20261017");
  assert.throws(() => backupTableName("x; drop"), /YYYYMMDD/);
  // 23:30 UTC 17/10 er 18/10 i dansk tid (CEST).
  assert.equal(defaultBackupDate(new Date("2026-10-17T23:30:00Z")), "20261018");
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
  const sql = buildSnapshotSql([uuid(101), uuid(102)], BACKUP_TABLE);
  assert.match(sql, new RegExp(`create table if not exists public\\.${BACKUP_TABLE}`));
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /add column if not exists given_back_at timestamptz/, "receipt column");
  assert.ok(sql.includes(`'${uuid(102)}'`));
  assert.throws(() => buildSnapshotSql(["x'; drop table riders; --"], BACKUP_TABLE), /Unexpected plan id/);
  assert.throws(() => buildSnapshotSql([uuid(101)], "riders; drop"), /Unexpected backup table/);
  assert.match(buildSnapshotSql([], BACKUP_TABLE), /ingen planer/);
});

test("restore SQL never re-inserts over the quota or over an existing plan, and clears the receipt", () => {
  const sql = buildRestoreSql(BACKUP_TABLE);
  assert.match(sql, /and not exists \(select 1 from public\.rider_peak_plans p where p\.id = b\.id\)/);
  assert.ok(sql.includes(`< ${MAX_PEAK_PLANS_PER_SEASON}`));
  assert.match(sql, /on conflict do nothing/);
  assert.match(sql, /set given_back_at = null/);
  assert.ok(sql.includes(BACKUP_TABLE));
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
    plan.backupTable = BACKUP_TABLE;
    const files = writePrivateArtifacts(plan, { generatedAt: "2026-10-07T10:00:00.000Z", dir });
    const card = readFileSync(files.card, "utf8");
    assert.ok(card.includes("Hold A"));
    assert.equal(card.includes("Team A"), false, "card is anonymised");
    assert.ok(readFileSync(files.snapshot, "utf8").includes(BACKUP_TABLE));
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

// ── Del B: nedgangen (rene funktioner) ─────────────────────────────────────

const P = RACE_V3_TUNING.PEAK_PAYBACK_DAYS;
const ord = (d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function dipInputs({ peak = undefined, engineVersion = 4, stageDay = addDays("2026-10-05", 1), riderId = uuid(1) } = {}) {
  const plan = buildPlan(fixture());
  const seasonStagesByRider = new Map([[riderId, [{ raceId: "R9", stageNumber: 1, dayOrdinal: ord(stageDay) }]]]);
  const latestRunByStage = new Map([["R9:1", { runId: "run-9-1", engineVersion }]]);
  const peakComponentByRunRider = new Map(peak === undefined ? [] : [[`run-9-1:${riderId}`, peak]]);
  return { plan, seasonStagesByRider, latestRunByStage, peakComponentByRunRider };
}

test("assessDip: under v4 a rider can stand in the dip, but no dip is applied and nothing blocks", () => {
  const { plan, ...io } = dipInputs();
  const dip = assessDip({ rows: plan.rows, ...io, todayOrdinal: ord("2026-10-12") });
  const p1 = dip.perPlan.find((p) => p.planId === uuid(101));
  assert.equal(p1.dipStagesRun, 1, "the stage the day after p1's window is in the dip");
  assert.equal(p1.dipStagesApplied, 0);
  assert.deepEqual(p1.engineVersions, ["4"]);
  assert.equal(dip.totals.dipWithoutBonusStagesApplied, 0);
  assert.equal(dip.totals.ridersNeedingFormAdjustment, 0);
  assert.ok(dip.riders.every((x) => x.riderConditionDelta === 0), "rider_condition is never the place the dip lives");
  assert.deepEqual(dipApplyBlockers(dip), []);
});

test("assessDip: an applied dip after a peak without bonus is measured, converted and blocks apply", () => {
  const { plan, ...io } = dipInputs({ peak: -2, engineVersion: 2 });
  const dip = assessDip({ rows: plan.rows, ...io, todayOrdinal: ord("2026-10-12") });
  assert.equal(dip.totals.dipStagesApplied, 1);
  assert.equal(dip.totals.dipWithoutBonusStagesApplied, 1);
  const r1 = dip.riders.find((x) => x.riderId === uuid(1));
  assert.equal(r1.dipStagesApplied, 1);
  assert.ok(r1.formAdjustmentPoints > 0, "adjustment has the opposite sign of the dip");
  assert.equal(dip.totals.ridersNeedingFormAdjustment, 1);
  assert.match(dipApplyBlockers(dip).join(" "), /separate owner decision/);
});

test("assessDip: a positive peak component (the bonus) is not a dip; a stage outside the dip is ignored", () => {
  const bonus = dipInputs({ peak: 3, engineVersion: 2 });
  assert.equal(assessDip({ rows: bonus.plan.rows, ...bonus, todayOrdinal: ord("2026-10-12") }).totals.dipStagesApplied, 0);
  const late = dipInputs({ peak: -2, engineVersion: 2, stageDay: addDays("2026-10-05", P + 1) });
  const dip = assessDip({ rows: late.plan.rows, ...late, todayOrdinal: ord("2026-10-12") });
  assert.equal(dip.perPlan.find((p) => p.planId === uuid(101)).dipStagesRun, 0, "one day past the dip");
});

test("assessDip: another active window the same day wins over the dip (same rule as the engine)", () => {
  // Rytter 2: p3 (10-14/10). Lægger en ekstra plan hvis vindue dækker dagen efter p3.
  const f = fixture();
  f.plans.push({ id: uuid(110), rider_id: uuid(2), season_id: "S4", target_race_id: "R3", window_start: "2026-10-15", window_end: "2026-10-16" });
  const plan = buildPlan(f);
  const seasonStagesByRider = new Map([[uuid(2), [{ raceId: "R9", stageNumber: 1, dayOrdinal: ord("2026-10-15") }]]]);
  const dip = assessDip({
    rows: plan.rows, seasonStagesByRider,
    latestRunByStage: new Map([["R9:1", { runId: "r", engineVersion: 2 }]]),
    peakComponentByRunRider: new Map([[`r:${uuid(2)}`, -2]]),
    todayOrdinal: ord("2026-10-12"),
  });
  assert.equal(dip.perPlan.find((p) => p.planId === uuid(103)).dipStagesRun, 0);
});

test("assessDip: dip status vs today, and only no-bonus dips count as carried", () => {
  const plan = buildPlan(fixture());
  const today = ord("2026-10-12");
  const dip = assessDip({ rows: plan.rows, seasonStagesByRider: new Map(), latestRunByStage: new Map(), peakComponentByRunRider: new Map(), todayOrdinal: today });
  const status = (n) => dip.perPlan.find((p) => p.planId === uuid(100 + n)).paybackStatus;
  // p1 slutter 5/10: nedgangen 6/10 .. 5/10+P.
  assert.equal(status(1), ord("2026-10-05") + P < today ? "lapsed" : "active");
  assert.equal(status(4), "ahead", "p4 window 20-24/10");
  const p4 = dip.perPlan.find((p) => p.planId === uuid(104));
  assert.equal(p4.outcome, "keep_will_work");
  assert.equal(p4.dipAheadWithBonus, true, "a kept peak earns its dip");
  assert.equal(p4.dipAheadRemovedByGiveBack, false);
  const p2 = dip.perPlan.find((p) => p.planId === uuid(102));
  assert.equal(p2.dipAheadRemovedByGiveBack, true, "given back: the dip ahead disappears with the row");
  assert.equal(dip.riders.some((x) => x.riderId === uuid(3)), false, "rider 3 has only a kept plan");
  assert.ok(dip.totals.ridersCarryingDipAhead >= 1);
});

test("postIgnitionFrom keeps only stages in races that started at or after ignition", () => {
  const ign = Date.parse(IGNITION);
  const m = new Map([[uuid(1), [
    { raceId: "old", stageNumber: 2, dayOrdinal: 1, raceFirstMs: ign - 1 },
    { raceId: "new", stageNumber: 1, dayOrdinal: 2, raceFirstMs: ign },
    { raceId: "none", stageNumber: 1, dayOrdinal: 3, raceFirstMs: null },
  ]]]);
  assert.deepEqual(postIgnitionFrom(m, ign).get(uuid(1)), [{ raceId: "new", dayOrdinal: 2 }]);
});

test("card rows are anonymised and add up; aliases are stable", () => {
  assert.equal(teamAlias(0), "Hold A");
  assert.equal(teamAlias(25), "Hold Z");
  assert.equal(teamAlias(26), "Hold AA");
  const plan = buildPlan(fixture());
  const rows = cardRows(plan);
  assert.equal(rows.reduce((s, r) => s + r.givenBack, 0), plan.totals.giveBack);
  assert.ok(rows.every((r) => r.after === r.before - r.givenBack));
  const html = renderCardHtml(plan, { generatedAt: "2026-10-17T10:00:00Z" });
  assert.equal(html.includes("Team A") || html.includes("Team B"), false);
  assert.equal(html.includes(String.fromCharCode(0x2014)), false, "no em-dash");
});

// ── Fake supabase (læse + slette + opdatere) ───────────────────────────────

function fakeSupabase(tables, { missingTables = [] } = {}) {
  const calls = [];
  const db = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const get = (row, col) => col.replace(/->/g, ".").split(".").reduce((o, k) => o?.[k], row);
  return {
    calls,
    db,
    from(table) {
      const st = { table, filters: [], op: "select", range: null, single: false, values: null };
      const q = {
        select() { return q; },
        delete() { st.op = "delete"; return q; },
        update(values) { st.op = "update"; st.values = values; return q; },
        in(col, vals) { st.filters.push((r) => vals.includes(get(r, col))); return q; },
        eq(col, v) { st.filters.push((r) => get(r, col) === v); return q; },
        gt(col, v) { st.filters.push((r) => Number(get(r, col)) > v); return q; },
        is(col, v) { st.filters.push((r) => (get(r, col) ?? null) === v); return q; },
        not(col, op, v) { st.filters.push((r) => (get(r, col) ?? null) !== v); return q; },
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
          if (st.op === "update") {
            for (const r of rows) Object.assign(r, st.values);
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

const NOW = "2026-10-12T10:00:00Z";

function dbFromFixture() {
  const f = fixture();
  return {
    seasons: [
      { id: "S4", number: 4, status: "active", start_date: "2026-09-28" },
      { id: "S5", number: 5, status: "upcoming", start_date: "2026-10-28" },
    ],
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
      // R5: dagen efter p1's vindue (rytter 1 står i nedgangen), kørt under v4.
      { race_id: "R5", stage_number: 1, scheduled_at: "2026-10-06T16:00:00Z" },
    ],
    race_entries: [
      { race_id: "R4", rider_id: uuid(5), races: { season_id: "S4", stages_completed: 1 } },
      { race_id: "R2", rider_id: uuid(1), races: { season_id: "S4", stages_completed: 3 } },
      { race_id: "R5", rider_id: uuid(1), races: { season_id: "S4", stages_completed: 1 } },
    ],
    race_simulation_runs: [
      { id: "run-r5-1", race_id: "R5", stage_number: 1, engine_version: 4, created_at: "2026-10-06T16:05:00Z" },
      { id: "run-r4-1", race_id: "R4", stage_number: 1, engine_version: 4, created_at: "2026-10-13T16:05:00Z" },
    ],
    // v4 skriver ingen score-komponenter.
    race_simulation_rider_scores: [],
    [BACKUP_TABLE]: [],
  };
}

const load = (supabase, extra = {}) => loadPlan(supabase, { ignition: new Date(Date.parse(IGNITION)).toISOString(), backupTable: BACKUP_TABLE, now: NOW, ...extra });

test("loadPlan wires the read-only loaders into the same plan as the pure builder", async () => {
  const supabase = fakeSupabase(dbFromFixture());
  const { plan } = await load(supabase);
  assert.equal(plan.totals.giveBack, 3);
  assert.equal(byPlan(plan, 5).outcome, "keep_counted_after_ignition", "R4 stage 1 ran inside p5's window after ignition");
  assert.equal(approvedListHash(plan), approvedListHash(buildPlan(fixture())));
  assert.equal(plan.backupTable, BACKUP_TABLE);
  assert.ok(plan.dip.totals.dipStagesRun >= 1, "rider 1 started R5 in the dip after p1");
  assert.ok(plan.dip.totals.engineVersionsSeen.includes("4"));
  assert.equal(plan.dip.totals.dipStagesApplied, 0, "v4 applied no dip");
  assert.equal(supabase.calls.some((c) => c.op !== "select"), false, "dry-run never writes");
});

test("loadPlan: default ignition is the next season's start at Copenhagen midnight", async () => {
  const supabase = fakeSupabase(dbFromFixture());
  assert.equal(await fetchNextSeasonIgnition(supabase, { number: 4 }), "2026-10-27T23:00:00.000Z", "28/10 00:00 CET");
  const { plan } = await load(supabase, { ignition: IGNITION_NEXT_SEASON });
  assert.equal(plan.totals.ignitionAt, "2026-10-27T23:00:00.000Z");
  // Ingen løb er startet efter S5-start: intet har talt, alle S4-toppe i scope gives tilbage.
  assert.equal(plan.totals.keepCountedAfterIgnition, 0);
  assert.equal(plan.totals.keepWillWork, 0);
  assert.equal(plan.totals.giveBack, plan.totals.inScope);
  assert.equal(plan.dip.totals.plansDipAheadWithBonus, 0, "no kept peak left to earn a dip");
  const { plan: now } = await load(supabase, { ignition: "now" });
  assert.equal(now.totals.ignitionAt, new Date(NOW).toISOString());
  await assert.rejects(load(fakeSupabase({ ...dbFromFixture(), seasons: [{ id: "S4", number: 4, status: "active", start_date: "2026-09-28" }] }), { ignition: IGNITION_NEXT_SEASON }), /No season 5/);
});

test("fetchBackupIds tolerates a missing backup table (before the snapshot ran)", async () => {
  const supabase = fakeSupabase(dbFromFixture(), { missingTables: [BACKUP_TABLE] });
  assert.deepEqual(await fetchBackupIds(supabase, "S4", BACKUP_TABLE), []);
  const { plan } = await load(supabase);
  assert.equal(plan.totals.alreadyGivenBack, 0);
  await assert.rejects(fetchBackupIds(supabase, "S4", "riders"), /Unexpected backup table/);
});

// ── Apply ──────────────────────────────────────────────────────────────────

const backupRows = (ns) => ns.map((n) => ({ id: uuid(n), season_id: "S4", given_back_at: null }));

test("runApply refuses without owner-go and when the live list differs", async () => {
  const supabase = fakeSupabase(dbFromFixture());
  const { plan } = await load(supabase);
  await assert.rejects(runApply({ supabase, plan, seasonId: "S4", ownerGo: false, approvedHash: approvedListHash(plan) }), /owner-go/);
  await assert.rejects(runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: HASH }), /Nothing was written/);
  assert.equal(supabase.calls.some((c) => c.op !== "select"), false);
});

test("runApply aborts before any write when the backup does not cover every plan", async () => {
  const db = dbFromFixture();
  db[BACKUP_TABLE] = backupRows([101]);
  const supabase = fakeSupabase(db);
  const { plan } = await load(supabase);
  await assert.rejects(runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: approvedListHash(plan) }), /Backup missing 2 of 3/);
  assert.equal(supabase.calls.some((c) => c.op !== "select"), false);
});

test("runApply aborts before any write when a dip without bonus was applied in a finished result", async () => {
  const db = dbFromFixture();
  db[BACKUP_TABLE] = backupRows([101, 102, 103]);
  db.race_simulation_runs[0].engine_version = 2;
  db.race_simulation_rider_scores = [{ run_id: "run-r5-1", rider_id: uuid(1), peak: -2, components: { peak: -2 } }];
  const supabase = fakeSupabase(db);
  const { plan } = await load(supabase);
  assert.equal(plan.dip.totals.dipWithoutBonusStagesApplied, 1);
  await assert.rejects(runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: approvedListHash(plan) }), /separate owner decision/);
  assert.equal(supabase.calls.some((c) => c.op !== "select"), false);
});

test("runApply refuses a plan without the part B assessment", async () => {
  const supabase = fakeSupabase(dbFromFixture());
  const { plan } = await load(supabase);
  delete plan.dip;
  await assert.rejects(runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: approvedListHash(plan) }), /part B/);
});

test("runApply deletes exactly the approved plans, receipts them, verifies, and is idempotent on re-run", async () => {
  const db = dbFromFixture();
  db[BACKUP_TABLE] = backupRows([101, 102, 103]);
  const supabase = fakeSupabase(db);
  const { plan } = await load(supabase);
  const approved = approvedListHash(plan);
  const result = await runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: approved, now: "2026-10-28T08:00:00Z" });
  assert.deepEqual(result, { planned: 3, deleted: 3, alreadyGivenBack: 0, receipted: 3, remainingAfter: 0 });
  const left = supabase.db.rider_peak_plans.map((p) => p.id).sort();
  assert.deepEqual(left, [uuid(104), uuid(105), uuid(106), uuid(107), uuid(108)], "counted, will-work and out-of-scope plans untouched");
  assert.ok(supabase.db[BACKUP_TABLE].every((r) => r.given_back_at === "2026-10-28T08:00:00Z"), "every row has its receipt");

  // Genkørsel: samme godkendte hash matcher (slettede = allerede givet tilbage), intet slettes, kvittering urørt.
  const { plan: again } = await load(supabase);
  assert.equal(approvedListHash(again), approved);
  assertNothingLeft(again, approved);
  const second = await runApply({ supabase, plan: again, seasonId: "S4", ownerGo: true, approvedHash: approved, now: "2026-10-29T08:00:00Z" });
  assert.deepEqual(second, { planned: 0, deleted: 0, alreadyGivenBack: 3, receipted: 0, remainingAfter: 0 });
  assert.ok(supabase.db[BACKUP_TABLE].every((r) => r.given_back_at === "2026-10-28T08:00:00Z"), "the first receipt is kept");
});

test("runApply resumes after an interrupted run: finishes the receipt for rows deleted earlier", async () => {
  const db = dbFromFixture();
  db[BACKUP_TABLE] = backupRows([101, 102, 103]);
  db.rider_peak_plans = db.rider_peak_plans.filter((p) => p.id !== uuid(101)); // slettet, men aldrig kvitteret
  const supabase = fakeSupabase(db);
  const { plan } = await load(supabase);
  assert.equal(approvedListHash(plan), approvedListHash(buildPlan(fixture())));
  const res = await runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: approvedListHash(plan) });
  assert.deepEqual(res, { planned: 2, deleted: 2, alreadyGivenBack: 1, receipted: 3, remainingAfter: 0 });
});

test("assertNothingLeft fails when something still qualifies or the hash moved", async () => {
  const supabase = fakeSupabase(dbFromFixture());
  const { plan } = await load(supabase);
  assert.throws(() => assertNothingLeft(plan, approvedListHash(plan)), /still qualify/);
});

test("after give-back the rider's quota slot is free again (quota counts rows)", async () => {
  const db = dbFromFixture();
  db[BACKUP_TABLE] = backupRows([101, 102, 103]);
  const supabase = fakeSupabase(db);
  const { plan } = await load(supabase);
  const before = db.rider_peak_plans.filter((p) => p.rider_id === uuid(1)).length;
  assert.equal(before, MAX_PEAK_PLANS_PER_SEASON, "rider 1 starts with a full quota");
  await runApply({ supabase, plan, seasonId: "S4", ownerGo: true, approvedHash: approvedListHash(plan) });
  const { canCreatePeakPlan } = await import("../../lib/riderPeakPlans.js");
  const existing = supabase.db.rider_peak_plans.filter((p) => p.rider_id === uuid(1)).map((p) => p.target_race_id);
  assert.deepEqual(canCreatePeakPlan({ existingTargetRaceIds: existing, targetRaceId: "R3" }), { ok: true, reason: null });
});

test("#6158 (Codex): etapeløb i gang ved tændingen afgøres af etapeplanen, ikke dagens tæller", () => {
  const ign = Date.parse("2026-10-28T00:00:00+01:00");
  const race = { stages: 5, stages_completed: 2 };
  // Slutter før tændingen: ikke i gang ved tændingen, selvom kun 2 af 5 er kørt i dag.
  assert.equal(targetInProgressAtIgnition(race, { targetStarted: true, lastStageMs: Date.parse("2026-10-24T15:00:00+02:00"), ignitionMs: ign }), false);
  // Sidste etape efter tændingen: i gang.
  assert.equal(targetInProgressAtIgnition(race, { targetStarted: true, lastStageMs: Date.parse("2026-10-29T15:00:00+01:00"), ignitionMs: ign }), true);
  // Uden etapeplan: fallback til tælleren.
  assert.equal(targetInProgressAtIgnition(race, { targetStarted: true, lastStageMs: null, ignitionMs: ign }), true);
  // Endagsløb og ikke-startede løb er aldrig i gang.
  assert.equal(targetInProgressAtIgnition({ stages: 1 }, { targetStarted: true, lastStageMs: null, ignitionMs: ign }), false);
  assert.equal(targetInProgressAtIgnition(race, { targetStarted: false, lastStageMs: null, ignitionMs: ign }), false);
  const last = lastStageAtByRace([{ race_id: "a", scheduled_at: "2026-10-20T13:00:00Z" }, { race_id: "a", scheduled_at: "2026-10-22T13:00:00Z" }]);
  assert.equal(last.get("a"), Date.parse("2026-10-22T13:00:00Z"));
});

test("#6158 (Codex): backup-tabellen faar Data API-grants kun til service_role", () => {
  const sql = buildSnapshotSql(["00000000-0000-0000-0000-000000000001"], "backup_6158_20261017");
  assert.match(sql, /revoke all on table public\.backup_6158_20261017 from public, anon, authenticated, service_role;/);
  assert.match(sql, /grant select, insert, update, delete on table public\.backup_6158_20261017 to service_role;/);
  assert.doesNotMatch(sql, /to (anon|authenticated)/);
});

test("#6158 (review): restore genindsætter kun kvitterede (af scriptet tilbagegivne) planer", () => {
  const sql = buildRestoreSql("backup_6158_20261017");
  assert.match(sql, /where b\.given_back_at is not null/);
});

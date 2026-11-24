// #8606: compensation of late riders through the #6061 path. The tests lock:
//   · the repair gives the SAME result as the engine (runTeamTrainingDay) for a date under the
//     XP model (start date and a later date) and for a date under today's model;
//   · without the engine's model (the old repair) an XP date comes out differently;
//   · a rider-date list reaches riders outside any roster, a sold rider is compensated on his
//     current team, a rider with a receipt on the date is refused, and a repeat run after the
//     receipts exist finds nothing new (idempotence; the writer itself is idempotent too);
//   · the dry-run summary is anonymous (Hold A/B) and has totals.
// All numbers are synthetic fixtures (hard rule 17); no prod data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VISIBLE_ABILITIES } from '../../lib/abilityDerivation.js';
import { validateDevelopmentXpParams, roundedXp } from '../../lib/developmentXp.ts';
import { DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY } from '../../lib/developmentXpFlag.ts';
import { developmentModelTickArgs } from '../../lib/dailyTrainingEngine.js';
import { XP_TEST_PARAMS, ENGINE_SCENARIOS, engineSeed, runEngine } from '../../lib/__fixtures__/developmentXpOffScenarios.js';
import { simulateRiderRepair, xpPayoutDate } from './repair5912LostTraining.mjs';
import { workFromRiderDates, buildRecoveryManifest } from './prepare6061TrainingRecovery.mjs';
import { calculateCompensation } from './calculate6061Compensation.mjs';
import { buildApplyPayload, serializeApplyPayload, SOURCE_HASH_TABLES } from './compensation6061Source.mjs';
import { buildDevelopmentContexts, summarizeByTeam, formatSummary, parseLateRiderArgs, LATE_RIDER_LIST_SQL } from './8606LateRiderCompensation.mjs';

const XP = validateDevelopmentXpParams(XP_TEST_PARAMS);
const TICK_DATE = '2026-06-12'; // the engine fixture's date
const EARLIER = '2026-06-01';
const xpOn = (fromDate) => ({ app: [[DEVELOPMENT_XP_FLAG_KEY, 'on'], [DEVELOPMENT_XP_FROM_DATE_KEY, fromDate]], params: XP_TEST_PARAMS });
const NONE = { app: [], params: undefined };

// The engine fixture's rider r1 on its one training day, then the repair of that same day.
async function engineAndRepair({ overlay, developmentContext }) {
  const state = engineSeed({ flags: ENGINE_SCENARIOS.cap.flags, raced: false, overlay, plan: 'vo2max' });
  const rider = structuredClone(state.riders[0]);
  const abilityRow = structuredClone(state.rider_derived_abilities[0]);
  const plan = structuredClone(state.training_plans[0]);
  const condition = structuredClone(state.rider_condition[0]); // the engine updates the row in place
  const result = await runEngine(state);
  const report = result.report.riders.find((r) => r.rider_id === 'r1');
  const after = state.rider_derived_abilities.find((r) => r.rider_id === 'r1');
  const day = { key: 'k1', kind: 'free_slot', tickDate: TICK_DATE, riderId: 'r1', teamId: 'team-a', seasonId: 'season-1', gameDay: 1, dateGameDays: [1, 2, 3, 4, 5], formBefore: condition.form, fatigueBefore: condition.fatigue };
  const repair = simulateRiderRepair({ rider, abilityRow, days: [day], plan, staff: null, facilityTier: 0, seasonNumber: 1, recomputeCapsPerTick: true, frame: 'calendar', developmentContext });
  return { report, after, repair };
}
function assertSameAsEngine({ report, after, repair }) {
  assert.ok(Object.values(report.gains).some((n) => n > 0) || Object.keys(report.progress_after ?? {}).length > 0, 'the engine trained the rider');
  assert.deepEqual(repair.perDay[0].gains, report.gains, 'same whole points as the engine');
  assert.deepEqual(repair.patch.ability_progress, report.progress_after, 'same bar as the engine');
  for (const k of VISIBLE_ABILITIES) assert.equal(repair.patch[k] ?? repair.before[k], after[k], `same ${k} as the engine wrote`);
}

test('#8606 new model, XP start date: the repair gives the engine\'s XP, points and bar', async () => {
  const out = await engineAndRepair({ overlay: xpOn(TICK_DATE), developmentContext: { xpByDate: { [TICK_DATE]: XP }, xpFromDate: TICK_DATE, capPerDateOn: true } });
  assert.ok(out.report.xp_developed, 'engine ran the XP model');
  assertSameAsEngine(out);
  assert.equal(out.repair.perDay[0].model, 'xp');
  assert.deepEqual(roundedXp(out.repair.perDay[0].xp), out.report.xp, 'same XP as the engine');
  assert.deepEqual(out.repair.perDay[0].gains, out.report.gains);
});

test('#8606 new model, a later XP date (no stored-bar payout): same as the engine', async () => {
  const out = await engineAndRepair({ overlay: xpOn(EARLIER), developmentContext: { xpByDate: { [TICK_DATE]: XP }, xpFromDate: EARLIER, capPerDateOn: true } });
  assert.ok(out.report.xp_developed);
  assertSameAsEngine(out);
  assert.deepEqual(roundedXp(out.repair.perDay[0].xp), out.report.xp);
});

test('#8606 old model date (before the XP start): same as the engine, per-date rule included', async () => {
  const out = await engineAndRepair({ overlay: NONE, developmentContext: { xpByDate: {}, capPerDateOn: true } });
  assert.equal(out.report.xp_developed, undefined, 'engine ran today\'s model');
  assertSameAsEngine(out);
  assert.equal(out.repair.perDay[0].model, 'today');
});

test('#8606 regression: the old repair (no engine model) misses the XP model', async () => {
  const withModel = await engineAndRepair({ overlay: xpOn(TICK_DATE), developmentContext: { xpByDate: { [TICK_DATE]: XP }, xpFromDate: TICK_DATE, capPerDateOn: true } });
  const legacy = await engineAndRepair({ overlay: xpOn(TICK_DATE), developmentContext: null });
  assert.notDeepEqual(legacy.repair.patch.ability_progress, withModel.report.progress_after, 'without the model the bar differs from the engine');
});

test('#8606 engine helper: no XP adds nothing new; XP adds the date rules', () => {
  const rider = { id: 'r', talent_ceiling: null };
  const off = developmentModelTickArgs({ rider, curveB: null, curveBTransition: null, developmentXp: null, dateUsedGains: () => { throw new Error('not read without XP'); }, xpStoredBarPayout: true, xpDateStart: null, preFatigue: 1 });
  assert.deepEqual(Object.keys(off), ['curveB', 'curveBTransition', 'developmentXp']);
  const on = developmentModelTickArgs({ rider, curveB: null, curveBTransition: null, developmentXp: XP, dateUsedGains: () => ({ flat: 1 }), xpStoredBarPayout: true, xpDateStart: { dateStart: { progress: null, paid: {} } }, preFatigue: 2 });
  assert.deepEqual(on.xpDateUsedGains, { flat: 1 });
  assert.equal(on.xpStoredBarPayout, true);
  assert.deepEqual(on.xpRider, { ceiling: null, fatigue: 2 });
});

test('#8606 stored-bar payout follows the engine and is never paid twice', () => {
  const days = [{ kind: 'free_slot', tickDate: '2026-11-22' }, { kind: 'free_slot', tickDate: '2026-11-23' }];
  const xpByDate = { '2026-11-22': XP, '2026-11-23': XP };
  assert.equal(xpPayoutDate({ xpByDate, xpFromDate: '2026-11-22' }, days), '2026-11-22', 'start date pays');
  assert.equal(xpPayoutDate({ xpByDate, xpFromDate: '2026-11-22', alreadyDeveloped: true }, days), null, 'already developed under XP on a real date');
  assert.equal(xpPayoutDate({ xpByDate, xpFromDate: '2026-11-22' }, days.slice(1)), null, 'later first date without a manager team at the start');
  assert.equal(xpPayoutDate({ xpByDate, xpFromDate: '2026-11-22', eligibleAfterIgnition: true }, days.slice(1)), '2026-11-23');
  assert.equal(xpPayoutDate({ xpByDate: {}, xpFromDate: '2026-11-22' }, days), null, 'old model dates pay nothing');
});

// ── The rider-date list through the #6061 calculation ─────────────────────────
const T_A = '00000000-0000-4000-8000-00000000000a';
const T_B = '00000000-0000-4000-8000-00000000000b';
const S = '00000000-0000-4000-8000-0000000000f1';
const R1 = '00000000-0000-4000-8000-000000000001';
const R2 = '00000000-0000-4000-8000-000000000002';
const R3 = '00000000-0000-4000-8000-000000000003';
const OLD = '2026-11-21', NEW = '2026-11-22';
const DAYS_OLD = [40, 41, 42, 43, 44], DAYS_NEW = [45, 46, 47, 48, 49];
const listRows = () => [
  { rider_id: R1, team_id: T_A, season_id: S, tick_date: OLD, game_days: DAYS_OLD },
  { rider_id: R1, team_id: T_A, season_id: S, tick_date: NEW, game_days: DAYS_NEW },
  // Sold since: still compensated, on his current team (owner 24/11).
  { rider_id: R2, team_id: T_A, season_id: S, tick_date: NEW, game_days: DAYS_NEW },
  { rider_id: R3, team_id: T_B, season_id: S, tick_date: NEW, game_days: DAYS_NEW },
];
const abilityRow = (id) => ({ rider_id: id, ...Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 50])), ability_progress: {} });
function listInput(rows = listRows()) {
  const ids = [R1, R2, R3];
  const currentTeam = { [R1]: T_A, [R2]: T_B, [R3]: T_B };
  return {
    state: {
      asOf: '2026-11-24T12:00:00Z', through: '2026-11-23', work: workFromRiderDates(rows),
      riders: ids.map((id) => ({ id, team_id: currentTeam[id] })), conditions: ids.map((id) => ({ rider_id: id, form: 50, fatigue: 20 })),
      ticks: [], settlements: [], legacyReports: [], loads: [], plans: [{ rider_id: R1, team_id: T_A, focus: 'climbing', intensity: 'normal' }], weekPlans: [],
      dateRosters: [], compensations: [],
    },
    fullRiders: ids.map((id) => ({ id, team_id: currentTeam[id], birthdate: '2006-06-01', potentiale: 4, primary_type: 'climber', secondary_type: 'puncheur', is_academy: true })),
    abilityRows: ids.map(abilityRow), seasons: [{ id: S, number: 5 }],
    teamContexts: { [T_A]: { staff: null, facilityTier: 0, programsOn: false }, [T_B]: { staff: null, facilityTier: 0, programsOn: false } },
    stageBySlot: {}, managerTeamIds: [T_A, T_B],
  };
}
const model = { dates: [OLD, NEW], xpByDate: { [OLD]: null, [NEW]: XP }, xpFromDate: NEW, capPerDateOn: true, curveB: null, developmentScoreB: null, raceCatchUp: null };
const withModel = (data) => ({ ...data, developmentContexts: buildDevelopmentContexts({ riderIds: [R1, R2, R3], ticks: data.state.ticks, model }) });

test('#8606 list: validated, grouped per team-date, training follows the rider', () => {
  const work = workFromRiderDates(listRows());
  assert.equal(work.length, 3);
  assert.ok(work.every((w) => w.follows_rider === true));
  assert.throws(() => workFromRiderDates([{ ...listRows()[0], game_days: [1, 2, 3] }]), /five unique/);
  assert.throws(() => workFromRiderDates([listRows()[0], listRows()[0]]), /twice/);
  assert.throws(() => workFromRiderDates([{ ...listRows()[0], rider_id: 'r1' }]), /uuids/);
  assert.throws(() => workFromRiderDates([]), /non-empty/);
});

test('#8606 list: late riders are calculated; the sold rider on his current team; old and new model per date', async () => {
  const result = await calculateCompensation(withModel(listInput()));
  assert.deepEqual(result.blocked, []);
  assert.equal(result.summary.riders, 3);
  assert.equal(result.summary.rider_days, 20);
  const sold = result.plans.find((p) => p.rider_id === R2);
  assert.equal(sold.team_id, T_B, 'compensation goes to the rider\'s current team');
  const r1 = result.plans.find((p) => p.rider_id === R1);
  assert.deepEqual(r1.perDay.map((d) => d.model), ['today', 'today', 'today', 'today', 'today', 'xp', 'xp', 'xp', 'xp', 'xp']);
});

test('#8606 list: a rider with a receipt on the date is refused', async () => {
  const data = listInput();
  data.state.ticks = [{ rider_id: R3, season_id: S, game_day: DAYS_NEW[0], team_id: T_B, tick_date: NEW, report: { gains: {} } }];
  const result = await calculateCompensation(withModel(data));
  assert.equal(result.plans.some((p) => p.rider_id === R3), false);
  assert.deepEqual(result.blocked, [{ rider_id: R3, reason: 'inventory_blocker:receipt_on_date' }]);
  const roster = listInput();
  roster.state.dateRosters = [{ team_id: T_A, season_id: S, tick_date: NEW, expected_rider_ids: [R3] }];
  assert.equal((await calculateCompensation(withModel(roster))).blocked[0].reason, 'inventory_blocker:in_date_roster');
});

test('#8606 idempotence: same input gives the same payload, and after the receipts nothing is new', async () => {
  const hashes = Object.fromEntries(SOURCE_HASH_TABLES.map((t) => [t, 'a'.repeat(64)]));
  const scope = { rider_ids: [R1, R2, R3], team_ids: [T_A, T_B], season_ids: [S] };
  const first = await calculateCompensation(withModel(listInput()));
  const again = await calculateCompensation(withModel(listInput()));
  const a = serializeApplyPayload(buildApplyPayload(first, { scope, sourceHashes: hashes }));
  const b = serializeApplyPayload(buildApplyPayload(again, { scope, sourceHashes: hashes }));
  assert.equal(a.sha256, b.sha256);
  const applied = listInput();
  applied.state.compensations = first.plans.flatMap((p) => p.days.map((d) => ({ rider_id: p.rider_id, season_id: p.season_id, game_day: d.gameDay, tick_date: d.tickDate })));
  const rerun = await calculateCompensation(withModel(applied));
  assert.equal(rerun.summary.rider_days, 0, 'a repeat dry-run finds nothing new');
  assert.equal(rerun.plans.length, 0);
});

test('#8606 guards: race day, team without development and missing model are blocked', async () => {
  const raced = listInput();
  raced.stageBySlot = { [`${R3}:${S}:${DAYS_NEW[0]}`]: { raceId: 'race', stageNumber: 1, profileType: 'mountain' } };
  raced.state.loads = [{ rider_id: R3, season_id: S, tick_date: NEW, game_day: DAYS_NEW[0], load: 10 }];
  assert.deepEqual((await calculateCompensation(withModel(raced))).blocked, [{ rider_id: R3, reason: 'race_day_needs_stage_role' }]);
  const ai = listInput();
  ai.managerTeamIds = [T_A];
  assert.deepEqual((await calculateCompensation(withModel(ai))).blocked.map((b) => b.reason), ['team_without_development', 'team_without_development']);
  const noModel = listInput();
  const contexts = buildDevelopmentContexts({ riderIds: [R1, R2], ticks: [], model });
  assert.deepEqual((await calculateCompensation({ ...noModel, developmentContexts: contexts })).blocked, [{ rider_id: R3, reason: 'missing_development_model' }]);
});

test('#8606 dry-run summary: anonymous teams and totals, no ids', async () => {
  const data = withModel(listInput());
  const result = await calculateCompensation(data);
  const summary = summarizeByTeam({ state: data.state, result });
  assert.deepEqual(summary.teams.map((t) => t.team), ['Hold A', 'Hold B']);
  assert.equal(summary.teams[0].riders, 2);
  assert.equal(summary.teams[0].rider_days, 15);
  assert.equal(summary.total.rider_days, 20);
  assert.equal(summary.total.list_rider_dates, 4);
  const text = formatSummary(summary).join('\n') + JSON.stringify(summary);
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-/i, 'no uuid in the owner output');
  assert.match(text, /I alt: 3 ryttere, 20 rytter-loebsdage/);
});

test('#8606 CLI: read-only arguments, the list SQL only reads', () => {
  assert.throws(() => parseLateRiderArgs(['--apply']), /read-only/);
  assert.throws(() => parseLateRiderArgs(['--list=x.json']), /--through/);
  assert.deepEqual(parseLateRiderArgs(['--list=x.json', '--through=2026-11-23', '--as-of=2026-11-24T12:00:00Z']), { list: 'x.json', through: '2026-11-23', asOf: '2026-11-24T12:00:00Z' });
  assert.doesNotMatch(LATE_RIDER_LIST_SQL, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b|apply_training_compensation/i);
  // The owner's change 24/11: a rider no longer on the team is not excluded by the list.
  assert.doesNotMatch(LATE_RIDER_LIST_SQL, /team_now|IS DISTINCT FROM c\.team_id/);
  assert.equal(buildRecoveryManifest({ ...listInput().state }).candidates.every((c) => c.follows_rider), true);
});

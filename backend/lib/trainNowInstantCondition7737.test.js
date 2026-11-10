import test from "node:test";
import assert from "node:assert/strict";
import { applyStageStartFatigue, ridersWithFatigueNow, fatigueByRiderNow, fatigueOutlookForTeam } from "./riderFatigueNow.js";
import { settleTrainingDateCondition } from "./trainingDateCondition.js";
import { loadInstantConditions, InstantConditionEvidenceError } from "./trainNowInstantCondition7737.js";
import { RACE_DAY_ENGINE_RECOVERY_CONFIG } from "./riderCondition.js";

const DATE = "2026-11-09";
const opening = { fatigue: 48, form: 57 };
const days = [41, 42, 43, 44, 45];
const at = new Date(`${DATE}T14:00:00Z`);

export function instantDatabase({ loads = [], settled = false, intensity = "normal", fail = null, stamped = true,
  reservedDays = [43], current = counted(loads, intensity, reservedDays), missingReceipt = null, flags = {}, nextStage = false } = {}) {
  const tables = {
    training_train_now_locks: stamped ? [{ rider_id: "r", team_id: "t", season_id: "s", tick_date: DATE, instant_at: `${DATE}T06:00:00Z`, instant_entry_snapshot: { slots: reservedDays.map(gameDay => ({ gameDay })) } }] : [],
    training_date_work: [{ team_id: "t", tick_date: DATE, season_id: "s", game_days: days, opening_conditions: { r: opening }, expected_rider_ids: ["r"] }],
    training_rider_ticks: days.filter(d => !reservedDays.includes(d) && d !== missingReceipt).map(game_day => ({ rider_id: "r", season_id: "s", tick_date: DATE, game_day, report: { intensity, recovery_before_date: 61 } })),
    training_condition_settlements: settled ? [{ rider_id: "r", tick_date: DATE, season_id: "s" }] : [],
    training_race_loads: loads.map(({ game_day, load }) => ({ rider_id: "r", season_id: "s", game_day, load, tick_date: DATE, consumed_at: null, duplicate_of_race_id: null })),
    race_stage_schedule: [{ race_id: "race", stage_number: 2, game_day: 44, scheduled_at: `${DATE}T15:00:00Z` }],
    rider_condition: [{ rider_id: "r", form: current.form, fatigue: current.fatigue }],
    races: [{ id: "race", stages_completed: 1 }],
    race_entry_days: nextStage ? [{ rider_id: "r", race_id: "race", season_id: "s", game_day: 44 }] : [],
    app_config: Object.entries({ condition_model_v2: "on", training_condition_per_date: "on", training_tick_per_race_day: "on",
      fatigue_now_7801: "on", condition_v2_race_date_training_day: "on", race_day_engine_enabled: "on", ...flags }).map(([key, value]) => ({ key, value })),
  };
  return { from(table) {
    const filters = [];
    const q = {
      select() { return q; }, order() { return q; }, range() { return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; },
      in(k, v) { filters.push(r => v.includes(r[k])); return q; },
      lt(k, v) { filters.push(r => r[k] < v); return q; },
      gte(k, v) { filters.push(r => r[k] >= v); return q; },
      is(k, v) { filters.push(r => (r[k] ?? null) === v); return q; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      async maybeSingle() { return { ...result(), data: result().data?.[0] ?? null }; },
    };
    const result = () => ({ data: (tables[table] ?? []).filter(r => filters.every(f => f(r))), error: table === fail ? { message: "synthetic evidence unavailable" } : null });
    return q;
  } };
}

export function counted(loads = [], intensity = "normal", reservedDays = [43]) {
  return settleTrainingDateCondition({ riderId: "r", dateStr: DATE, condition: opening,
    intensities: days.map(d => reservedDays.includes(d) ? "race" : intensity),
    raceLoads: days.map(d => loads.find(l => l.game_day === d)?.load ?? 0),
    recoveryAbility: 61, medicalBonus: 0, modelV2: true, raceDateTrainingDay: true });
}

test("#7737: a press and a stage use the frozen opening once across readers", async () => {
  const loads = [{ game_day: 43, load: 24 }];
  const provisional = counted();
  const rider = { rider_id: "r", team_id: "t", fatigue: provisional.fatigue, form: provisional.form,
    injured_until: "2026-11-12", injury_cause: "race_crash", abilities: { recovery: 90 } };
  const expected = counted(loads);
  const entrants = [{ ...rider }];
  await applyStageStartFatigue({ supabase: instantDatabase({ loads }), raceId: "race", stageNumber: 2, entrants });
  const current = await ridersWithFatigueNow({ supabase: instantDatabase({ loads }), riders: [rider], now: at });
  assert.equal(entrants[0].fatigue, expected.fatigue);
  assert.equal(current[0].fatigue, expected.fatigue);
  assert.equal(current[0].form, expected.form);
  assert.equal(entrants[0].form, expected.form);
  assert.equal(current[0].injury_cause, rider.injury_cause);
  assert.equal(current[0].injured_until, rider.injured_until);
  assert.deepEqual(rider.fatigue, provisional.fatigue);
});

test("#7737: before/between/after multiple stages and rest use the same date model", async () => {
  for (const intensity of ["normal", "rest"]) {
    const reservedDays = [42, 44];
    for (const loads of [[], [{ game_day: 42, load: 18 }], [{ game_day: 42, load: 18 }, { game_day: 44, load: 27 }]]) {
      const expected = counted(loads, intensity, reservedDays);
      const supabase = instantDatabase({ loads, intensity, reservedDays });
      const args = { supabase, riderIds: ["r"], tickDate: DATE };
      assert.deepEqual((await loadInstantConditions(args)).get("r"), { fatigue: expected.fatigue, form: expected.form });
      assert.deepEqual(await loadInstantConditions(args), await loadInstantConditions(args), "retry is read-only and stable");
    }
  }
});

test("#7737: settled receipts read the final condition and never replay the date", async () => {
  const current = { form: 64, fatigue: 29 };
  const supabase = instantDatabase({ settled: true, current, loads: [{ game_day: 43, load: 24 }] });
  const args = { supabase, riders: [{ rider_id: "r", fatigue: 48, form: 57 }], now: at };
  assert.deepEqual((await ridersWithFatigueNow(args))[0], { rider_id: "r", ...current });
  assert.equal((await loadInstantConditions({ supabase, riderIds: ["r"], tickDate: "2026-11-10" })).size, 0,
    "a settled prior date is not reconstructed on a subsequent date");
});

test("#7737: no entries and no stamp keep legacy outputs", async () => {
  const rider = { rider_id: "r", fatigue: 48, form: 57 };
  const out = await ridersWithFatigueNow({ supabase: instantDatabase({ stamped: false }), riders: [rider], now: at });
  assert.deepEqual(out, [rider]);
});

test("#7737: durable stamps still govern current and next-stage displays with switches OFF", async () => {
  const loads = [{ game_day: 43, load: 24 }];
  const provisional = counted();
  const conditions = [{ rider_id: "r", fatigue: provisional.fatigue, form: provisional.form }];
  const supabase = instantDatabase({ loads, nextStage: true, flags: { training_train_now_instant: "off", fatigue_now_7801: "off" } });
  const expected = counted(loads);
  assert.equal((await fatigueByRiderNow({ supabase, conditions, now: at })).get("r"), expected.fatigue);
  const outlook = await fatigueOutlookForTeam({ supabase, team: { id: "t" }, seasonId: "s", conditions, now: at });
  assert.deepEqual(outlook.get("r"), { form: expected.form, fatigue: expected.fatigue, fatigueAtStart: expected.fatigue });
});

test("#7737: authoritative read errors cannot silently fall back", async () => {
  for (const options of [{ fail: "training_race_loads" }, { fail: "training_date_work" },
    { fail: "training_train_now_locks", flags: { training_train_now_instant: "on" } }]) {
    const supabase = instantDatabase(options);
    await assert.rejects(fatigueByRiderNow({ supabase, conditions: [{ rider_id: "r", fatigue: 22 }], now: at }), InstantConditionEvidenceError);
  }
});

test("#7737 review: with the switch off a failed stamp lookup keeps the pre-#7737 behaviour", async () => {
  const supabase = instantDatabase({ fail: "training_train_now_locks", flags: { training_train_now_instant: "off" } });
  const instant = await loadInstantConditions({ supabase, riderIds: ["r"], tickDate: DATE });
  assert.equal(instant.size, 0);
  await assert.doesNotReject(fatigueByRiderNow({ supabase, conditions: [{ rider_id: "r", fatigue: 22 }], now: at }));
});

test("#7737 review: an unreadable switch after a failed stamp lookup still refuses to guess", async () => {
  const supabase = instantDatabase({ fail: "training_train_now_locks" });
  const from = supabase.from.bind(supabase);
  supabase.from = (table) => table === "app_config"
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "down" } }) }) }) }
    : from(table);
  await assert.rejects(loadInstantConditions({ supabase, riderIds: ["r"], tickDate: DATE }), InstantConditionEvidenceError);
});

test("#7737: the instant-only runner seam leaves unstamped entrants unchanged", async () => {
  const rider = { rider_id: "r", fatigue: 48, form: 57 };
  const entrants = [{ ...rider }];
  await applyStageStartFatigue({ supabase: instantDatabase({ stamped: false, loads: [{ game_day: 43, load: 24 }] }),
    raceId: "race", stageNumber: 2, entrants, instantOnly: true });
  assert.deepEqual(entrants, [rider]);
});

test("#7737: a stamped date still uses the existing date model when v2 is off", async () => {
  const loads = [{ game_day: 43, load: 24 }];
  const supabase = instantDatabase({ loads, flags: { condition_model_v2: "off", training_train_now_instant: "off" } });
  const expected = settleTrainingDateCondition({ riderId: "r", dateStr: DATE, condition: opening,
    intensities: days.map(d => d === 43 ? "race" : "normal"), raceLoads: [0, 0, 24, 0, 0],
    recoveryAbility: 61, recoveryConfig: RACE_DAY_ENGINE_RECOVERY_CONFIG });
  assert.deepEqual((await loadInstantConditions({ supabase, riderIds: ["r"], tickDate: DATE })).get("r"),
    { form: expected.form, fatigue: expected.fatigue });
});

test("#7737: stage-schedule evidence failure cannot return a stamped provisional condition", async () => {
  const supabase = instantDatabase({ fail: "race_stage_schedule" });
  await assert.rejects(fatigueByRiderNow({ supabase, conditions: [{ rider_id: "r", fatigue: counted().fatigue }],
    now: at, atStage: { raceId: "race", stageNumber: 2 } }), InstantConditionEvidenceError);
});

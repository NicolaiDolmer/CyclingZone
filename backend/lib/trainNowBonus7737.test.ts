import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDailyTick } from './dailyTraining.js';
import { TRAIN_NOW_BONUS_FACTOR, loadTrainNowBonusRiderIds } from './trainNowBonus7737.ts';
import { isTrainNowBonusEnabled } from './trainNow.js';
import { seedState, createFake as createBaseFake, press, finishRace, sweep, enter, DAYS, DATE, SEASON, EVENING_AT, SCENARIOS } from './__fixtures__/trainNowInstant7737Harness.js';
import { runTeamTrainingDay } from './dailyTrainingEngine.js';
import { validateDevelopmentXpParams } from './developmentXp.ts';

const args = { riderId: 'synthetic', dateStr: '2026-10-26', age: 24,
  abilities: { sprint: 40 }, caps: { sprint: 90 }, progress: {},
  program: { focus: 'sprint', intensity: 'normal' }, conditionMult: 1, potentiale: 4 };

function createFake(state) {
  const fake = createBaseFake(state);
  const rpc = fake.supabase.rpc;
  fake.supabase.rpc = async (name, params) => {
    if (name !== 'publish_train_now_bonus_press') return rpc(name,params);
    await fake.supabase.from('training_train_now_locks').upsert(params.p_rider_ids.map(rider_id => ({
      rider_id,team_id:params.p_team_id,season_id:params.p_season_id,tick_date:params.p_tick_date,
      pressed_at:params.p_now,train_now_bonus:params.p_eligible_rider_ids.includes(rider_id),
    })));
    await rpc('freeze_train_now_date_entries',{...params,p_rider_ids:params.p_eligible_rider_ids});
    for(const row of state.training_train_now_locks) if(row.train_now_bonus && row.instant_entry_snapshot) row.instant_at ??= params.p_now;
    return {data:{published:true},error:null};
  };
  return fake;
}

test('bonus scales raw normal training before point purchase', () => {
  const plain = applyDailyTick(args);
  const boosted = applyDailyTick({ ...args, trainNowBonus: true });
  assert.equal(boosted.progress.sprint, plain.progress.sprint * TRAIN_NOW_BONUS_FACTOR);
  assert.notDeepEqual(boosted, plain);
  assert.deepEqual(applyDailyTick({ ...args, trainNowBonus: false }), plain);
});

test('rest and old leftover bonus boolean do not earn extra growth', () => {
  assert.deepEqual(applyDailyTick({ ...args, bonus: true }), applyDailyTick(args));
  const rest = { ...args, program: { focus: 'sprint', intensity: 'rest' } };
  assert.deepEqual(applyDailyTick({ ...rest, trainNowBonus: true }), applyDailyTick(rest));
});

test('independent control only accepts exact on', async () => {
  for (const value of ['on', 'off', 'beta', true, null]) {
    const supabase = { from: () => ({ select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { value }, error: null }; } }) };
    assert.equal(await isTrainNowBonusEnabled(supabase), value === 'on');
  }
});

test('decision read only tolerates its own pre-migration schema gap', async () => {
  const read = async error => {
    const supabase = { from: () => ({ select() { return this; }, eq() { return this; },
      async in() { return { data: null, error }; } }) };
    return loadTrainNowBonusRiderIds({ supabase, teamId: 'team', seasonId: 'season', tickDate: DATE, riderIds: ['rider'] });
  };
  assert.equal((await read({ code: '42703', message: 'column train_now_bonus does not exist' })).size,0);
  await assert.rejects(read({ code: 'XX000', message: 'read failed' }), /bonus decision/);
  await assert.rejects(read({ code: '42703', message: 'column rider_id does not exist' }), /bonus decision/);
});

test('raw XP is boosted before purchase, while existing caps still bind', () => {
  const developmentXp = validateDevelopmentXpParams({ price: { base: 10, exponent: 2 },
    potentialXp: [{ at: 1, value: 10 }, { at: 6, value: 90 }],
    ageShare: { physical: [{ at: 28, value: 1 }, { at: 40, value: 0.1 }], mental: [{ at: 28, value: 1 }, { at: 40, value: 0.1 }] },
    offFocusShare: 0.1, raceOffFocusShare: 0.2,
    typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 } });
  assert.ok(developmentXp);
  const plain = applyDailyTick({ ...args, developmentXp });
  const boosted = applyDailyTick({ ...args, developmentXp, trainNowBonus: true });
  assert.equal(boosted.xp.sprint, plain.xp.sprint * TRAIN_NOW_BONUS_FACTOR);
  const race = { ...args, developmentXp, program: { focus: 'race_day', focusAbilities: ['sprint'], intensity: 'normal' } };
  assert.deepEqual(applyDailyTick({ ...race, trainNowBonus: true }), applyDailyTick(race));
  const capped = applyDailyTick({ ...args, abilities: { sprint: 89 }, progress: { sprint: 0.99 }, hardDailyCap: 1, trainNowBonus: true });
  assert.ok(capped.abilities.sprint <= 90);
});

const flags = { training_train_now_instant: 'on', training_train_now_bonus: 'on', condition_model_v2: 'on', condition_v2_race_date_training_day: 'on' };
const decisions = state => state.training_train_now_locks.map(row => row.train_now_bonus ?? false);
const turnOff = state => { for (const row of state.app_config) if (row.key.startsWith('training_train_now_')) row.value = 'off'; };

test('all-free and race riders both retain first choice through automatic continuation', async () => {
  const state = seedState({ flags });
  enter(state, ['r2']);
  const fake = createFake(state);
  await press(state, fake);
  assert.deepEqual(decisions(state), [true, true]);
  assert.ok(state.training_train_now_locks.every(row => row.instant_at));
  const reports = state.training_rider_ticks.map(row => row.report);
  assert.ok(reports.every(row => row.train_now_bonus === true));
  turnOff(state);
  finishRace(state, ['r2']);
  await sweep(state, fake);
  const race = state.training_rider_ticks.find(row => row.rider_id === 'r2' && row.game_day === 43);
  assert.equal(race.report.intensity, 'race');
  assert.equal(race.report.train_now_bonus, true, 'receipt records the durable choice, even on an unboosted race tick');
  const before = structuredClone(state.rider_derived_abilities);
  await sweep(state, fake);
  assert.deepEqual(state.rider_derived_abilities, before);
});

test('partial press resumes free slots as assistant with both switches OFF', async () => {
  const state = seedState({ flags });
  enter(state, ['r2']);
  const fake = createFake(state);
  const original = fake.supabase.rpc;
  let commits = 0;
  fake.supabase.rpc = async (name, params) => {
    if (name.endsWith('commit_training_date_tick') && ++commits === 2) throw new Error('synthetic interruption');
    return original(name, params);
  };
  await assert.rejects(press(state, fake), /synthetic interruption/);
  fake.supabase.rpc = original;
  turnOff(state);
  const work = state.training_date_work[0];
  const slots = Object.fromEntries(state.training_train_now_locks.map(row => [row.rider_id, row.instant_entry_snapshot.slots]));
  // Same public engine interface PR2 recovery calls before reading stage abilities.
  for (const gameDay of DAYS) {
    const ready = work.expected_rider_ids.filter(id => !(slots[id] ?? []).some(slot => Number(slot.gameDay) === gameDay));
    await runTeamTrainingDay({ supabase: fake.supabase, teamId: state.teams[0].id, seasonId: SEASON.id,
      seasonNumber: SEASON.number, now: EVENING_AT, tickDateOverride: DATE, gameDay,
      dateGameDays: DAYS, executedBy: 'assistant', eligibleRiderIds: ready, unresolvedSlotsByRider: slots,
      deadlineAt: '2026-11-10T01:00:00Z', deadlineReached: false });
  }
  assert.equal(state.training_rider_ticks.length, 9);
  assert.ok(state.training_rider_ticks.every(row => row.report.train_now_bonus === true));
});

test('real press lost first publication response resumes automatically with controls OFF and no second press', async () => {
  const run = async loseResponse => {
    const state = seedState({flags}); enter(state,['r2']); const fake=createFake(state);
    const rpc=fake.supabase.rpc;
    fake.supabase.rpc=async(name,params)=>{
      const result=await rpc(name,params);
      if(loseResponse && name==='publish_train_now_bonus_press') throw new Error('lost first publication response');
      return result;
    };
    if(loseResponse) await assert.rejects(press(state,fake),/lost first publication response/);
    else await press(state,fake);
    fake.supabase.rpc=rpc;
    assert.ok(state.training_train_now_locks.every(row=>row.instant_entry_snapshot && row.instant_at));
    turnOff(state);
    const work=state.training_date_work[0];
    const slots=Object.fromEntries(state.training_train_now_locks.map(row=>[row.rider_id,row.instant_entry_snapshot.slots]));
    for(const gameDay of DAYS) await runTeamTrainingDay({supabase:fake.supabase,teamId:state.teams[0].id,seasonId:SEASON.id,
      seasonNumber:SEASON.number,now:EVENING_AT,tickDateOverride:DATE,gameDay,dateGameDays:DAYS,executedBy:'assistant',
      eligibleRiderIds:work.expected_rider_ids.filter(id=>!(slots[id]??[]).some(slot=>Number(slot.gameDay)===gameDay)),
      unresolvedSlotsByRider:slots,deadlineAt:'2026-11-10T01:00:00Z',deadlineReached:false});
    finishRace(state,['r2']);await sweep(state,fake);
    assert.equal(state.training_rider_ticks.length,10);
    const abilities=structuredClone(state.rider_derived_abilities);
    await sweep(state,fake);assert.deepEqual(state.rider_derived_abilities,abilities);
    return abilities;
  };
  assert.deepEqual(await run(true),await run(false));
});

test('no-click and old presses cannot acquire bonus on a later ON retry', async () => {
  const state = seedState({ flags: { ...flags, training_train_now_bonus: 'off' } });
  enter(state, ['r2']);
  const fake = createFake(state);
  await press(state, fake);
  state.app_config.find(row => row.key === 'training_train_now_bonus').value = 'on';
  await press(state, fake);
  assert.deepEqual(decisions(state), [false, false]);
  assert.ok(state.training_rider_ticks.every(row => !row.report.train_now_bonus));
});

test('ON controls without a press retain automatic training yield', async () => {
  const run = async controls => {
    const state = seedState({ flags: controls });
    const fake = createFake(state);
    await SCENARIOS.sweep_only.steps(state, fake);
    return state.rider_derived_abilities;
  };
  assert.deepEqual(await run(flags), await run({ ...flags, training_train_now_bonus: 'off' }));
});

test('rest and injured dates never receive extra development from a durable choice', async () => {
  for (const injured of [false,true]) {
    const state = seedState({ flags, intensity: injured ? 'normal' : 'rest' });
    if (injured) for (const condition of state.rider_condition) condition.injured_until='2026-11-20';
    const fake = createFake(state);
    await press(state,fake);
    assert.deepEqual(decisions(state),[true,true]);
    assert.ok(state.training_rider_ticks.every(row => Object.keys(row.report.gains).length===0));
    assert.ok(state.rider_derived_abilities.every(row => Object.keys(row.ability_progress).length===0));
  }
});

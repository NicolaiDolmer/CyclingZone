import test from 'node:test';
import assert from 'node:assert/strict';
import * as condition from './trainingDateCondition.js';
import { nextFatigue, nextForm, injuryRisk, RACE_DAY_ENGINE_RECOVERY_CONFIG } from './riderCondition.js';

test('approved historical aliases contribute only the original load, irrespective of row order', () => {
  const original={rider_id:'r1',race_id:'first',stage_number:5,game_day:12,load:7};
  const alias={rider_id:'r1',race_id:'second',stage_number:1,game_day:12,load:14,duplicate_of_race_id:'first',duplicate_of_stage_number:5};
  assert.deepEqual(condition.canonicalRaceLoads([alias,original]),[original]);
  assert.deepEqual(condition.canonicalRaceLoads([original,alias]),[original]);
  assert.throws(()=>condition.canonicalRaceLoads([alias]),/no matching original/);
  assert.throws(()=>condition.canonicalRaceLoads([original,{...alias,duplicate_of_race_id:null}]),/Unapproved duplicate/);
});

test('five hard sessions settle as one historical hard day', () => {
  assert.equal(typeof condition.settleTrainingDateCondition, 'function');
  const result = condition.settleTrainingDateCondition({ riderId: 'r1', dateStr: '2026-09-29', condition: { fatigue: 75, form: 50 }, intensities: Array(5).fill('hard'), recoveryAbility: 50 });
  const fatigue = nextFatigue({ fatigue: 75, intensity: 'hard', recoveryAbility: 50, ...RACE_DAY_ENGINE_RECOVERY_CONFIG });
  assert.equal(result.fatigue, fatigue);
  assert.equal(result.form, nextForm({ form: 50, fatigue }));
  assert.equal(result.risk, injuryRisk({ intensity: 'hard', fatigue: 75 }));
});

test('zero supplied race load never invents extra fatigue', () => {
  const result = condition.settleTrainingDateCondition({ riderId: 'r1', dateStr: '2026-09-29', condition: { fatigue: 60, form: 50 }, intensities: Array(5).fill('race'), recoveryAbility: 50 });
  assert.equal(result.fatigue, nextFatigue({ fatigue: 60, intensity: 'race', recoveryAbility: 50, ...RACE_DAY_ENGINE_RECOVERY_CONFIG }));
  assert.equal(result.risk, 0);
});

test('reject incomplete days and unknown activity rather than silently recovering', () => {
  for (const intensities of [[], ['hard'], ['hard', 'hard', 'hard', 'hard', 'unknown']]) {
    assert.throws(() => condition.settleTrainingDateCondition({ condition: {}, intensities }));
  }
});

test('mixed sessions average load and risk before rounding and one date-seeded roll', () => {
  const args = { riderId:'r1', dateStr:'2026-09-29', condition:{fatigue:80,form:60}, intensities:['hard','rest','easy','normal','race'], recoveryAbility:12 };
  const result = condition.settleTrainingDateCondition(args);
  assert.equal(result.risk,injuryRisk({intensity:'hard',fatigue:80})/5);
  assert.deepEqual(result,condition.settleTrainingDateCondition(args));
});

test('five race stages equal one historical race load at daily settlement', () => {
  const result = condition.settleTrainingDateCondition({riderId:'r1',dateStr:'2026-09-29',condition:{fatigue:40,form:50},intensities:Array(5).fill('race'),raceLoads:Array(5).fill(12),recoveryAbility:50});
  assert.equal(result.fatigue,nextFatigue({fatigue:40,intensity:'race',raceLoad:12,recoveryAbility:50,...RACE_DAY_ENGINE_RECOVERY_CONFIG}));
});

test('mixed stage efforts and training share the same five-slot denominator',()=>{
  const result=condition.settleTrainingDateCondition({riderId:'r1',dateStr:'2026-09-29',condition:{fatigue:40,form:50},intensities:['race','race','normal','normal','normal'],raceLoads:[7,12,0,0,0],recoveryAbility:50});
  assert.equal(result.fatigue,nextFatigue({fatigue:40,intensity:'race',raceLoad:(7+12+9+9+9)/5,recoveryAbility:50,...RACE_DAY_ENGINE_RECOVERY_CONFIG}));
});

test('deadline unknown slots contribute zero load without becoming rest',()=>{
  const result=condition.settleTrainingDateCondition({riderId:'r1',dateStr:'2026-09-29',condition:{fatigue:60,form:50},intensities:Array(5).fill('unknown_pending'),recoveryAbility:50});
  assert.equal(result.fatigue,nextFatigue({fatigue:60,intensity:'race',recoveryAbility:50,...RACE_DAY_ENGINE_RECOVERY_CONFIG}));
  assert.equal(result.risk,0);
});

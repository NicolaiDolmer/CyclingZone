import test from 'node:test';
import assert from 'node:assert/strict';
import { isTrainingConditionPerDateEnabled } from './trainingDateConditionFlag.js';
function client(value, error = null) {
  return { from() { return { select(){return this;}, eq(){return this;}, async maybeSingle(){return {data:value == null ? null : {value},error};} }; } };
}
test('daily condition flag defaults off; beta and on give engine ownership', async () => {
  for(const value of [null,'off',false,'unknown']) assert.equal(await isTrainingConditionPerDateEnabled(client(value)),false);
  for(const value of ['on','beta',true]) assert.equal(await isTrainingConditionPerDateEnabled(client(value)),true);
});
test('failed condition ownership read never opens legacy recovery', async () => {
  await assert.rejects(isTrainingConditionPerDateEnabled(client(null,{message:'offline'})),/ownership/);
});

test('normalized condition rejects a disabled race-day prerequisite',async()=>{
  const supabase={from(){let key;return {select(){return this;},eq(_column,value){key=value;return this;},async maybeSingle(){return {data:{value:key==='training_condition_per_date'?'on':'off'},error:null};}};}};
  await assert.rejects(isTrainingConditionPerDateEnabled(supabase),/requires training_tick_per_race_day/);
});

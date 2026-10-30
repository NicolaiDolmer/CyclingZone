import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDraftsFromEntries, buildSaveError } from './seasonMatrix.js';
test('withdrawn history is excluded from the new manager draft',()=>{
 const entries=[{raceId:'withdrawn',riderId:'old',raceRole:'captain'},{raceId:'other',riderId:'new',raceRole:'helper'}];
 const drafts=buildDraftsFromEntries(entries,['withdrawn']);
 assert.equal(drafts.has('withdrawn'),false);assert.deepEqual(drafts.get('other')?.rider_ids,['new']);
});
test('binding errors name rider and competing race for rejoin payload too',()=>{
 const result=buildSaveError({error:'selection_rider_bound',conflicts:[{rider_name:'Ada',bound_race_name:'Tour B'}]},[],[]);
 assert.deepEqual(result.params,{rider:'Ada',race:'Tour B'});
});
test('panel allows voluntary rejoin before lock, retains DNS and disables auto',()=>{
 const panel=readFileSync(new URL('../components/race/RaceSelectionPanel.jsx',import.meta.url),'utf8');
 assert.match(panel,/if \(data\.withdrawn && data\.lineup_locked\)/);
 assert.match(panel,/selection\.rejoinNote/);
 assert.match(panel,/disabled=\{busy \|\| fullyTrainNowLocked \|\| data\.withdrawn\}/);
});
test('rejoin and locked copy exists in all released languages',()=>{
 for(const lang of ['en','da','es','fr','nl']){
 const j=JSON.parse(readFileSync(new URL('../../public/locales/'+lang+'/races.json',import.meta.url),'utf8'));
 assert.ok(j.selection.rejoinNote);assert.ok(j.selection.errors.selection_withdrawn_locked);
 assert.match(j.selection.errors.selection_rider_bound_named,/\{rider\}/);assert.match(j.selection.errors.selection_rider_bound_named,/\{race\}/);
 }
});

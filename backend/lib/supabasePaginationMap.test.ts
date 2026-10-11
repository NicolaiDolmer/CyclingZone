import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllRowsKeyset } from './supabasePagination.js';

test('filtered pages do not end the scan or change the original keyset cursor', async ()=>{
  const data=Array.from({length:2001},(_,i)=>({id:i+1}));
  const cursors=[];
  const rows=await fetchAllRowsKeyset(after=>({limit:async size=>{
    cursors.push(after);return {data:data.filter(row=>after==null||row.id>after).slice(0,size),error:null};
  }}),{mapPage:page=>page.filter(row=>row.id===2001)});
  assert.equal(rows.length,1); assert.deepEqual(rows,[{id:2001}]); assert.deepEqual(cursors,[null,1000,2000]);
});

test('mapping retains default behavior and cannot alter cursor through array mutation', async ()=>{
  const source=[{id:1},{id:2},{id:3}];let calls=0;
  const build=after=>({limit:async size=>{calls++;return {data:source.filter(row=>after==null||row.id>after).slice(0,size),error:null};}});
  assert.deepEqual(await fetchAllRowsKeyset(build,{pageSize:2}),source);
  calls=0;
  assert.deepEqual(await fetchAllRowsKeyset(build,{pageSize:2,mapPage:page=>{page.length=0;return [];}}),[]);
  assert.equal(calls,2);
});

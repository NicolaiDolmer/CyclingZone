import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeClient, validateTarget } from './seasonTransitionRehearsal7325.mjs';

const target={bin:'C:/pg17/bin',scratch:'C:/scratch/rehearsal7325_run',database:'rehearsal7325_fixture',port:57325};
test('refuses production-style database names and missing ownership inputs',()=>{
  for(const database of ['postgres','production','rehearsal7325_x;DROP DATABASE x','rehearsal7325_']) {
    assert.throws(()=>validateTarget({...target,database}));
  }
  assert.throws(()=>validateTarget({...target,scratch:'C:/unowned'}));
  assert.throws(()=>validateTarget({...target,port:0}));
  assert.throws(()=>validateTarget({...target,bin:''}));
  assert.equal(validateTarget(target).database,'rehearsal7325_fixture');
});
test('SQL failure is returned as an error and never a successful empty result',async()=>{
  const client=nativeClient(()=>{throw Error('relation unavailable');});
  const response=await client.from('training_plans').select('id').eq('season_id','synthetic');
  assert.equal(response.data,null);
  assert.match(response.error.message,/relation unavailable/);
});
test('unsupported query shapes fail explicitly',async()=>{
  const client=nativeClient(()=>{throw Error('must not query');});
  assert.throws(()=>client.from('training_plans; DROP TABLE teams'));
  await assert.rejects(Promise.resolve(client.from('teams').select('unknown_relation(id)')),/Unsupported embedded/);
  assert.throws(()=>client.from('teams').or('id.like.anything'));
});
test('commit hook fires only after successful native statement result',async()=>{
  const commits=[];
  let successful=false;
  const client=nativeClient(()=>{if(!successful)throw Error('constraint failed');return '[{"rider_id":"synthetic"}]';},
    {afterCommit:mutation=>commits.push(mutation)});
  const write=()=>client.from('training_plans').upsert([{rider_id:'synthetic'}],{onConflict:'rider_id',ignoreDuplicates:true}).select('rider_id');
  assert.ok((await write()).error);
  assert.equal(commits.length,0);
  successful=true;
  assert.equal((await write()).error,null);
  assert.equal(commits.length,1);
});
test('duplicate-sensitive writes preserve ON CONFLICT and quote literals',async()=>{
  let statement;
  const client=nativeClient(sql=>{statement=sql;return '[]';});
  await client.from('training_plans').upsert([{focus:"manager's choice",season_id:'synthetic'}],
    {onConflict:'team_id,rider_id,season_id',ignoreDuplicates:true}).select('rider_id');
  assert.match(statement,/ON CONFLICT \("team_id","rider_id","season_id"\) DO NOTHING/);
  assert.match(statement,/manager''s choice/);
});

test('requires an owned cluster marker before connecting to PostgreSQL',async()=>{
  const { connection }=await import('./seasonTransitionRehearsal7325.mjs');
  const { fileURLToPath }=await import('node:url');
  const scratch=fileURLToPath(new URL('./fixtures/seasonTransition7325',import.meta.url));
  assert.throws(()=>connection({...target,scratch}),/ENOENT/);
});

test('production rank publication extraction preserves dollar quoting and accepts LF/CRLF',async()=>{
  const { rankPublicationSql }=await import('./seasonTransitionRehearsal7325.mjs');
  const { readFileSync }=await import('node:fs');
  const source=readFileSync(new URL('../database/2026-10-06-5692-ranking-refresh-events.sql',import.meta.url),'utf8');
  const lf=source.replaceAll('\r\n','\n');
  assert.equal(rankPublicationSql(lf),rankPublicationSql(lf.replaceAll('\n','\r\n')));
  assert.ok(rankPublicationSql(source).startsWith('DO $$ '));
  assert.match(rankPublicationSql(source),/REFRESH MATERIALIZED VIEW CONCURRENTLY/);
  assert.throws(()=>rankPublicationSql('unrecognized source'),/Unrecognized production/);
});

test('embedded production selects accept whitespace between column names',async()=>{
  let statement;
  const client=nativeClient(sql=>{statement=sql;return '[]';});
  const result=await client.from('teams').select('id, board_profiles(budget_modifier, negotiation_status)');
  assert.equal(result.error,null);
  assert.match(statement,/SELECT "budget_modifier","negotiation_status" FROM board_profiles/);
});

test('SQLSTATE is preserved so production balance dedupe can distinguish conflicts',async()=>{
  const fail=()=>{throw Object.assign(Error('duplicate'),{sqlState:'23505'});};
  const client=nativeClient(fail);
  assert.equal((await client.rpc('increment_balance_with_audit',{})).error.code,'23505');
  assert.equal((await client.from('training_plans').insert({focus:'synthetic'})).error.code,'23505');
});
test('standalone rehearsal boundary denies fetch, HTTP, HTTPS, raw TCP and TLS',async()=>{
  const {spawnSync}=await import('node:child_process');
  const source='import assert from "node:assert/strict";'+
    'const {installNoNetworkBoundary}=await import('+JSON.stringify(new URL('./seasonTransitionRehearsal7325.mjs',import.meta.url).href)+');'+
    'const attempts=await installNoNetworkBoundary();'+
    'await assert.rejects(fetch("http://127.0.0.1:9"),{code:"REHEARSAL_NETWORK_DENIED"});'+
    'for(const [name,method] of [["node:http","request"],["node:https","request"],["node:net","connect"],["node:tls","connect"],["node:dns","lookup"]]) {'+
    'const api=await import(name);assert.throws(()=>api[method]({host:"127.0.0.1",port:9}),{code:"REHEARSAL_NETWORK_DENIED"});}'+
    'assert.equal(attempts.length,6);console.log("network-denials="+attempts.length);';
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{
    encoding:'utf8',windowsHide:true,timeout:30000,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/network-denials=6/);
});

test('restore validation rejects executable reconnect/include/shell commands before SQL',async()=>{
  const {validateSqlScript}=await import('./seasonTransitionRehearsal7325.mjs');
  for(const command of ['\\connect postgres','\\c postgres','\\i other.sql','\\ir other.sql','\\! echo unsafe','\\gexec']) {
    assert.throws(()=>validateSqlScript('CREATE TABLE marker(id int);\n'+command+'\n'),/psql meta command rejected/);
    assert.throws(()=>validateSqlScript('SELECT 1; '+command+'\n'),/psql meta command rejected/);
  }
  assert.throws(()=>validateSqlScript('SET standard_conforming_strings=off; SELECT 1;'),/Unsupported SQL string/);
});
test('restore validation accepts SQL bodies, quoted data and balanced dump restrictions',async()=>{
  const {validateSqlScript}=await import('./seasonTransitionRehearsal7325.mjs');
  const safe="\\restrict local7325\nSET standard_conforming_strings = on;\n"+
    "CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $body$ SELECT '\\connect is quoted data'; $body$;\n"+
    "INSERT INTO names VALUES ('manager''s choice', E'escaped\\\\value');\n-- \\connect comment\n\\unrestrict local7325\n";
  assert.equal(validateSqlScript(safe),safe);
  assert.throws(()=>validateSqlScript('\\restrict local7325\nSELECT 1;'),/Unterminated/);
  assert.throws(()=>validateSqlScript('\\restrict local7325\n\\unrestrict different7325\n'),/Mismatched/);
});
test('attempt IDs allocate separate output paths and reject path traversal',async()=>{
  const {attemptFiles}=await import('./seasonTransitionRehearsal7325.mjs');
  const first=attemptFiles('C:/scratch/7325','activation-01-transition-resume');
  const second=attemptFiles('C:/scratch/7325','activation-02-transition-resume');
  assert.equal(new Set([...Object.values(first),...Object.values(second)]).size,8);
  assert.throws(()=>attemptFiles('C:/scratch/7325','../other'));
});

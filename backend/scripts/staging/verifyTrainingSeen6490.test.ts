import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { runVerification, PsqlSession, waitForBlock } from './verifyTrainingSeen6490.mjs';

const args=['--mode','concurrency','--clock','2026-10-11T12:00:00Z','--out','result.json'];
const local={CZ_TARGET_ENV:'local-disposable',PGHOST:'127.0.0.1',PGPORT:'56490',
  PGDATABASE:'cz_6490_abcdef123456',PGUSER:'cz6490',PGPASSWORD:'fixture-only'};
test('unsafe targets and invalid clock are rejected before connecting',async()=>{
  for(const change of [{PGHOST:'db.ghwvkxzhsbbltzfnuhhz.supabase.co'},{PGHOST:'localhost'},
    {PGDATABASE:'postgres'},{PGUSER:'postgres'},{CZ_TARGET_ENV:'production'},{PGPORT:'5432'}]){
    let connects=0;
    const result=await runVerification(args,{...local,...change},{connect:()=>{connects++;throw new Error('secret');}});
    assert.equal(result.status,'BLOCKED');assert.equal(connects,0);assert.doesNotMatch(JSON.stringify(result),/secret/);
  }
  assert.equal((await runVerification(args.map(v=>v==='2026-10-11T12:00:00Z'?'yesterday':v),local)).status,'BLOCKED');
});
test('unknown server, missing fixture marker and nonempty database block before DDL',async()=>{
  for(const metadata of [{version:'180004',marker:'6490',empty:true},{version:'170011',marker:null,empty:true},
    {version:'170011',marker:'6490',empty:false}]){
    const queries:string[]=[];let closed=false;
    const result=await runVerification(args,local,{connect:()=>({query:async(sql:string)=>{queries.push(sql);return JSON.stringify(metadata);},
      close:async()=>{closed=true;}})});
    assert.equal(result.status,'BLOCKED');assert.equal(result.code,'PREFLIGHT');assert.equal(queries.length,1);assert.ok(closed);
    assert.doesNotMatch(queries[0],/CREATE|INSERT|UPDATE|DELETE/);
  }
});

function child(handler:(text:string,child:any)=>void){
  const c:any=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.killed=false;
  c.stdin=new Writable({write(chunk,_,done){handler(chunk.toString(),c);done();}});
  c.kill=()=>{c.killed=true;c.emit('close',1);};return c;
}
test('session propagates SQL failure with fixed text and kills only its own child',async()=>{
  const c=child((_,self)=>{self.stderr.write('private SQL/password');queueMicrotask(()=>self.emit('close',3));});
  const session=new PsqlSession(local,{spawn:()=>c});
  await assert.rejects(session.query('SELECT broken'),/^Error: SQL_FAILED$/);
  await session.close();
});
test('session uses quiet psql and output delimiter; no credentials in arguments',async()=>{
  let argv:string[]=[];
  const c=child((sql,self)=>{const marker=/\\echo (\S+)/.exec(sql)?.[1];if(marker)queueMicrotask(()=>self.stdout.write(`17\n${marker}\n`));});
  const session=new PsqlSession(local,{spawn:(_bin,a)=>{argv=a;return c;}});
  assert.equal(await session.query('SHOW server_version_num'),'17');
  assert.ok(argv.includes('-qAt'));assert.doesNotMatch(argv.join(' '),/fixture-only/);
  c.emit('close',0);await session.close();
});
test('barrier requires positive blocking observation and rejects an unobserved race',async()=>{
  const queries:string[]=[];let n=0;
  const observer={query:async(sql:string)=>{queries.push(sql);return ++n===2?'t':'f';}};
  await waitForBlock(observer,42,41,{attempts:3,pause:async()=>{}});
  assert.equal(queries.length,2);assert.match(queries[0],/pg_blocking_pids\(42\)/);
  await assert.rejects(waitForBlock({query:async()=>'f'},42,41,{attempts:2,pause:async()=>{}}),/BARRIER_NOT_OBSERVED/);
});

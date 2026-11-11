import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAutoAccept8015 } from './__fixtures__/autoAccept8015Db.js';
const PG=process.env.AUTO_ACCEPT_PG_BIN;
test('#8015 native PG17 against production function definitions',{
 skip:!PG&&'AUTO_ACCEPT_PG_BIN is not set',timeout:180000,
},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'auto-accept-8015-'));
 const data=join(directory,'data'),port=59000+Math.floor(Math.random()*900);
 const run=(binary,args,input)=>{
  const r=spawnSync(join(PG,binary),args,{input,encoding:'utf8',windowsHide:true,timeout:120000,
   env:{...process.env,PGCLIENTENCODING:'UTF8'}});
  assert.equal(r.status,0,r.error?.message||r.stderr);return r.stdout;
 };
 assert.match(run('psql',['--version']),/PostgreSQL\) 17\./);
 const args=['-X','-q','-t','-A','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
 let started=false;
 try{
  run('initdb',['-D',data,'-U','postgres','-A','trust','-E','UTF8','--locale=C']);
  const start=spawnSync(join(PG,'pg_ctl'),['-D',data,'-o',`-p ${port} -c listen_addresses=127.0.0.1`,'-w','-l',join(directory,'pg.log'),'start'],{windowsHide:true,stdio:'ignore',timeout:30000});
  assert.equal(start.status,0);started=true;
  const db={exec:async sql=>run('psql',args,sql),query:async sql=>({rows:JSON.parse(run('psql',args,`SELECT coalesce(json_agg(row_to_json(q)),'[]'::json) FROM (${sql})q;`).trim())})};
  const productionDefinitions=process.env.AUTO_ACCEPT_8015_DEFINITIONS?JSON.parse(await readFile(process.env.AUTO_ACCEPT_8015_DEFINITIONS,'utf8')):undefined;
  t.diagnostic(JSON.stringify(await verifyAutoAccept8015(db,{productionDefinitions})));
 }finally{
  if(started){run('pg_ctl',['-D',data,'-m','fast','-w','-t','60','stop']);
   const state=spawnSync(join(PG,'pg_ctl'),['-D',data,'status'],{windowsHide:true,stdio:'ignore',timeout:30000});
   assert.equal(state.status,3);t.diagnostic('stop=0; status=3');}
  // Preserve local evidence. Session close-out archives it; never delete a worktree/cache.
  t.diagnostic('native_cluster_evidence='+directory);
 }
});
